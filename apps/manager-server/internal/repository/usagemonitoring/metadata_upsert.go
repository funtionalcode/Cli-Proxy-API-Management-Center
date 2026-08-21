package usagemonitoring

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usageidentity"
)

func upsertSelectorDailyBatch(ctx context.Context, tx *sql.Tx, afterID, throughID, nowMS int64) error {
	query := fmt.Sprintf(`insert into usage_monitoring_selector_daily_rollups_v1 (
		model_format_revision, bucket_ms, model, api_key_hash, provider, auth_file_snapshot,
		account_snapshot, auth_label_snapshot, auth_index, source, source_hash,
		updated_at_ms
	)
	select
		?,
		timestamp_ms - (timestamp_ms %% %d),
		`+usageidentity.SQLRequestAnalyticsModelExpression("model", "requested_model")+`,
		coalesce(api_key_hash, ''),
		coalesce(nullif(auth_provider_snapshot, ''), nullif(provider, ''), ''),
		coalesce(auth_file_snapshot, ''),
		coalesce(account_snapshot, ''),
		coalesce(auth_label_snapshot, ''),
		coalesce(auth_index, ''),
		coalesce(max(source), ''),
		coalesce(source_hash, ''),
		?
	from usage_events
	where id > ? and id <= ?
	group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 11
	on conflict(
		bucket_ms, model, api_key_hash, provider, auth_file_snapshot,
		account_snapshot, auth_label_snapshot, auth_index, source_hash
	) do update set
		source = max(usage_monitoring_selector_daily_rollups_v1.source, excluded.source),
		model_format_revision = excluded.model_format_revision,
		updated_at_ms = excluded.updated_at_ms`, dayMS)
	_, err := tx.ExecContext(ctx, query, usageidentity.ModelFormatVersion, nowMS, afterID, throughID)
	return err
}
