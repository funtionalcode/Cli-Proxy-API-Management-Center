package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"hash/fnv"
	"math"
	"strconv"
	"strings"
	"time"
)

const (
	AccountActionStatusPending  = "pending"
	AccountActionStatusIgnored  = "ignored"
	AccountActionStatusResolved = "resolved"
	AccountActionStatusDeleted  = "deleted"
)

type UsageHeaderSnapshot struct {
	EventHash              string         `json:"event_hash"`
	TimestampMS            int64          `json:"timestamp_ms"`
	AuthFileSnapshot       string         `json:"auth_file_snapshot,omitempty"`
	AuthIndex              string         `json:"auth_index,omitempty"`
	AccountSnapshot        string         `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot      string         `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot   string         `json:"auth_provider_snapshot,omitempty"`
	AuthProjectIDSnapshot  string         `json:"auth_project_id_snapshot,omitempty"`
	Source                 string         `json:"source,omitempty"`
	SourceHash             string         `json:"source_hash,omitempty"`
	ResponseMetadata       map[string]any `json:"response_metadata,omitempty"`
	HeaderQuotaRecoverAtMS *int64         `json:"header_quota_recover_at_ms,omitempty"`
	HeaderQuotaUsedPercent *float64       `json:"header_quota_used_percent,omitempty"`
	HeaderQuotaPlanType    string         `json:"header_quota_plan_type,omitempty"`
	HeaderErrorKind        string         `json:"header_error_kind,omitempty"`
	HeaderErrorCode        string         `json:"header_error_code,omitempty"`
	HeaderTraceID          string         `json:"header_trace_id,omitempty"`
}

type UsageHeaderSnapshotsResponse struct {
	GeneratedAtMS int64                 `json:"generated_at_ms"`
	FromMS        int64                 `json:"from_ms"`
	ToMS          int64                 `json:"to_ms"`
	Items         []UsageHeaderSnapshot `json:"items"`
}

type AccountActionCandidate struct {
	ID                int64          `json:"id"`
	ActionType        string         `json:"actionType"`
	Status            string         `json:"status"`
	Provider          string         `json:"provider,omitempty"`
	AuthFileName      string         `json:"authFileName"`
	AuthIndex         string         `json:"authIndex,omitempty"`
	AccountSnapshot   string         `json:"accountSnapshot,omitempty"`
	AccountIDSnapshot string         `json:"accountIdSnapshot,omitempty"`
	AuthLabel         string         `json:"authLabel,omitempty"`
	Reason            string         `json:"reason"`
	Evidence          map[string]any `json:"evidence,omitempty"`
	LastError         string         `json:"lastError,omitempty"`
	FirstSeenAtMS     int64          `json:"firstSeenAtMs"`
	LastSeenAtMS      int64          `json:"lastSeenAtMs"`
	HitCount          int64          `json:"hitCount"`
	CreatedAtMS       int64          `json:"createdAtMs"`
	UpdatedAtMS       int64          `json:"updatedAtMs"`
}

type AccountActionCandidatesResponse struct {
	Items        []AccountActionCandidate `json:"items"`
	PendingCount int                      `json:"pendingCount"`
}

