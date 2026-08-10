package usagemonitoring

import (
	"encoding/json"
	"fmt"
	"strings"
)

func SupportsStatsFilter(filter AnalyticsFilter) bool {
	return strings.TrimSpace(filter.SearchQuery) == "" &&
		len(filter.ProjectIDs) == 0 &&
		len(filter.HeaderErrorKinds) == 0 &&
		len(filter.HeaderErrorCodes) == 0 &&
		len(filter.HeaderQuotaPlans) == 0 &&
		len(filter.HeaderTraceIDs) == 0 &&
		filter.MinLatencyMS == 0 &&
		strings.TrimSpace(filter.CacheStatus) == ""
}

// SupportsEventProjectionFilter keeps the packed search document equivalent to
// the legacy per-column LIKE predicates. User-supplied LIKE wildcards can span
// the projection's field separator, so those uncommon searches must retain the
// raw usage_events path instead of returning a false cross-field match.
func SupportsEventProjectionFilter(filter AnalyticsFilter) bool {
	query := strings.TrimSpace(filter.SearchQuery)
	return !strings.ContainsAny(query, "%_\x1f")
}

// PrefersEventProjection identifies event count/page requests that must scan
// row attributes. A time-only request is already served efficiently by the
// usage_events timestamp index and avoids the projection's two-step detail
// lookup; scoped requests benefit from scanning the narrow projection first.
func PrefersEventProjection(filter AnalyticsFilter) bool {
	return strings.TrimSpace(filter.SearchQuery) != "" ||
		strings.TrimSpace(filter.SearchAPIKeyHash) != "" ||
		len(filter.Models) > 0 ||
		len(filter.Providers) > 0 ||
		len(filter.Accounts) > 0 ||
		len(filter.CredentialIDs) > 0 ||
		len(filter.AuthFiles) > 0 ||
		len(filter.AuthIndices) > 0 ||
		len(filter.APIKeyHashes) > 0 ||
		len(filter.SourceHashes) > 0 ||
		len(filter.ProjectIDs) > 0 ||
		len(filter.RequestTypes) > 0 ||
		len(filter.HeaderErrorKinds) > 0 ||
		len(filter.HeaderErrorCodes) > 0 ||
		len(filter.HeaderQuotaPlans) > 0 ||
		len(filter.HeaderTraceIDs) > 0 ||
		!filter.IncludeFailed ||
		filter.FailedOnly ||
		filter.MinLatencyMS > 0 ||
		strings.TrimSpace(filter.CacheStatus) != ""
}

func SupportsSelectorFilter(filter AnalyticsFilter) bool {
	return strings.TrimSpace(filter.SearchQuery) == "" &&
		strings.TrimSpace(filter.SearchAPIKeyHash) == "" &&
		len(filter.Models) == 0 &&
		len(filter.Providers) == 0 &&
		len(filter.Accounts) == 0 &&
		len(filter.CredentialIDs) == 0 &&
		len(filter.AuthFiles) == 0 &&
		len(filter.AuthIndices) == 0 &&
		len(filter.APIKeyHashes) == 0 &&
		len(filter.SourceHashes) == 0 &&
		len(filter.ProjectIDs) == 0 &&
		len(filter.RequestTypes) == 0 &&
		len(filter.HeaderErrorKinds) == 0 &&
		len(filter.HeaderErrorCodes) == 0 &&
		len(filter.HeaderQuotaPlans) == 0 &&
		len(filter.HeaderTraceIDs) == 0 &&
		filter.IncludeFailed &&
		!filter.FailedOnly &&
		filter.MinLatencyMS == 0 &&
		strings.TrimSpace(filter.CacheStatus) == ""
}

func storedStatsConditions(filter AnalyticsFilter, revision string, fromMS, toMS int64) ([]string, []any) {
	conditions := []string{"structure_revision = ?", "bucket_ms >= ?", "bucket_ms < ?"}
	args := []any{revision, fromMS, toMS}
	appendStatsScopeConditions(filter, "", &conditions, &args)
	return conditions, args
}

