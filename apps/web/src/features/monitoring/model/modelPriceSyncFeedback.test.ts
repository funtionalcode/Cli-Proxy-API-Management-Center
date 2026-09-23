import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { usageServiceApi, type ModelPriceSyncResponse } from '@/services/api/usageService';
import { resolveModelPriceSyncNotification } from './modelPriceSyncFeedback';

describe('modelPriceSyncFeedback', () => {
  const fakeTranslate = (key: string, options?: Record<string, unknown>) => {
    if (!options) return key;
    return `${key}:${JSON.stringify(options)}`;
  };

  it('handles case C: runtime discovery error with empty known models', () => {
    const result: ModelPriceSyncResponse = {
      imported: 0,
      skipped: 0,
      prices: {},
      runtimeModelCount: 0,
      runtimeModelDiscoveryError: 'cpa connection refused',
    };
    const notification = resolveModelPriceSyncNotification({
      result,
      syncModels: [],
      t: fakeTranslate,
    });
    expect(notification.type).toBe('warning');
    expect(notification.message).toBe('model_prices.sync_runtime_discovery_failed_empty');
  });

  it('handles case B: runtime discovery error with non-empty known models as warning fallback', () => {
    const result: ModelPriceSyncResponse = {
      imported: 2,
      skipped: 1,
      prices: {},
      candidates: [],
      unmatched: ['unmatched-model'],
      preserved: [],
      runtimeModelDiscoveryError: 'cpa timeout',
    };
    const notification = resolveModelPriceSyncNotification({
      result,
      syncModels: ['known-model-1', 'known-model-2'],
      t: fakeTranslate,
    });
    expect(notification.type).toBe('warning');
    expect(notification.message).toContain('model_prices.sync_runtime_discovery_failed_fallback');
    expect(notification.message).toContain('model_prices.sync_success_detail');
  });

  it('handles case D: runtime discovery success with zero models found and zero known models', () => {
    const result: ModelPriceSyncResponse = {
      imported: 0,
      skipped: 0,
      prices: {},
      runtimeModelCount: 0,
    };
    const notification = resolveModelPriceSyncNotification({
      result,
      syncModels: [],
      t: fakeTranslate,
    });
    expect(notification.type).toBe('warning');
    expect(notification.message).toBe('usage_stats.model_price_sync_no_models');
  });

  it('handles case A: runtime discovery success with imported models', () => {
    const result: ModelPriceSyncResponse = {
      imported: 3,
      skipped: 0,
      prices: {},
      runtimeModelCount: 3,
      candidates: [],
      unmatched: [],
      preserved: [],
    };
    const notification = resolveModelPriceSyncNotification({
      result,
      syncModels: [],
      t: fakeTranslate,
    });
    expect(notification.type).toBe('success');
    expect(notification.message).toContain('model_prices.sync_success_detail');
  });

  it('handles case A with preserved models returning warning', () => {
    const result: ModelPriceSyncResponse = {
      imported: 1,
      skipped: 0,
      prices: {},
      runtimeModelCount: 1,
      candidates: [],
      unmatched: [],
      preserved: ['preserved-model'],
    };
    const notification = resolveModelPriceSyncNotification({
      result,
      syncModels: ['preserved-model'],
      t: fakeTranslate,
    });
    expect(notification.type).toBe('warning');
    expect(notification.message).toContain('model_prices.sync_success_detail');
  });
});

describe('usageServiceApi.syncModelPrices serialization', () => {
  it('sends includeRuntimeModels and models array in request payload', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        imported: 1,
        skipped: 0,
        prices: {},
        runtimeModelCount: 1,
      },
    });

    const response = await usageServiceApi.syncModelPrices(
      'http://localhost:18317',
      'test-key',
      ['gpt-4o'],
      { includeRuntimeModels: true }
    );

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:18317/v0/management/model-prices/sync',
      {
        models: ['gpt-4o'],
        includeRuntimeModels: true,
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    );
    expect(response.runtimeModelCount).toBe(1);

    postSpy.mockRestore();
  });

  it('sends empty models array with includeRuntimeModels: true for zero-history users', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        imported: 2,
        skipped: 0,
        prices: {},
        runtimeModelCount: 2,
      },
    });

    await usageServiceApi.syncModelPrices(
      'http://localhost:18317',
      'test-key',
      [],
      { includeRuntimeModels: true }
    );

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:18317/v0/management/model-prices/sync',
      {
        models: [],
        includeRuntimeModels: true,
      },
      expect.anything()
    );

    postSpy.mockRestore();
  });

  it('preserves legacy call semantics without options', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        imported: 1,
        skipped: 0,
        prices: {},
      },
    });

    await usageServiceApi.syncModelPrices('http://localhost:18317', 'test-key', ['gpt-4o']);

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:18317/v0/management/model-prices/sync',
      {
        models: ['gpt-4o'],
      },
      expect.anything()
    );

    postSpy.mockRestore();
  });
});
