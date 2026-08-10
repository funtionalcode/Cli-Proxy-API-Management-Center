package usagemonitoring

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func monitoringBandedEventsCTE(whereClause string) string {
	return fmt.Sprintf(`with base_events as (
		select
			e.*,
			coalesce(nullif(e.resolved_model, ''), e.model) as billing_model_value,
			coalesce(e.normalized_total_input_tokens, e.input_tokens, 0) as normalized_input_tokens_value,
			max(
				max(coalesce(e.cached_tokens, 0), coalesce(e.cache_tokens, 0)) -
				max(coalesce(e.cache_read_tokens, 0), 0) -
				max(coalesce(e.cache_creation_tokens, 0), 0),
				0
			) as compatible_cached_tokens_value
		from usage_events e
		where %s
	), priced_events as (
		select
			base_events.*,
			case
				when billing_price.model is not null then billing_model_value
				when display_price.model is not null then base_events.model
				else billing_model_value
			end as pricing_model_value
		from base_events
		left join model_prices billing_price on billing_price.model = base_events.billing_model_value
		left join model_prices display_price on display_price.model = base_events.model
	), banded_events as (
		select
			priced_events.*,
			coalesce((
				select max(tier.threshold_tokens)
				from model_price_context_tiers tier
				where tier.model = priced_events.pricing_model_value
					and priced_events.normalized_input_tokens_value > tier.threshold_tokens
			), %d) as context_threshold_tokens_value
		from priced_events
	)`, whereClause, model.ModelPriceBaseContextThreshold)
}

