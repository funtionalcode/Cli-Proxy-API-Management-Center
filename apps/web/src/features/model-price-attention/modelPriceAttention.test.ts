import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { ModelPriceAttentionStore } from './modelPriceAttention';
import type { RuntimeModelPricingStatusResponse } from '@/services/api/usageService';

type GetRuntimeModelPricingStatusFn = (
  base: string,
  managementKey?: string,
  signal?: AbortSignal
) => Promise<RuntimeModelPricingStatusResponse>;

describe('ModelPriceAttentionStore', () => {
  class MockStorage implements Storage {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear() {
      this.store.clear();
    }
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number) {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    setItem(key: string, value: string) {
      this.store.set(key, value);
    }
  }

  let storage: MockStorage;
  let mockApi: {
    getRuntimeModelPricingStatus: Mock<GetRuntimeModelPricingStatusFn>;
  };

  const base = 'http://localhost:18317';

  beforeEach(() => {
    storage = new MockStorage();
    mockApi = {
      getRuntimeModelPricingStatus: vi.fn<GetRuntimeModelPricingStatusFn>(),
    };
  });

  it('calculates pending models as unpriced minus acknowledged', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    const response: RuntimeModelPricingStatusResponse = {
      models: ['gpt-5.6-sol', 'gpt-6-sol'],
      unpricedModels: ['gpt-6-sol'],
      count: 2,
      unpricedCount: 1,
    };
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce(response);

    await store.check({ force: true });

    const state = store.getState();
    // gpt-5.6-sol is priced, so it was auto-acknowledged
    expect(state.acknowledgedModels).toContain('gpt-5.6-sol');
    expect(state.pendingModels).toEqual(['gpt-6-sol']);
  });

  it('auto-acknowledges runtime models that already have explicit prices', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    // All runtime models already priced
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['model-a', 'model-b'],
      unpricedModels: [],
      count: 2,
      unpricedCount: 0,
    });

    await store.check({ force: true });

    const state = store.getState();
    expect(state.acknowledgedModels).toEqual(['model-a', 'model-b']);
    expect(state.pendingModels).toEqual([]);
  });

  it('preserves existing pending models on discovery failure', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['gpt-6-sol'],
      unpricedModels: ['gpt-6-sol'],
      count: 1,
      unpricedCount: 1,
    });

    await store.check({ force: true });
    expect(store.getState().pendingModels).toEqual(['gpt-6-sol']);

    // Next check fails
    mockApi.getRuntimeModelPricingStatus.mockRejectedValueOnce(new Error('Network error'));
    await store.check({ force: true });

    // Pending models are not wiped
    expect(store.getState().pendingModels).toEqual(['gpt-6-sol']);
    expect(store.getState().loading).toBe(false);
  });

  it('acknowledges snapshot after sync and clears attention', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['gpt-6-sol'],
      unpricedModels: ['gpt-6-sol'],
      count: 1,
      unpricedCount: 1,
    });

    await store.check({ force: true });
    expect(store.getState().pendingModels).toEqual(['gpt-6-sol']);

    // Capture snapshot at sync start
    const snapshot = store.capturePendingSnapshot();
    expect(snapshot).toEqual({
      scope: base,
      models: ['gpt-6-sol'],
    });

    // Simulate successful sync completion: status refreshed and now gpt-6-sol may be priced or unpriced (unmatched)
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['gpt-6-sol'],
      unpricedModels: ['gpt-6-sol'], // unmatched, still unpriced in DB
      count: 1,
      unpricedCount: 1,
    });

    await store.acknowledgeSnapshot(snapshot);

    const state = store.getState();
    expect(state.acknowledgedModels).toContain('gpt-6-sol');
    // Global attention badge cleared because it has been checked!
    expect(state.pendingModels).toEqual([]);
  });

  it('does not acknowledge models that appeared concurrently after sync started', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['model-A'],
      unpricedModels: ['model-A'],
      count: 1,
      unpricedCount: 1,
    });

    await store.check({ force: true });
    const snapshot = store.capturePendingSnapshot(); // ['model-A']

    // Concurrently, model-B appeared in runtime
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['model-A', 'model-B'],
      unpricedModels: ['model-A', 'model-B'],
      count: 2,
      unpricedCount: 2,
    });

    await store.acknowledgeSnapshot(snapshot);

    const state = store.getState();
    expect(state.acknowledgedModels).toEqual(['model-A']);
    // model-B was NOT in snapshot, so it remains pending!
    expect(state.pendingModels).toEqual(['model-B']);
  });

  it('prevents concurrent duplicate checks', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    let resolveApi: (value: RuntimeModelPricingStatusResponse) => void;
    const pendingPromise = new Promise<RuntimeModelPricingStatusResponse>((resolve) => {
      resolveApi = resolve;
    });
    mockApi.getRuntimeModelPricingStatus.mockReturnValueOnce(pendingPromise);

    const check1 = store.check({ force: true });
    const check2 = store.check({ force: true });

    expect(mockApi.getRuntimeModelPricingStatus).toHaveBeenCalledTimes(1);

    resolveApi!({
      models: ['m1'],
      unpricedModels: ['m1'],
      count: 1,
      unpricedCount: 1,
    });

    await Promise.all([check1, check2]);
    expect(store.getState().pendingModels).toEqual(['m1']);
  });

  it('does not re-notify when a previously acknowledged model disappears and reappears', async () => {
    const store = new ModelPriceAttentionStore({
      base,
      storage,
      api: mockApi,
    });

    // 1. Initial check: model-x is unpriced
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['model-x'],
      unpricedModels: ['model-x'],
      count: 1,
      unpricedCount: 1,
    });
    await store.check({ force: true });
    expect(store.getState().pendingModels).toEqual(['model-x']);

    // 2. User acknowledges model-x
    await store.acknowledgeSnapshot(['model-x']);
    expect(store.getState().pendingModels).toEqual([]);

    // 3. Model-x disappears
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: [],
      unpricedModels: [],
      count: 0,
      unpricedCount: 0,
    });
    await store.check({ force: true });
    expect(store.getState().pendingModels).toEqual([]);

    // 4. Model-x reappears
    mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
      models: ['model-x'],
      unpricedModels: ['model-x'],
      count: 1,
      unpricedCount: 1,
    });
    await store.check({ force: true });
    // Still acknowledged, no pending notification!
    expect(store.getState().pendingModels).toEqual([]);
  });

  describe('scope management and async race guards', () => {
    it('resets volatile state immediately when scope changes, allowing fresh check on new scope', async () => {
      const store = new ModelPriceAttentionStore({
        base: 'http://server-a',
        storage,
        api: mockApi,
      });

      mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
        models: ['model-a'],
        unpricedModels: ['model-a'],
        count: 1,
        unpricedCount: 1,
      });
      await store.check({ force: true });

      const stateA = store.getState();
      expect(stateA.runtimeModels).toEqual(['model-a']);
      expect(stateA.pendingModels).toEqual(['model-a']);
      expect(stateA.lastCheckedAtMs).not.toBeNull();

      // Configure to server-b
      store.configure({
        base: 'http://server-b',
        modelPricesAvailable: true,
      });

      // Volatile state should be reset immediately
      const stateAfterSwitch = store.getState();
      expect(stateAfterSwitch.runtimeModels).toEqual([]);
      expect(stateAfterSwitch.unpricedModels).toEqual([]);
      expect(stateAfterSwitch.pendingModels).toEqual([]);
      expect(stateAfterSwitch.lastCheckedAtMs).toBeNull();
      expect(stateAfterSwitch.loading).toBe(false);

      // Fresh check on server-b should succeed immediately without force
      mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
        models: ['model-b'],
        unpricedModels: ['model-b'],
        count: 1,
        unpricedCount: 1,
      });
      await store.check();

      const stateB = store.getState();
      expect(stateB.runtimeModels).toEqual(['model-b']);
      expect(stateB.pendingModels).toEqual(['model-b']);
    });

    it('ignores stale response when scope switches while check is in-flight', async () => {
      const store = new ModelPriceAttentionStore({
        base: 'http://server-a',
        storage,
        api: mockApi,
      });

      let resolveServerA: (value: RuntimeModelPricingStatusResponse) => void;
      const pendingServerA = new Promise<RuntimeModelPricingStatusResponse>((resolve) => {
        resolveServerA = resolve;
      });
      mockApi.getRuntimeModelPricingStatus.mockReturnValueOnce(pendingServerA);

      // Start check on server-a
      const checkA = store.check({ force: true });

      // User switches to server-b while check on server-a is in flight
      store.configure({
        base: 'http://server-b',
        modelPricesAvailable: true,
      });

      // Server A finally resolves
      resolveServerA!({
        models: ['model-from-a'],
        unpricedModels: ['model-from-a'],
        count: 1,
        unpricedCount: 1,
      });
      await checkA;

      // Server B's state should NOT be modified by server A's response
      const stateB = store.getState();
      expect(stateB.runtimeModels).toEqual([]);
      expect(stateB.pendingModels).toEqual([]);
      expect(stateB.lastCheckedAtMs).toBeNull();
    });

    it('ignores snapshot acknowledgment if snapshot belongs to an older scope', async () => {
      const store = new ModelPriceAttentionStore({
        base: 'http://server-a',
        storage,
        api: mockApi,
      });

      mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
        models: ['model-a'],
        unpricedModels: ['model-a'],
        count: 1,
        unpricedCount: 1,
      });
      await store.check({ force: true });

      const snapshotA = store.capturePendingSnapshot();
      expect(snapshotA).toEqual({
        scope: 'http://server-a',
        models: ['model-a'],
      });

      // Switch to server-b
      store.configure({
        base: 'http://server-b',
        modelPricesAvailable: true,
      });

      // Acknowledging snapshotA on server-b should do nothing
      await store.acknowledgeSnapshot(snapshotA);

      expect(store.getState().acknowledgedModels).toEqual([]);
    });
  });

  describe('failed discovery retry throttling', () => {
    it('throttles automatic re-checks for 30 minutes after a failed discovery attempt, while force bypasses throttle', async () => {
      const store = new ModelPriceAttentionStore({
        base: 'http://localhost:18317',
        storage,
        api: mockApi,
        checkIntervalMs: 30 * 60 * 1000,
      });

      // 1. Initial attempt fails
      mockApi.getRuntimeModelPricingStatus.mockRejectedValueOnce(new Error('Network error'));
      await store.check();
      expect(mockApi.getRuntimeModelPricingStatus).toHaveBeenCalledTimes(1);
      expect(store.getState().lastCheckedAtMs).toBeNull();

      // 2. Regular check 1 minute later should be throttled because lastAttemptAtMs is fresh
      await store.check();
      expect(mockApi.getRuntimeModelPricingStatus).toHaveBeenCalledTimes(1);

      // 3. Force check bypasses throttle
      mockApi.getRuntimeModelPricingStatus.mockResolvedValueOnce({
        models: ['recovered-model'],
        unpricedModels: ['recovered-model'],
        count: 1,
        unpricedCount: 1,
      });
      await store.check({ force: true });
      expect(mockApi.getRuntimeModelPricingStatus).toHaveBeenCalledTimes(2);
      expect(store.getState().pendingModels).toEqual(['recovered-model']);
      expect(store.getState().lastCheckedAtMs).not.toBeNull();
    });
  });
});