func rawStatsConditions(filter AnalyticsFilter, fromMS, toMS, afterID int64, useAfterID bool) ([]string, []any) {
	conditions := []string{"e.timestamp_ms >= ?", "e.timestamp_ms < ?"}
	args := []any{fromMS, toMS}
	if useAfterID {
		conditions = append(conditions, "e.id > ?")
		args = append(args, afterID)
	}
	appendStatsScopeConditions(filter, "e.", &conditions, &args)
	return conditions, args
}

func appendStatsScopeConditions(filter AnalyticsFilter, prefix string, conditions *[]string, args *[]any) {
	column := func(name string) string { return prefix + name }
	addInCondition := func(expression string, values []string) {
		normalized := normalizeFilterValues(values)
		if len(normalized) == 0 {
			return
		}
		*conditions = append(*conditions, fmt.Sprintf("coalesce(%s, '') in (select value from json_each(?))", expression))
		*args = append(*args, encodeJSONFilterValues(normalized))
	}

	hash := strings.TrimSpace(strings.ToLower(filter.SearchAPIKeyHash))
	if hash != "" {
		*conditions = append(*conditions, "lower(coalesce("+column("api_key_hash")+", '')) = ?")
		*args = append(*args, hash)
	}
	addInCondition(column("model"), filter.Models)
	addProviderStatsCondition(filter.Providers, prefix, conditions, args)
	addAccountStatsCondition(filter.Accounts, prefix, conditions, args)
	credentialExpr := fmt.Sprintf("coalesce(nullif(%sauth_file_snapshot, ''), nullif(%sauth_index, ''), nullif(%ssource_hash, ''), nullif(%ssource, ''), '-')", prefix, prefix, prefix, prefix)
	addInCondition(credentialExpr, filter.CredentialIDs)
	addInCondition(column("auth_file_snapshot"), filter.AuthFiles)
	addInCondition(column("auth_index"), filter.AuthIndices)
	addInCondition(column("api_key_hash"), filter.APIKeyHashes)
	addInCondition(column("source_hash"), filter.SourceHashes)
	addInCondition(column("executor_type"), filter.RequestTypes)
	if !filter.IncludeFailed {
		*conditions = append(*conditions, column("failed")+" = 0")
	}
	if filter.FailedOnly {
		*conditions = append(*conditions, column("failed")+" = 1")
	}
}

func addProviderStatsCondition(values []string, prefix string, conditions *[]string, args *[]any) {
	normalized := normalizeLowerFilterValues(values)
	if len(normalized) == 0 {
		return
	}
	encoded := encodeJSONFilterValues(normalized)
	providerConditions := []string{
		"lower(coalesce(" + prefix + "provider, '')) in (select value from json_each(?))",
		"lower(coalesce(" + prefix + "auth_provider_snapshot, '')) in (select value from json_each(?))",
	}
	*conditions = append(*conditions, "("+strings.Join(providerConditions, " or ")+")")
	for range providerConditions {
		*args = append(*args, encoded)
	}
}

func addAccountStatsCondition(values []string, prefix string, conditions *[]string, args *[]any) {
	normalized := normalizeLowerFilterValues(values)
	if len(normalized) == 0 {
		return
	}
	encoded := encodeJSONFilterValues(normalized)
	accountConditions := []string{
		"lower(coalesce(" + prefix + "account_snapshot, '')) in (select value from json_each(?))",
		"lower(coalesce(" + prefix + "auth_label_snapshot, '')) in (select value from json_each(?))",
		"lower(coalesce(" + prefix + "source, '')) in (select value from json_each(?))",
		"lower(coalesce(" + prefix + "auth_index, '')) in (select value from json_each(?))",
	}
	*conditions = append(*conditions, "("+strings.Join(accountConditions, " or ")+")")
	for range accountConditions {
		*args = append(*args, encoded)
	}
}

func encodeJSONFilterValues(values []string) string {
	encoded, _ := json.Marshal(values)
	return string(encoded)
}

func normalizeFilterValues(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func normalizeLowerFilterValues(values []string) []string {
	normalized := normalizeFilterValues(values)
	for index, value := range normalized {
		normalized[index] = strings.ToLower(value)
	}
	return normalized
}
