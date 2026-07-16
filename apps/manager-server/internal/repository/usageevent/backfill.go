package usageevent

import (
	"context"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

const defaultResponseMetadataBackfillBatch = 1000

type responseMetadataBackfillRow struct {
	ID          int64
	TimestampMS int64
	RawJSON     string
}

func (r *repository) BackfillResponseMetadata(ctx context.Context, batchLimit int) (int, error) {
	if batchLimit <= 0 {
		batchLimit = defaultResponseMetadataBackfillBatch
	}
	rows, err := r.db.QueryContext(ctx, `select id, timestamp_ms, coalesce(raw_json, '')
from usage_events
where response_metadata_json is null
and raw_json is not null
and (raw_json like '%response_headers%' or raw_json like '%responseHeaders%')
order by id
limit ?`, batchLimit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	items := make([]responseMetadataBackfillRow, 0, batchLimit)
	for rows.Next() {
		var item responseMetadataBackfillRow
		if err := rows.Scan(&item.ID, &item.TimestampMS, &item.RawJSON); err != nil {
			return 0, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(items) == 0 {
		return 0, nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	stmt, err := tx.PrepareContext(ctx, `update usage_events set
	response_metadata_json = ?,
	header_quota_recover_at_ms = ?,
	header_quota_used_percent = ?,
	header_quota_plan_type = ?,
	header_error_kind = ?,
	header_error_code = ?,
	header_trace_id = ?
where id = ? and response_metadata_json is null`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	updated := 0
	for _, item := range items {
		metadata := usage.ParseResponseHeaderMetadataFromRawJSON(item.RawJSON, time.UnixMilli(item.TimestampMS))
		derived := usage.DeriveResponseHeaderMetadata(metadata)
		res, err := stmt.ExecContext(
			ctx,
			derived.MetadataJSON,
			nullPositiveInt64(derived.QuotaRecoverAtMS),
			nullFloat(derived.QuotaUsedPercent),
			nullString(derived.QuotaPlanType),
			nullString(derived.ErrorKind),
			nullString(derived.ErrorCode),
			nullString(derived.TraceID),
			item.ID,
		)
		if err != nil {
			return updated, err
		}
		affected, _ := res.RowsAffected()
		updated += int(affected)
	}
	if err := tx.Commit(); err != nil {
		return updated, err
	}
	return updated, nil
}
