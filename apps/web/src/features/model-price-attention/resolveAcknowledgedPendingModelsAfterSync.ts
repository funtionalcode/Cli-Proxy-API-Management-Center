import type { ModelPriceAttentionSnapshot } from './modelPriceAttentionTypes';

export interface ResolveAcknowledgedPendingModelsParams {
  pendingSnapshot: ModelPriceAttentionSnapshot;
  syncModels: string[];
  runtimeModelDiscoveryError?: string | null;
}

/**
 * Resolves which pending models should be acknowledged after a model price sync.
 *
 * Case A (Discovery succeeded):
 *   All pending snapshot models participated in the sync via runtime discovery,
 *   so all pending models are acknowledged.
 *
 * Case B (Discovery failed, fallback to known models succeeded):
 *   Only pending models that were already part of syncModels (saved / usage known models)
 *   actually participated in the fallback sync. Only acknowledge (pendingSnapshot ∩ syncModels).
 *   Models in (pendingSnapshot - syncModels) were never checked and must remain pending.
 */
export function resolveAcknowledgedPendingModelsAfterSync({
  pendingSnapshot,
  syncModels,
  runtimeModelDiscoveryError,
}: ResolveAcknowledgedPendingModelsParams): ModelPriceAttentionSnapshot {
  if (!pendingSnapshot || !pendingSnapshot.models || pendingSnapshot.models.length === 0) {
    return {
      scope: pendingSnapshot?.scope ?? '',
      models: [],
    };
  }

  if (!runtimeModelDiscoveryError) {
    return {
      scope: pendingSnapshot.scope,
      models: [...pendingSnapshot.models],
    };
  }

  const syncSet = new Set(syncModels);
  const acknowledgedModels = pendingSnapshot.models.filter((model) => syncSet.has(model));

  return {
    scope: pendingSnapshot.scope,
    models: acknowledgedModels,
  };
}
