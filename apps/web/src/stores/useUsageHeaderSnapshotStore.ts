import { create } from 'zustand';
import type {
  UsageHeaderSnapshot,
  UsageHeaderSnapshotsResponse,
} from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';

interface UsageHeaderSnapshotState {
  scopeKey: string;
  items: UsageHeaderSnapshot[];
  generatedAtMs: number;
  loadedAtMs: number;
  contentRevision: string;
  activateScope: (scopeKey: string) => boolean;
  commitResponse: (scopeKey: string, response: UsageHeaderSnapshotsResponse) => boolean;
}

const emptySnapshotState = {
  items: [] as UsageHeaderSnapshot[],
  generatedAtMs: 0,
  loadedAtMs: 0,
  contentRevision: '',
};

export const buildUsageHeaderSnapshotScopeKey = (
  serviceBase: string,
  managementKey: string
): string => {
  const normalizedBase = serviceBase.trim().replace(/\/+$/, '');
  if (!normalizedBase) return '';
  return sha256Hex(`${normalizedBase}\u0000${managementKey.trim()}`);
};

export const buildUsageHeaderSnapshotContentRevision = (items: UsageHeaderSnapshot[]): string =>
  items
    .map((item) => `${item.event_hash}\u0000${Math.trunc(item.timestamp_ms)}`)
    .sort()
    .join('\u0001');

export const useUsageHeaderSnapshotStore = create<UsageHeaderSnapshotState>((set, get) => ({
  scopeKey: '',
  ...emptySnapshotState,
  activateScope: (scopeKey) => {
    const normalizedScope = scopeKey.trim();
    if (get().scopeKey === normalizedScope) return false;
    set({ scopeKey: normalizedScope, ...emptySnapshotState });
    return true;
  },
  commitResponse: (scopeKey, response) => {
    const normalizedScope = scopeKey.trim();
    if (!normalizedScope || get().scopeKey !== normalizedScope) return false;
    const items = response.items ?? [];
    const generatedAtMs =
      Number.isFinite(response.generated_at_ms) && response.generated_at_ms > 0
        ? response.generated_at_ms
        : Date.now();
    set({
      items,
      generatedAtMs,
      loadedAtMs: Date.now(),
      contentRevision: buildUsageHeaderSnapshotContentRevision(items),
    });
    return true;
  },
}));
