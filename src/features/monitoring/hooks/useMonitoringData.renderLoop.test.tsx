import { Profiler } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiKeyAlias } from '@/services/api/usageService';
import type { ModelPrice } from '@/utils/usage';

vi.mock('../services/monitoringMetaService', () => ({
  loadMonitoringMetaPayload: vi.fn(async () => ({
    authFiles: [],
    channels: [],
    error: '',
  })),
}));

vi.mock('./useMonitoringAnalytics', () => ({
  useMonitoringAnalytics: () => ({
    enabled: true,
    loading: false,
    error: '',
    data: null,
    dataStale: false,
    lastRefreshedAt: null,
    serviceBase: 'http://manager.local',
    unavailableReason: '',
    refresh: vi.fn(),
  }),
}));

import { useMonitoringData } from './useMonitoringData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY_MODEL_PRICES: Record<string, ModelPrice> = {};
const EMPTY_API_KEY_ALIASES: ApiKeyAlias[] = [];
const ALL_SCOPE_FILTERS = {
  account: 'all',
  provider: 'all',
  model: 'all',
  channel: 'all',
  apiKeyHash: 'all',
  status: 'all',
} as const;

describe('useMonitoringData render stability', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('settles while analytics events are still waiting for the first page', async () => {
    let renderCount = 0;

    function Harness() {
      useMonitoringData({
        config: null,
        modelPrices: EMPTY_MODEL_PRICES,
        apiKeyAliases: EMPTY_API_KEY_ALIASES,
        timeRange: 'today',
        customTimeRange: null,
        searchQuery: '',
        searchApiKeyHash: '',
        scopeFilters: ALL_SCOPE_FILTERS,
      });
      return null;
    }

    await act(async () => {
      renderer = create(
        <Profiler id="monitoring-data" onRender={() => {
          renderCount += 1;
        }}>
          <Harness />
        </Profiler>
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(renderCount).toBeLessThan(10);
  });
});
