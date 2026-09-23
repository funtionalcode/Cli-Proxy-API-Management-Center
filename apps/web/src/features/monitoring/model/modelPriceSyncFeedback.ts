import type { ModelPriceSyncResponse } from '@/services/api/usageService';

export interface ResolveModelPriceSyncNotificationParams {
  result: ModelPriceSyncResponse;
  syncModels: string[];
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface ModelPriceSyncNotification {
  message: string;
  type: 'success' | 'warning' | 'error';
}

export function resolveModelPriceSyncNotification({
  result,
  syncModels,
  t,
}: ResolveModelPriceSyncNotificationParams): ModelPriceSyncNotification {
  if (result.runtimeModelDiscoveryError) {
    if (syncModels.length === 0) {
      return {
        message: t('model_prices.sync_runtime_discovery_failed_empty'),
        type: 'warning',
      };
    }
    const detail = t('model_prices.sync_success_detail', {
      imported: result.imported,
      candidates: result.candidates?.length ?? 0,
      unmatched: result.unmatched?.length ?? 0,
      preserved: result.preserved?.length ?? 0,
    });
    return {
      message: `${t('model_prices.sync_runtime_discovery_failed_fallback')} ${detail}`,
      type: 'warning',
    };
  }

  const hasAnyModels =
    syncModels.length > 0 ||
    (result.runtimeModelCount ?? 0) > 0 ||
    result.imported > 0 ||
    (result.candidates?.length ?? 0) > 0 ||
    (result.unmatched?.length ?? 0) > 0;

  if (!hasAnyModels) {
    return {
      message: t('usage_stats.model_price_sync_no_models'),
      type: 'warning',
    };
  }

  return {
    message: t('model_prices.sync_success_detail', {
      imported: result.imported,
      candidates: result.candidates?.length ?? 0,
      unmatched: result.unmatched?.length ?? 0,
      preserved: result.preserved?.length ?? 0,
    }),
    type: result.preserved?.length ? 'warning' : 'success',
  };
}
