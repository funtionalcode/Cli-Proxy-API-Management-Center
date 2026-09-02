package usageidentity

import (
	"encoding/hex"
	"fmt"
	"strings"
)

// FormatVersion changes whenever the canonical account-history identity
// algorithm changes. Persistent derived rollups include this version so they
// can be rebuilt from immutable usage_events without touching raw history.
const FormatVersion = "3"

const (
	keyPrefix                    = "usage-account-history"
	codexAccountIDSnapshotPrefix = "codex-account-id:v1:"
)

// CodexAccountIDSnapshot marks a freshly observed, explicit ChatGPT account_id
// before it is stored in the legacy project-id snapshot column. Historical
// values in that column predate this provenance marker and must never be
// reinterpreted as a stable Codex account identity.
func CodexAccountIDSnapshot(accountID string) string {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return ""
	}
	return codexAccountIDSnapshotPrefix + accountID
}

// CodexAccountIDFromSnapshot returns an account id only when the snapshot has
// explicit provenance from the strict Codex account-id resolver.
func CodexAccountIDFromSnapshot(snapshot string) string {
	snapshot = strings.TrimSpace(snapshot)
	if !strings.HasPrefix(snapshot, codexAccountIDSnapshotPrefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(snapshot, codexAccountIDSnapshotPrefix))
}

// ProjectIDSnapshot returns only a real provider project snapshot. The
// pre-v3 Codex account marker is retained in immutable history for audit but
// must never be exposed as a project identifier again.
func ProjectIDSnapshot(provider, projectID string) string {
	projectID = strings.TrimSpace(projectID)
	if normalizeProvider(provider) == "codex" && CodexAccountIDFromSnapshot(projectID) != "" {
		return ""
	}
	return projectID
}

// SQLProjectIDSnapshotExpression mirrors ProjectIDSnapshot for SQL filters
// and option lists. Keep this expression equivalent to the Go helper.
func SQLProjectIDSnapshotExpression(alias string) string {
	column := func(name string) string {
		if alias == "" {
			return name
		}
		if strings.HasSuffix(alias, ".") {
			return alias + name
		}
		return alias + "." + name
	}
	provider := "lower(replace(trim(coalesce(nullif(" + column("auth_provider_snapshot") + ", ''), " + column("provider") + ", '')), '_', '-'))"
	marker := "'" + codexAccountIDSnapshotPrefix + "'"
	project := "trim(coalesce(" + column("auth_project_id_snapshot") + ", ''))"
	return "case when " + provider + " = 'codex' and substr(" + project + ", 1, length(" + marker + ")) = " + marker + " then '' else " + project + " end"
}

// Fields contains the credential snapshots available on a usage event or an
// account-history request. Display values are deliberately lower priority than
// credential identity fields so two credentials sharing an email never merge.
type Fields struct {
	AuthFileSnapshot      string
	AuthIndex             string
	AuthProviderSnapshot  string
	AuthAccountIDSnapshot string
	AuthProjectIDSnapshot string
	AccountSnapshot       string
	AuthLabelSnapshot     string
	Source                string
}

// AccountKey returns the canonical, backend-owned history key for one
// credential snapshot. The key is opaque to clients; RowKey is the response
// correlation contract.
func AccountKey(fields Fields) (string, bool) {
	provider := normalizeProvider(fields.AuthProviderSnapshot)
	if provider == "codex" {
		if accountID := strings.TrimSpace(fields.AuthAccountIDSnapshot); accountID != "" {
			return encodeKey("codex-account", provider, accountID), true
		}
	}
	return LegacyAccountKey(fields)
}

// LegacyAccountKey returns the format-v2 credential identity. Account-window
// reads use it only as an exact file/index compatibility key for Codex events
// collected before a stable account_id snapshot was available.
func LegacyAccountKey(fields Fields) (string, bool) {
	authFile := effectiveAuthFile(fields)
	authIndex := strings.TrimSpace(fields.AuthIndex)
	provider := normalizeProvider(fields.AuthProviderSnapshot)
	projectID := strings.TrimSpace(fields.AuthProjectIDSnapshot)
	if provider == "codex" && CodexAccountIDFromSnapshot(projectID) != "" {
		projectID = ""
	}
	account := strings.TrimSpace(fields.AccountSnapshot)
	label := strings.TrimSpace(fields.AuthLabelSnapshot)

	switch {
	case authFile != "" && authIndex != "":
		return encodeKey("file-index", authFile, authIndex), true
	case authFile != "" && projectID != "":
		return encodeKey("file-project", authFile, provider, projectID), true
	case authFile != "" && account != "":
		return encodeKey("file-account", authFile, provider, account), true
	case authFile != "" && label != "":
		return encodeKey("file-label", authFile, provider, label), true
	case authFile != "":
		return encodeKey("file", authFile, provider), true
	case authIndex != "":
		return encodeKey("auth-index", provider, authIndex), true
	case projectID != "":
		return encodeKey("project", provider, projectID), true
	case account != "":
		return encodeKey("account", provider, account), true
	case label != "":
		return encodeKey("label", provider, label), true
	default:
		return "", false
	}
}

