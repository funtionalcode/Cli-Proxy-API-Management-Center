import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexQuotaState } from '@/types';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const createMemoryStorage = (): StorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

const readPersistedCodexQuota = async () => {
  const { STORAGE_KEY_QUOTA_CACHE } = await import('@/utils/constants');
  const { obfuscatedStorage } = await import('@/services/storage/secureStorage');
  const persisted = obfuscatedStorage.getItem<{
    state?: { codexQuota?: Record<string, CodexQuotaState> };
  }>(STORAGE_KEY_QUOTA_CACHE);
  return persisted?.state?.codexQuota ?? {};
};

describe('useQuotaStore persistence', () => {
  let storage: StorageLike;

  beforeEach(() => {
    vi.resetModules();
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists only manually fetched Codex success states', async () => {
    const { useQuotaStore } = await import('./useQuotaStore');

    useQuotaStore.getState().setCodexQuota({
      manual: {
        status: 'success',
        windows: [],
        fetchedAtMs: 2_000,
      },
      observed: {
        status: 'success',
        windows: [],
        observedFromUsageHeaders: true,
        observedAtMs: 1_000,
      },
      failed: {
        status: 'error',
        windows: [],
        error: 'failed',
      },
    });

    expect(Object.keys(await readPersistedCodexQuota())).toEqual(['manual']);
  });

  it('clears quota state and persisted quota cache together', async () => {
    const { useQuotaStore } = await import('./useQuotaStore');

    useQuotaStore.getState().setCodexQuota({
      manual: {
        status: 'success',
        windows: [],
        fetchedAtMs: 2_000,
      },
    });

    useQuotaStore.getState().clearQuotaCache();

    expect(useQuotaStore.getState().codexQuota).toEqual({});
    expect(await readPersistedCodexQuota()).toEqual({});
  });
});