func (s *Store) HeaderSnapshots(ctx context.Context, fromMS int64, toMS int64, limit int) (UsageHeaderSnapshotsResponse, error) {
	if toMS <= 0 {
		toMS = time.Now().UnixMilli()
	}
	if fromMS <= 0 {
		fromMS = toMS - int64(30*24*time.Hour/time.Millisecond)
	}
	if limit <= 0 {
		limit = 1000
	}
	if limit > 5000 {
		limit = 5000
	}

	rows, err := s.db.QueryContext(ctx, `select
		event_hash, timestamp_ms, auth_file_snapshot, auth_index, account_snapshot,
		auth_label_snapshot, auth_provider_snapshot, auth_project_id_snapshot,
		source, source_hash, raw_json
		from usage_events
		where timestamp_ms >= ? and timestamp_ms <= ? and coalesce(raw_json, '') != ''
		order by timestamp_ms desc, id desc
		limit ?`, fromMS, toMS, limit)
	if err != nil {
		return UsageHeaderSnapshotsResponse{}, err
	}
	defer rows.Close()

	items := make([]UsageHeaderSnapshot, 0)
	for rows.Next() {
		var item UsageHeaderSnapshot
		var authFileSnapshot, authIndex, accountSnapshot, authLabelSnapshot, authProviderSnapshot, authProjectIDSnapshot, source, sourceHash, rawJSON sql.NullString
		if err := rows.Scan(
			&item.EventHash,
			&item.TimestampMS,
			&authFileSnapshot,
			&authIndex,
			&accountSnapshot,
			&authLabelSnapshot,
			&authProviderSnapshot,
			&authProjectIDSnapshot,
			&source,
			&sourceHash,
			&rawJSON,
		); err != nil {
			return UsageHeaderSnapshotsResponse{}, err
		}
		metadata := responseMetadataFromRawJSON(rawJSON.String)
		if len(metadata) == 0 {
			continue
		}
		item.AuthFileSnapshot = authFileSnapshot.String
		item.AuthIndex = authIndex.String
		item.AccountSnapshot = accountSnapshot.String
		item.AuthLabelSnapshot = authLabelSnapshot.String
		item.AuthProviderSnapshot = authProviderSnapshot.String
		item.AuthProjectIDSnapshot = authProjectIDSnapshot.String
		item.Source = source.String
		item.SourceHash = sourceHash.String
		item.ResponseMetadata = metadata
		item.HeaderQuotaRecoverAtMS = readNestedIntPtr(metadata, "quota", "recover_at_ms")
		item.HeaderQuotaUsedPercent = readNestedFloatPtr(metadata, "quota", "used_percent")
		item.HeaderQuotaPlanType = readNestedString(metadata, "quota", "plan_type")
		item.HeaderErrorKind = readNestedString(metadata, "errors", "kind")
		item.HeaderErrorCode = firstNonEmpty(
			readNestedString(metadata, "errors", "code"),
			readNestedString(metadata, "errors", "ide_root_error_code"),
			readNestedString(metadata, "errors", "ide_error_code"),
			readNestedString(metadata, "errors", "authorization_error"),
		)
		item.HeaderTraceID = readNestedString(metadata, "trace", "primary_trace_id")
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return UsageHeaderSnapshotsResponse{}, err
	}

	return UsageHeaderSnapshotsResponse{
		GeneratedAtMS: time.Now().UnixMilli(),
		FromMS:        fromMS,
		ToMS:          toMS,
		Items:         items,
	}, nil
}

func (s *Store) ListAccountActionCandidates(ctx context.Context, status string, limit int) (AccountActionCandidatesResponse, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	nowMS := time.Now().UnixMilli()
	snapshots, err := s.HeaderSnapshots(ctx, nowMS-int64(30*24*time.Hour/time.Millisecond), nowMS, 5000)
	if err != nil {
		return AccountActionCandidatesResponse{}, err
	}
	statuses, err := s.loadAccountActionStatuses(ctx)
	if err != nil {
		return AccountActionCandidatesResponse{}, err
	}

	byID := map[int64]*AccountActionCandidate{}
	for _, snapshot := range snapshots.Items {
		candidate, ok := candidateFromHeaderSnapshot(snapshot)
		if !ok {
			continue
		}
		if savedStatus := statuses[candidate.ID]; savedStatus != "" {
			candidate.Status = savedStatus
		}
		existing := byID[candidate.ID]
		if existing == nil {
			byID[candidate.ID] = &candidate
			continue
		}
		existing.HitCount++
		if candidate.LastSeenAtMS > existing.LastSeenAtMS {
			existing.LastSeenAtMS = candidate.LastSeenAtMS
			existing.UpdatedAtMS = candidate.UpdatedAtMS
			existing.Evidence = candidate.Evidence
			existing.LastError = candidate.LastError
		}
		if candidate.FirstSeenAtMS < existing.FirstSeenAtMS {
			existing.FirstSeenAtMS = candidate.FirstSeenAtMS
		}
	}

	all := make([]AccountActionCandidate, 0, len(byID))
	pendingCount := 0
	for _, candidate := range byID {
		if candidate.Status == AccountActionStatusPending {
			pendingCount++
		}
		if status != "" && candidate.Status != status {
			continue
		}
		all = append(all, *candidate)
	}
	sortAccountActionCandidates(all)
	if len(all) > limit {
		all = all[:limit]
	}
	return AccountActionCandidatesResponse{Items: all, PendingCount: pendingCount}, nil
}

func (s *Store) UpdateAccountActionCandidateStatus(ctx context.Context, id int64, status string) error {
	switch status {
	case AccountActionStatusPending, AccountActionStatusIgnored, AccountActionStatusResolved, AccountActionStatusDeleted:
	default:
		return sql.ErrNoRows
	}
	_, err := s.db.ExecContext(ctx, `insert into account_action_candidate_statuses(id, status, updated_at_ms)
		values(?, ?, ?)
		on conflict(id) do update set status = excluded.status, updated_at_ms = excluded.updated_at_ms`,
		id,
		status,
		time.Now().UnixMilli(),
	)
	return err
}