func upsertAccountDailyBatch(ctx context.Context, tx *sql.Tx, revision string, afterID, throughID, nowMS int64) error {
	query := monitoringBandedEventsCTE("e.id > ? and e.id <= ?") + fmt.Sprintf(`
	insert into usage_monitoring_account_daily_rollups_v1 (
		structure_revision, bucket_ms, account_snapshot, auth_label_snapshot,
		provider, auth_provider_snapshot, auth_index, source, source_hash,
		auth_file_snapshot, api_key_hash, executor_type, model, billing_model,
			pricing_model, service_tier, context_threshold_tokens, failed, calls,
			input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens,
			cache_creation_tokens, long_input_tokens, long_output_tokens,
			long_cached_tokens, long_cache_read_tokens, long_cache_creation_tokens,
			total_tokens, zero_token_calls, latency_sum_ms, latency_samples,
			last_seen_ms, updated_at_ms
	)
	select
		?,
		timestamp_ms - (timestamp_ms %% %d),
		coalesce(account_snapshot, ''),
		coalesce(auth_label_snapshot, ''),
		coalesce(provider, ''),
		coalesce(auth_provider_snapshot, ''),
		coalesce(auth_index, ''),
		coalesce(source, ''),
		coalesce(source_hash, ''),
		coalesce(auth_file_snapshot, ''),
		coalesce(api_key_hash, ''),
		coalesce(executor_type, ''),
		model,
		billing_model_value,
		pricing_model_value,
		coalesce(service_tier, ''),
		context_threshold_tokens_value,
		failed,
		count(*),
			coalesce(sum(normalized_input_tokens_value), 0),
			coalesce(sum(output_tokens), 0),
			coalesce(sum(reasoning_tokens), 0),
			coalesce(sum(compatible_cached_tokens_value), 0),
		coalesce(sum(cache_read_tokens), 0),
		coalesce(sum(cache_creation_tokens), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then normalized_input_tokens_value else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then output_tokens else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then compatible_cached_tokens_value else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then cache_read_tokens else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then cache_creation_tokens else 0 end), 0),
			coalesce(sum(total_tokens), 0),
			coalesce(sum(case when total_tokens = 0 and failed = 0 then 1 else 0 end), 0),
			coalesce(sum(case when latency_ms is not null and latency_ms != 0 then latency_ms else 0 end), 0),
		count(nullif(latency_ms, 0)),
		max(timestamp_ms),
		?
	from banded_events
	group by 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
	on conflict(
		structure_revision, bucket_ms, account_snapshot, auth_label_snapshot,
		provider, auth_provider_snapshot, auth_index, source, source_hash,
		auth_file_snapshot, api_key_hash, executor_type, model, billing_model,
		pricing_model, service_tier, context_threshold_tokens, failed
	) do update set
		calls = usage_monitoring_account_daily_rollups_v1.calls + excluded.calls,
			input_tokens = usage_monitoring_account_daily_rollups_v1.input_tokens + excluded.input_tokens,
			output_tokens = usage_monitoring_account_daily_rollups_v1.output_tokens + excluded.output_tokens,
			reasoning_tokens = usage_monitoring_account_daily_rollups_v1.reasoning_tokens + excluded.reasoning_tokens,
			cached_tokens = usage_monitoring_account_daily_rollups_v1.cached_tokens + excluded.cached_tokens,
		cache_read_tokens = usage_monitoring_account_daily_rollups_v1.cache_read_tokens + excluded.cache_read_tokens,
		cache_creation_tokens = usage_monitoring_account_daily_rollups_v1.cache_creation_tokens + excluded.cache_creation_tokens,
		long_input_tokens = usage_monitoring_account_daily_rollups_v1.long_input_tokens + excluded.long_input_tokens,
		long_output_tokens = usage_monitoring_account_daily_rollups_v1.long_output_tokens + excluded.long_output_tokens,
		long_cached_tokens = usage_monitoring_account_daily_rollups_v1.long_cached_tokens + excluded.long_cached_tokens,
		long_cache_read_tokens = usage_monitoring_account_daily_rollups_v1.long_cache_read_tokens + excluded.long_cache_read_tokens,
		long_cache_creation_tokens = usage_monitoring_account_daily_rollups_v1.long_cache_creation_tokens + excluded.long_cache_creation_tokens,
			total_tokens = usage_monitoring_account_daily_rollups_v1.total_tokens + excluded.total_tokens,
			zero_token_calls = usage_monitoring_account_daily_rollups_v1.zero_token_calls + excluded.zero_token_calls,
			latency_sum_ms = usage_monitoring_account_daily_rollups_v1.latency_sum_ms + excluded.latency_sum_ms,
		latency_samples = usage_monitoring_account_daily_rollups_v1.latency_samples + excluded.latency_samples,
		last_seen_ms = max(usage_monitoring_account_daily_rollups_v1.last_seen_ms, excluded.last_seen_ms),
		updated_at_ms = excluded.updated_at_ms`,
		dayMS,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
	)
	_, err := tx.ExecContext(ctx, query, afterID, throughID, revision, nowMS)
	return err
}