func PricingStructureRevision(modelPriceRevision string) string {
	return fmt.Sprintf("model-%s:identity-%s:%s", ModelFormatVersion, FormatVersion, strings.TrimSpace(modelPriceRevision))
}

func AccountHistoryStructureRevision() string {
	return fmt.Sprintf("identity-%s:model-%s", FormatVersion, ModelFormatVersion)
}

// MonitoringProjectionStructureRevision versions the derived monitoring
// projection independently from account-history rollups. The projection's
// search document intentionally omits the historical Codex account marker
// from the project field, so changing that expression must rebuild only the
// projection/search derivation from immutable usage_events.
func MonitoringProjectionStructureRevision() string {
	return AccountHistoryStructureRevision() + ":project-v1"
}

func SQLAccountKeyExpression(alias string) string {
	column := func(name string) string {
		if alias == "" {
			return name
		}
		return alias + "." + name
	}
	trimmed := func(name string) string {
		return "trim(coalesce(" + column(name) + ", ''))"
	}

	authFileSnapshot := trimmed("auth_file_snapshot")
	authIndex := trimmed("auth_index")
	source := trimmed("source")
	account := trimmed("account_snapshot")
	label := trimmed("auth_label_snapshot")
	accountID := trimmed("auth_account_id_snapshot")
	projectID := trimmed("auth_project_id_snapshot")
	providerSource := "coalesce(nullif(" + trimmed("auth_provider_snapshot") + ", ''), " + trimmed("provider") + ", '')"
	providerNormalized := "case lower(replace(trim(" + providerSource + "), '_', '-')) " +
		"when 'x-ai' then 'xai' when 'grok' then 'xai' " +
		"else lower(replace(trim(" + providerSource + "), '_', '-')) end"
	authFile := "case when " + authFileSnapshot + " <> '' then " + authFileSnapshot +
		" when " + source + " <> '' and " + source + " <> " + account + " and " + source + " <> " + label +
		" then " + source + " else '' end"
	marker := "'" + codexAccountIDSnapshotPrefix + "'"
	legacyMarkerAccountID := "case when substr(" + projectID + ", 1, length(" + marker + ")) = " + marker +
		" then trim(substr(" + projectID + ", length(" + marker + ") + 1)) else '' end"
	codexAccountID := "case when " + providerNormalized + " = 'codex' then " + accountID + " else '' end"
	legacyProjectID := "case when " + providerNormalized + " = 'codex' and (" + accountID + " <> '' or " + legacyMarkerAccountID + " <> '') then '' else " + projectID + " end"

	hexValue := func(value string) string { return "hex(" + value + ")" }
	prefix := "'" + keyPrefix + ":" + FormatVersion + ":"
	key := func(kind string, values ...string) string {
		parts := []string{prefix + kind + ":'"}
		for index, value := range values {
			if index > 0 {
				parts = append(parts, "':'")
			}
			parts = append(parts, hexValue(value))
		}
		return strings.Join(parts, " || ")
	}

	return "case " +
		"when " + providerNormalized + " = 'codex' and " + codexAccountID + " <> '' then " + key("codex-account", providerNormalized, codexAccountID) + " " +
		"when " + authFile + " <> '' and " + authIndex + " <> '' then " + key("file-index", authFile, authIndex) + " " +
		"when " + authFile + " <> '' and " + legacyProjectID + " <> '' then " + key("file-project", authFile, providerNormalized, legacyProjectID) + " " +
		"when " + authFile + " <> '' and " + account + " <> '' then " + key("file-account", authFile, providerNormalized, account) + " " +
		"when " + authFile + " <> '' and " + label + " <> '' then " + key("file-label", authFile, providerNormalized, label) + " " +
		"when " + authFile + " <> '' then " + key("file", authFile, providerNormalized) + " " +
		"when " + authIndex + " <> '' then " + key("auth-index", providerNormalized, authIndex) + " " +
		"when " + legacyProjectID + " <> '' then " + key("project", providerNormalized, legacyProjectID) + " " +
		"when " + account + " <> '' then " + key("account", providerNormalized, account) + " " +
		"when " + label + " <> '' then " + key("label", providerNormalized, label) + " " +
		"else '' end"
}

func effectiveAuthFile(fields Fields) string {
	if value := strings.TrimSpace(fields.AuthFileSnapshot); value != "" {
		return value
	}
	source := strings.TrimSpace(fields.Source)
	if source == "" || source == strings.TrimSpace(fields.AccountSnapshot) || source == strings.TrimSpace(fields.AuthLabelSnapshot) {
		return ""
	}
	return source
}

func normalizeProvider(value string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "_", "-"))
	switch normalized {
	case "x-ai", "grok":
		return "xai"
	default:
		return normalized
	}
}

func encodeKey(kind string, values ...string) string {
	parts := make([]string, 0, len(values)+3)
	parts = append(parts, keyPrefix, FormatVersion, kind)
	for _, value := range values {
		parts = append(parts, strings.ToUpper(hex.EncodeToString([]byte(strings.TrimSpace(value)))))
	}
	return strings.Join(parts, ":")
}
