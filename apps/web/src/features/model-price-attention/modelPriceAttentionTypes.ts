export interface ModelPriceAttentionState {
  runtimeModels: string[];
  unpricedModels: string[];
  acknowledgedModels: string[];
  pendingModels: string[];
  loading: boolean;
  lastCheckedAtMs: number | null;
}

export interface ModelPriceAttentionStorageData {
  version: 1;
  scopes: Record<
    string,
    {
      acknowledgedModels: string[];
    }
  >;
}

export interface ModelPriceAttentionSnapshot {
  scope: string;
  models: string[];
}
