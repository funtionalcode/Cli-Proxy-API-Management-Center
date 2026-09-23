import { describe, expect, it } from 'vitest';
import { resolveAcknowledgedPendingModelsAfterSync } from './resolveAcknowledgedPendingModelsAfterSync';

describe('resolveAcknowledgedPendingModelsAfterSync', () => {
  const scope = 'http://localhost:18317';

  it('acknowledges all pending snapshot models when runtime discovery succeeds', () => {
    const result = resolveAcknowledgedPendingModelsAfterSync({
      pendingSnapshot: {
        scope,
        models: ['model-A', 'model-B'],
      },
      syncModels: ['model-A'],
      runtimeModelDiscoveryError: null,
    });

    expect(result).toEqual({
      scope,
      models: ['model-A', 'model-B'],
    });
  });

  it('acknowledges only (pendingSnapshot ∩ syncModels) when runtime discovery fails', () => {
    const result = resolveAcknowledgedPendingModelsAfterSync({
      pendingSnapshot: {
        scope,
        models: ['model-A', 'model-B'],
      },
      syncModels: ['model-A'],
      runtimeModelDiscoveryError: '504 gateway timeout fetching runtime models',
    });

    expect(result).toEqual({
      scope,
      models: ['model-A'],
    });
  });

  it('acknowledges nothing when runtime discovery fails and pending models were not in syncModels', () => {
    const result = resolveAcknowledgedPendingModelsAfterSync({
      pendingSnapshot: {
        scope,
        models: ['model-B'],
      },
      syncModels: ['model-A'],
      runtimeModelDiscoveryError: 'network error',
    });

    expect(result).toEqual({
      scope,
      models: [],
    });
  });

  it('handles empty pending snapshot gracefully', () => {
    const result = resolveAcknowledgedPendingModelsAfterSync({
      pendingSnapshot: {
        scope,
        models: [],
      },
      syncModels: ['model-A'],
      runtimeModelDiscoveryError: null,
    });

    expect(result).toEqual({
      scope,
      models: [],
    });
  });
});
