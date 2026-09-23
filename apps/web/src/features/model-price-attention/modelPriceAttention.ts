import { usageServiceApi } from '@/services/api/usageService';
import type {
  ModelPriceAttentionState,
  ModelPriceAttentionSnapshot,
} from './modelPriceAttentionTypes';
import {
  loadAcknowledgedModels,
  saveAcknowledgedModels,
} from './modelPriceAttentionStorage';

export const ATTENTION_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface AttentionStoreOptions {
  base?: string;
  managementKey?: string;
  storage?: Storage;
  api?: Pick<typeof usageServiceApi, 'getRuntimeModelPricingStatus'>;
  checkIntervalMs?: number;
}

export class ModelPriceAttentionStore {
  private base = '';
  private managementKey: string | undefined = undefined;
  private storage?: Storage;
  private api: Pick<typeof usageServiceApi, 'getRuntimeModelPricingStatus'>;
  private checkIntervalMs: number;

  private scopeGeneration = 0;
  private lastAttemptAtMs: number | null = null;

  private state: ModelPriceAttentionState = {
    runtimeModels: [],
    unpricedModels: [],
    acknowledgedModels: [],
    pendingModels: [],
    loading: false,
    lastCheckedAtMs: null,
  };

  private listeners = new Set<() => void>();
  private activeCheckPromise: Promise<void> | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private focusHandlerAttached = false;
  private boundFocusHandler: (() => void) | null = null;

  constructor(options: AttentionStoreOptions = {}) {
    this.base = options.base ?? '';
    this.managementKey = options.managementKey;
    this.storage = options.storage;
    this.api = options.api ?? usageServiceApi;
    this.checkIntervalMs = options.checkIntervalMs ?? ATTENTION_CHECK_INTERVAL_MS;

    if (this.base) {
      this.initAcknowledgedFromStorage();
    }
  }

  public configure(options: {
    base: string;
    managementKey?: string;
    modelPricesAvailable: boolean;
  }): void {
    const baseChanged = this.base !== options.base;
    if (baseChanged) {
      this.scopeGeneration += 1;
      this.base = options.base;
      this.managementKey = options.managementKey;
      this.lastAttemptAtMs = null;
      this.activeCheckPromise = null;
      this.state = {
        runtimeModels: [],
        unpricedModels: [],
        pendingModels: [],
        loading: false,
        lastCheckedAtMs: null,
        acknowledgedModels: this.base ? loadAcknowledgedModels(this.base, this.storage) : [],
      };
      this.notify();
    } else {
      this.managementKey = options.managementKey;
    }

    if (!options.modelPricesAvailable || !this.base) {
      this.stopAutoCheck();
      return;
    }

    this.ensureAutoCheck();
  }

