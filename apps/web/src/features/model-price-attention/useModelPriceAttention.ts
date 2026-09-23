import { useEffect, useSyncExternalStore } from 'react';
import { usePanelFeatureAvailability } from '@/hooks/usePanelFeatureAvailability';
import { useAuthStore } from '@/stores';
import {
  sharedModelPriceAttentionStore,
  type ModelPriceAttentionStore,
} from './modelPriceAttention';
import type {
  ModelPriceAttentionState,
  ModelPriceAttentionSnapshot,
} from './modelPriceAttentionTypes';

export interface UseModelPriceAttentionOptions {
  store?: ModelPriceAttentionStore;
}

export interface UseModelPriceAttentionResult extends ModelPriceAttentionState {
  pendingCount: number;
  hasAttention: boolean;
  modelPricesAvailable: boolean;
  check: (options?: { force?: boolean }) => Promise<void>;
  capturePendingSnapshot: () => ModelPriceAttentionSnapshot;
  acknowledgeSnapshot: (snapshot: ModelPriceAttentionSnapshot | string[]) => Promise<void>;
}

export function useModelPriceAttention(
  options: UseModelPriceAttentionOptions = {}
): UseModelPriceAttentionResult {
  const store = options.store ?? sharedModelPriceAttentionStore;
  const featureAvailability = usePanelFeatureAvailability();
  const managementKey = useAuthStore((state) => state.managementKey);

  const base = featureAvailability.modelPricesAvailable
    ? featureAvailability.managerServiceBase
    : '';
  const modelPricesAvailable = featureAvailability.modelPricesAvailable;

  useEffect(() => {
    store.configure({
      base,
      managementKey,
      modelPricesAvailable,
    });
    if (modelPricesAvailable && base) {
      void store.check();
    }
  }, [base, managementKey, modelPricesAvailable, store]);

  const state = useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.getState(),
    () => store.getState()
  );

  return {
    ...state,
    pendingCount: state.pendingModels.length,
    hasAttention: modelPricesAvailable && state.pendingModels.length > 0,
    modelPricesAvailable,
    check: (checkOptions) => store.check(checkOptions),
    capturePendingSnapshot: () => store.capturePendingSnapshot(),
    acknowledgeSnapshot: (snapshot) => store.acknowledgeSnapshot(snapshot),
  };
}