func (s *Store) loadAccountActionStatuses(ctx context.Context) (map[int64]string, error) {
	rows, err := s.db.QueryContext(ctx, `select id, status from account_action_candidate_statuses`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[int64]string{}
	for rows.Next() {
		var id int64
		var status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, err
		}
		result[id] = status
	}
	return result, rows.Err()
}

func candidateFromHeaderSnapshot(snapshot UsageHeaderSnapshot) (AccountActionCandidate, bool) {
	errorKind := strings.TrimSpace(snapshot.HeaderErrorKind)
	errorCode := strings.TrimSpace(snapshot.HeaderErrorCode)
	if errorKind == "" && errorCode == "" {
		return AccountActionCandidate{}, false
	}
	authFile := firstNonEmpty(snapshot.AuthFileSnapshot, snapshot.AuthIndex, snapshot.AccountSnapshot, snapshot.Source, "-")
	fingerprint := strings.Join([]string{
		authFile,
		snapshot.AuthIndex,
		snapshot.AccountSnapshot,
		snapshot.AuthProviderSnapshot,
		errorKind,
		errorCode,
	}, "\x00")
	reason := firstNonEmpty(errorKind, errorCode, "auth_issue")
	evidence := map[string]any{
		"eventHash":        snapshot.EventHash,
		"headerErrorKind":  errorKind,
		"headerErrorCode":  errorCode,
		"headerTraceId":    snapshot.HeaderTraceID,
		"timestampMs":      snapshot.TimestampMS,
		"responseMetadata": snapshot.ResponseMetadata,
	}
	return AccountActionCandidate{
		ID:                stablePositiveID(fingerprint),
		ActionType:        accountActionTypeForError(errorKind, errorCode),
		Status:            AccountActionStatusPending,
		Provider:          snapshot.AuthProviderSnapshot,
		AuthFileName:      authFile,
		AuthIndex:         snapshot.AuthIndex,
		AccountSnapshot:   snapshot.AccountSnapshot,
		AccountIDSnapshot: snapshot.AuthProjectIDSnapshot,
		AuthLabel:         snapshot.AuthLabelSnapshot,
		Reason:            reason,
		Evidence:          evidence,
		LastError:         reason,
		FirstSeenAtMS:     snapshot.TimestampMS,
		LastSeenAtMS:      snapshot.TimestampMS,
		HitCount:          1,
		CreatedAtMS:       snapshot.TimestampMS,
		UpdatedAtMS:       snapshot.TimestampMS,
	}, true
}

func accountActionTypeForError(values ...string) string {
	joined := strings.ToLower(strings.Join(values, " "))
	switch {
	case strings.Contains(joined, "auth"), strings.Contains(joined, "login"), strings.Contains(joined, "unauthor"), strings.Contains(joined, "invalid"):
		return "reauth"
	case strings.Contains(joined, "delet"), strings.Contains(joined, "disabled"), strings.Contains(joined, "workspace"):
		return "delete"
	default:
		return "review"
	}
}

func responseMetadataFromRawJSON(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		return nil
	}
	for _, key := range []string{"response_metadata", "responseMetadata"} {
		if metadata, ok := record[key].(map[string]any); ok {
			return metadata
		}
	}
	return nil
}

func readNestedString(record map[string]any, keys ...string) string {
	value := readNestedValue(record, keys...)
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strings.TrimSpace(formatJSONNumber(typed))
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func readNestedIntPtr(record map[string]any, keys ...string) *int64 {
	value := readNestedValue(record, keys...)
	switch typed := value.(type) {
	case float64:
		result := int64(typed)
		return &result
	case int64:
		return &typed
	case int:
		result := int64(typed)
		return &result
	default:
		return nil
	}
}

func readNestedFloatPtr(record map[string]any, keys ...string) *float64 {
	value := readNestedValue(record, keys...)
	switch typed := value.(type) {
	case float64:
		return &typed
	case int64:
		result := float64(typed)
		return &result
	case int:
		result := float64(typed)
		return &result
	default:
		return nil
	}
}

func readNestedValue(record map[string]any, keys ...string) any {
	var current any = record
	for _, key := range keys {
		asMap, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = asMap[key]
	}
	return current
}

func stablePositiveID(value string) int64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(value))
	return int64(hash.Sum64() & uint64(math.MaxInt64))
}

func sortAccountActionCandidates(items []AccountActionCandidate) {
	for i := 0; i < len(items)-1; i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].LastSeenAtMS > items[i].LastSeenAtMS ||
				(items[j].LastSeenAtMS == items[i].LastSeenAtMS && items[j].ID < items[i].ID) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func formatJSONNumber(value float64) string {
	if value == float64(int64(value)) {
		return strconv.FormatInt(int64(value), 10)
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}