  public getState(): ModelPriceAttentionState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Prevent listener errors from breaking store execution
      }
    });
  }

  private initAcknowledgedFromStorage(): void {
    const acknowledged = loadAcknowledgedModels(this.base, this.storage);
    const pending = this.computePending(this.state.unpricedModels, acknowledged);
    this.state = {
      ...this.state,
      acknowledgedModels: acknowledged,
      pendingModels: pending,
    };
    this.notify();
  }

  private computePending(unpriced: string[], acknowledged: string[]): string[] {
    const ackSet = new Set(acknowledged);
    return unpriced.filter((m) => !ackSet.has(m));
  }

  public isCacheExpired(): boolean {
    if (this.lastAttemptAtMs === null) return true;
    return Date.now() - this.lastAttemptAtMs >= this.checkIntervalMs;
  }

  public check(options?: { force?: boolean }): Promise<void> {
    if (!this.base) {
      return Promise.resolve();
    }

    if (!options?.force && !this.isCacheExpired()) {
      return Promise.resolve();
    }

    // Deduplicate concurrent in-flight checks
    if (this.activeCheckPromise) {
      return this.activeCheckPromise;
    }

    const requestGeneration = this.scopeGeneration;
    const requestBase = this.base;
    const requestManagementKey = this.managementKey;

    this.lastAttemptAtMs = Date.now();
    this.state = { ...this.state, loading: true };
    this.notify();

    this.activeCheckPromise = (async () => {
      try {
        const res = await this.api.getRuntimeModelPricingStatus(
          requestBase,
          requestManagementKey
        );

        // Discard stale response if scope has switched
        if (
          requestGeneration !== this.scopeGeneration ||
          requestBase !== this.base
        ) {
          return;
        }

        const runtimeModels = Array.isArray(res.models) ? res.models : [];
        const unpricedModels = Array.isArray(res.unpricedModels) ? res.unpricedModels : [];

        // Invariant: Already priced runtime models (runtimeModels \ unpricedModels)
        // are automatically treated as acknowledged.
        const currentAck = new Set(loadAcknowledgedModels(requestBase, this.storage));
        const unpricedSet = new Set(unpricedModels);
        for (const model of runtimeModels) {
          if (!unpricedSet.has(model)) {
            currentAck.add(model);
          }
        }

        const nextAcknowledged = Array.from(currentAck).sort();
        saveAcknowledgedModels(requestBase, nextAcknowledged, this.storage);

        const pending = this.computePending(unpricedModels, nextAcknowledged);

        this.state = {
          runtimeModels,
          unpricedModels,
          acknowledgedModels: nextAcknowledged,
          pendingModels: pending,
          loading: false,
          lastCheckedAtMs: Date.now(),
        };
        this.notify();
      } catch {
        if (
          requestGeneration !== this.scopeGeneration ||
          requestBase !== this.base
        ) {
          return;
        }
        // Discovery failure: do not toast, do not clear previous pending state
        this.state = {
          ...this.state,
          loading: false,
        };
        this.notify();
      } finally {
        if (requestGeneration === this.scopeGeneration) {
          this.activeCheckPromise = null;
        }
      }
    })();

    return this.activeCheckPromise;
  }

  public capturePendingSnapshot(): ModelPriceAttentionSnapshot {
    return {
      scope: this.base,
      models: [...this.state.pendingModels],
    };
  }

  public async acknowledgeSnapshot(
    snapshot: ModelPriceAttentionSnapshot | string[]
  ): Promise<void> {
    const isArray = Array.isArray(snapshot);
    const snapshotScope = isArray ? this.base : snapshot?.scope;
    const modelsToAck = isArray ? snapshot : (snapshot?.models ?? []);

    if (!snapshotScope || snapshotScope !== this.base) {
      return;
    }

    if (!modelsToAck || modelsToAck.length === 0) {
      return;
    }

    const currentAck = new Set(loadAcknowledgedModels(this.base, this.storage));
    modelsToAck.forEach((m) => {
      if (m && m.trim()) {
        currentAck.add(m.trim());
      }
    });

    const nextAcknowledged = Array.from(currentAck).sort();
    saveAcknowledgedModels(this.base, nextAcknowledged, this.storage);

    // Re-evaluate pending with current unpriced models
    const pending = this.computePending(this.state.unpricedModels, nextAcknowledged);

    this.state = {
      ...this.state,
      acknowledgedModels: nextAcknowledged,
      pendingModels: pending,
    };
    this.notify();

    // Immediately refresh runtime model status to reconcile latest state
    await this.check({ force: true });
  }

  public ensureAutoCheck(): void {
    if (typeof window === 'undefined') return;

    if (!this.timerId) {
      this.timerId = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) {
          return;
        }
        if (this.isCacheExpired()) {
          void this.check();
        }
      }, 60 * 1000); // Check every minute whether the 30-min window expired
    }

    if (!this.focusHandlerAttached) {
      this.boundFocusHandler = () => {
        if (this.isCacheExpired()) {
          void this.check();
        }
      };
      window.addEventListener('focus', this.boundFocusHandler);
      this.focusHandlerAttached = true;
    }
  }

  public stopAutoCheck(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.focusHandlerAttached && this.boundFocusHandler && typeof window !== 'undefined') {
      window.removeEventListener('focus', this.boundFocusHandler);
      this.focusHandlerAttached = false;
      this.boundFocusHandler = null;
    }
  }

  public reset(): void {
    this.stopAutoCheck();
    this.scopeGeneration += 1;
    this.base = '';
    this.managementKey = undefined;
    this.lastAttemptAtMs = null;
    this.state = {
      runtimeModels: [],
      unpricedModels: [],
      acknowledgedModels: [],
      pendingModels: [],
      loading: false,
      lastCheckedAtMs: null,
    };
    this.activeCheckPromise = null;
    this.listeners.clear();
  }
}

// Global shared store singleton for all pages
export const sharedModelPriceAttentionStore = new ModelPriceAttentionStore();
