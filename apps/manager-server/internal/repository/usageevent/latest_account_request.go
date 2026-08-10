package usageevent

import (
	"context"
	"database/sql"
	"strings"
)

// LatestAccountRequestQuery identifies one credential using the immutable
// snapshot captured with a request. AuthFileSnapshot is the primary identity;
// Source is used only for records created before auth-file snapshots existed.
type LatestAccountRequestQuery struct {
	RequestIndex     int
	AuthFileSnapshot string
	AuthIndex        string
}

// LatestAccountRequest contains the safe diagnostics needed by the credential
// list. Sensitive database-only fields such as fail_body and raw_json are
// deliberately not represented here.
type LatestAccountRequest struct {
	RequestIndex    int
	TimestampMS     int64
	Failed          bool
	FailStatusCode  sql.NullInt64
	FailSummary     string
	HeaderErrorKind string
	HeaderErrorCode string
	HeaderTraceID   string
}

func (r *repository) RecentAccountRequests(
	ctx context.Context,
	targets []LatestAccountRequestQuery,
	limit int,
) ([]LatestAccountRequest, error) {
	if len(targets) == 0 || limit <= 0 {
		return []LatestAccountRequest{}, nil
	}

	values := make([]string, 0, len(targets))
	args := make([]any, 0, len(targets)*3+1)
	for _, target := range targets {
		authFileSnapshot := strings.TrimSpace(target.AuthFileSnapshot)
		if authFileSnapshot == "" {
			continue
		}
		values = append(values, "(?, ?, ?)")
		args = append(
			args,
			target.RequestIndex,
			authFileSnapshot,
			strings.TrimSpace(target.AuthIndex),
		)
	}
	if len(values) == 0 {
		return []LatestAccountRequest{}, nil
	}
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, `with credential_targets(
	request_index, auth_file_snapshot, auth_index
) as (
	values `+strings.Join(values, ",")+`
), snapshot_candidates as (
	select
		t.request_index,
		e.id,
		e.timestamp_ms,
		e.failed,
		e.fail_status_code,
		coalesce(e.fail_summary, '') as fail_summary,
		coalesce(e.header_error_kind, '') as header_error_kind,
		coalesce(e.header_error_code, '') as header_error_code,
		coalesce(e.header_trace_id, '') as header_trace_id
	from credential_targets t
	join usage_events e
		on e.auth_file_snapshot collate nocase = t.auth_file_snapshot
		and coalesce(e.auth_index, '') collate nocase = t.auth_index
), legacy_source_candidates as (
	select
		t.request_index,
		e.id,
		e.timestamp_ms,
		e.failed,
		e.fail_status_code,
		coalesce(e.fail_summary, '') as fail_summary,
		coalesce(e.header_error_kind, '') as header_error_kind,
		coalesce(e.header_error_code, '') as header_error_code,
		coalesce(e.header_trace_id, '') as header_trace_id
	from credential_targets t
	join usage_events e
		on coalesce(e.auth_file_snapshot, '') = ''
		and e.source collate nocase = t.auth_file_snapshot
		and coalesce(e.auth_index, '') collate nocase = t.auth_index
), candidates as (
	select * from snapshot_candidates
	union all
	select * from legacy_source_candidates
), ranked as (
	select
		request_index,
		timestamp_ms,
		failed,
		fail_status_code,
		fail_summary,
		header_error_kind,
		header_error_code,
		header_trace_id,
		row_number() over (
			partition by request_index
			order by timestamp_ms desc, id desc
		) as row_number
	from candidates
)
select
	request_index,
	timestamp_ms,
	failed,
	fail_status_code,
	fail_summary,
	header_error_kind,
	header_error_code,
	header_trace_id
from ranked
where row_number <= ?
order by request_index, row_number`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	requests := make([]LatestAccountRequest, 0, len(values)*limit)
	for rows.Next() {
		var request LatestAccountRequest
		var failed int
		if err := rows.Scan(
			&request.RequestIndex,
			&request.TimestampMS,
			&failed,
			&request.FailStatusCode,
			&request.FailSummary,
			&request.HeaderErrorKind,
			&request.HeaderErrorCode,
			&request.HeaderTraceID,
		); err != nil {
			return nil, err
		}
		request.Failed = failed != 0
		requests = append(requests, request)
	}
	return requests, rows.Err()
}
