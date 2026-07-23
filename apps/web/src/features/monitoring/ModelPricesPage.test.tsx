import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelPricesPage } from './ModelPricesPage';

const { mocks } = vi.hoisted(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
  return {
    mocks: {
      getModelPriceUsageSummary: vi.fn(),
      setModelPrices: vi.fn(async () => undefined),
      syncModelPrices: vi.fn(async () => ({
        prices: {},
        imported: 0,
        skipped: 0,
      })),
      showNotification: vi.fn(),
      t: (key: string, options?: Record<string, unknown>) => {
        const messages: Record<string, string> = {
          'common.action': '操作',
          'common.loading': '加载中',
          'model_prices.add_manual': '手动添加',
          'model_prices.back_to_monitoring': '返回请求监控',
          'model_prices.calls': '调用',
          'model_prices.empty': '暂无模型价格',
          'model_prices.filter_all': '全部',
          'model_prices.filter_candidates': '待确认',
          'model_prices.filter_missing': '缺价格',
          'model_prices.filter_saved': '已保存',
          'model_prices.search_placeholder': '搜索模型或来源',
          'model_prices.source': '来源',
          'model_prices.sync_model_count': `${String(options?.count ?? 0)} 个模型参与同步`,
          'model_prices.usage_service_ready': 'Manager Server 已连接',
          'usage_stats.model_name': '模型名称',
          'usage_stats.model_price_cache': '缓存价格',
          'usage_stats.model_price_cache_creation': '缓存创建价格',
          'usage_stats.model_price_cache_read': '缓存读取价格',
          'usage_stats.model_price_completion': '补全价格',
          'usage_stats.model_price_prompt': '提示价格',
          'usage_stats.model_price_sync': '一键同步价格',
        };
        return messages[key] ?? key;
      },
    },
  };
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: mocks.t,
  }),
}));

vi.mock('@/hooks/usePanelFeatureAvailability', () => ({
  usePanelFeatureAvailability: () => ({
    checking: false,
    panelHostMode: 'manager_embedded',
    panelBase: 'http://manager.local:18317',
    managerServiceBase: 'http://manager.local:18317',
    managerServiceAvailable: true,
    requestMonitoringAvailable: true,
    modelPricesAvailable: true,
    serverCodexInspectionAvailable: true,
    dockerSetupAvailable: true,
    externalManagerConfigAvailable: false,
    reason: '',
  }),
}));

vi.mock('@/features/monitoring/hooks/useUsageData', () => ({
  useUsageData: () => ({
    loading: false,
    modelPrices: {
      'manual-model': {
        prompt: 1,
        completion: 2,
        cache: 0.5,
        source: 'manual',
      },
    },
    setModelPrices: mocks.setModelPrices,
    syncModelPrices: mocks.syncModelPrices,
    usageServiceAvailable: true,
  }),
}));

vi.mock('@/services/api/usageService', () => ({
  usageServiceApi: {
    getModelPriceUsageSummary: mocks.getModelPriceUsageSummary,
  },
}));

vi.mock('@/stores', () => ({
  useNotificationStore: () => ({
    showNotification: mocks.showNotification,
  }),
}));

const collectText = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && 'children' in node) {
    return collectText((node as { children?: unknown }).children);
  }
  return '';
};

describe('ModelPricesPage', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    localStorage.clear();
    mocks.getModelPriceUsageSummary.mockReset();
    mocks.getModelPriceUsageSummary.mockResolvedValue({
      sampled_events: 1,
      total_events: 1,
      truncated: false,
      models: [{ model: 'slow-usage-model', calls: 99, requested_calls: 99, resolved_calls: 0 }],
    });
    mocks.setModelPrices.mockClear();
    mocks.syncModelPrices.mockClear();
    mocks.showNotification.mockClear();
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('does not query usage summary when rendering saved model prices', async () => {
    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={['/model-prices']}>
          <ModelPricesPage />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const text = collectText(renderer?.toJSON());
    expect(mocks.getModelPriceUsageSummary).not.toHaveBeenCalled();
    expect(text).toContain('manual-model');
    expect(text).toContain('1 个模型参与同步');
    expect(text).not.toContain('调用');
    expect(text).not.toContain('slow-usage-model');
  });
});