func upsertAPIKeyDailyBatch(ctx context.Context, tx *sql.Tx, revision string, afterID, throughID, nowMS int64) error {
	query := monitoringBandedEventsCTE("e.id > ? and e.id <= ?") + fmt.Sprintf(`
	insert into usage_monitoring_api_key_daily_rollups_v1 (
		structure_revision, bucket_ms, api_key_hash, account_snapshot,
		auth_label_snapshot, provider, auth_provider_snapshot, auth_index,
		source, source_hash, auth_file_snapshot, executor_type, model,
		billing_model, pricing_model, service_tier, context_threshold_tokens,
			failed, calls, input_tokens, output_tokens, cached_tokens,
			reasoning_tokens, cache_read_tokens, cache_creation_tokens, long_input_tokens,
			long_output_tokens, long_cached_tokens, long_cache_read_tokens,
			long_cache_creation_tokens, total_tokens, zero_token_calls, latency_sum_ms,
			latency_samples, last_seen_ms, updated_at_ms
	)
	select
		?,
		timestamp_ms - (timestamp_ms %% %d),
		coalesce(api_key_hash, ''),
		coalesce(account_snapshot, ''),
		coalesce(auth_label_snapshot, ''),
		coalesce(provider, ''),
		coalesce(auth_provider_snapshot, ''),
		coalesce(auth_index, ''),
		coalesce(source, ''),
		coalesce(source_hash, ''),
		coalesce(auth_file_snapshot, ''),
		coalesce(executor_type, ''),
		model,
		billing_model_value,
		pricing_model_value,
		coalesce(service_tier, ''),
		context_threshold_tokens_value,
		failed,
		count(*),
			coalesce(sum(normalized_input_tokens_value), 0),
			coalesce(sum(output_tokens), 0),
			coalesce(sum(compatible_cached_tokens_value), 0),
			coalesce(sum(reasoning_tokens), 0),
			coalesce(sum(cache_read_tokens), 0),
		coalesce(sum(cache_creation_tokens), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then normalized_input_tokens_value else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then output_tokens else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then compatible_cached_tokens_value else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then cache_read_tokens else 0 end), 0),
		coalesce(sum(case when normalized_input_tokens_value > %d then cache_creation_tokens else 0 end), 0),
			coalesce(sum(total_tokens), 0),
			coalesce(sum(case when total_tokens = 0 and failed = 0 then 1 else 0 end), 0),
			coalesce(sum(case when latency_ms is not null and latency_ms != 0 then latency_ms else 0 end), 0),
		count(nullif(latency_ms, 0)),
		max(timestamp_ms),
		?
	from banded_events
	group by 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
	on conflict(
		structure_revision, bucket_ms, api_key_hash, account_snapshot,
		auth_label_snapshot, provider, auth_provider_snapshot, auth_index,
		source, source_hash, auth_file_snapshot, executor_type, model,
		billing_model, pricing_model, service_tier, context_threshold_tokens, failed
	) do update set
		calls = usage_monitoring_api_key_daily_rollups_v1.calls + excluded.calls,
			input_tokens = usage_monitoring_api_key_daily_rollups_v1.input_tokens + excluded.input_tokens,
			output_tokens = usage_monitoring_api_key_daily_rollups_v1.output_tokens + excluded.output_tokens,
			reasoning_tokens = usage_monitoring_api_key_daily_rollups_v1.reasoning_tokens + excluded.reasoning_tokens,
			cached_tokens = usage_monitoring_api_key_daily_rollups_v1.cached_tokens + excluded.cached_tokens,
		cache_read_tokens = usage_monitoring_api_key_daily_rollups_v1.cache_read_tokens + excluded.cache_read_tokens,
		cache_creation_tokens = usage_monitoring_api_key_daily_rollups_v1.cache_creation_tokens + excluded.cache_creation_tokens,
		long_input_tokens = usage_monitoring_api_key_daily_rollups_v1.long_input_tokens + excluded.long_input_tokens,
		long_output_tokens = usage_monitoring_api_key_daily_rollups_v1.long_output_tokens + excluded.long_output_tokens,
		long_cached_tokens = usage_monitoring_api_key_daily_rollups_v1.long_cached_tokens + excluded.long_cached_tokens,
		long_cache_read_tokens = usage_monitoring_api_key_daily_rollups_v1.long_cache_read_tokens + excluded.long_cache_read_tokens,
		long_cache_creation_tokens = usage_monitoring_api_key_daily_rollups_v1.long_cache_creation_tokens + excluded.long_cache_creation_tokens,
			total_tokens = usage_monitoring_api_key_daily_rollups_v1.total_tokens + excluded.total_tokens,
			zero_token_calls = usage_monitoring_api_key_daily_rollups_v1.zero_token_calls + excluded.zero_token_calls,
			latency_sum_ms = usage_monitoring_api_key_daily_rollups_v1.latency_sum_ms + excluded.latency_sum_ms,
		latency_samples = usage_monitoring_api_key_daily_rollups_v1.latency_samples + excluded.latency_samples,
		last_seen_ms = max(usage_monitoring_api_key_daily_rollups_v1.last_seen_ms, excluded.last_seen_ms),
		updated_at_ms = excluded.updated_at_ms`,
		dayMS,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
		usage.LongContextInputTokenThreshold,
	)
	_, err := tx.ExecContext(ctx, query, afterID, throughID, revision, nowMS)
	return err
}
