import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { MonitoringActionBar } from '@/features/monitoring/components/MonitoringActionBar';
import { UsageMetricsCard } from '@/features/dashboard/components/UsageMetricsCard';
import { UsageSummaryCardView, UsageSummaryGrid } from '@/features/usage-analytics/components/UsageSummaryCards';
import * as attentionHook from './useModelPriceAttention';
import enLocale from '@/i18n/locales/en.json';
import zhCNLocale from '@/i18n/locales/zh-CN.json';
import zhTWLocale from '@/i18n/locales/zh-TW.json';
import ruLocale from '@/i18n/locales/ru.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { count?: number; defaultValue?: string }) => {
        if (key === 'usage_stats.model_price_attention_tooltip') {
          return `发现 ${options?.count} 个新模型待同步价格`;
        }
        if (key === 'usage_stats.model_price_settings_short') {
          return '模型价格';
        }
        if (key === 'usage_stats.model_price_settings') {
          return '模型价格设置';
        }
        if (key === 'model_prices.pending_sync_badge') {
          return '待同步';
        }
        if (key === 'dashboard.today_cost') {
          return '今日成本';
        }
        if (key === 'usage_analytics.metric_estimated_cost') {
          return '预估成本';
        }
        return options?.defaultValue ?? key;
      },
      i18n: { language: 'zh-CN' },
    }),
  };
});

import type { ModelPriceAttentionSnapshot } from './modelPriceAttentionTypes';

describe('ModelPriceAttention UI Integration', () => {
  let mockAttentionState: {
    runtimeModels: string[];
    unpricedModels: string[];
    acknowledgedModels: string[];
    pendingModels: string[];
    pendingCount: number;
    hasAttention: boolean;
    modelPricesAvailable: boolean;
    loading: boolean;
    lastCheckedAtMs: number | null;
    check: () => Promise<void>;
    capturePendingSnapshot: () => ModelPriceAttentionSnapshot;
    acknowledgeSnapshot: (snapshot: ModelPriceAttentionSnapshot | string[]) => Promise<void>;
  };

  beforeEach(() => {
    mockAttentionState = {
      runtimeModels: [],
      unpricedModels: [],
      acknowledgedModels: [],
      pendingModels: [],
      pendingCount: 0,
      hasAttention: false,
      modelPricesAvailable: true,
      loading: false,
      lastCheckedAtMs: Date.now(),
      check: vi.fn(async () => {}),
      capturePendingSnapshot: vi.fn(() => ({
        scope: 'http://localhost:18317',
        models: [],
      })),
      acknowledgeSnapshot: vi.fn(async () => {}),
    };

    vi.spyOn(attentionHook, 'useModelPriceAttention').mockImplementation(
      () => mockAttentionState
    );
  });

  describe('MonitoringActionBar', () => {
    const defaultProps = {
      usageTransferAvailable: true,
      usageExporting: false,
      usageImporting: false,
      loggingToFile: false,
      modelPricesAvailable: true,
      usageImportInputRef: { current: null },
      t: ((key: string) => key) as unknown as TFunction,
      onUsageExport: vi.fn(),
      onUsageImportClick: vi.fn(),
      onUsageImportChange: vi.fn(),
      statusSummary: null,
    };

    it('renders normal link without dot when pending = 0', () => {
      mockAttentionState.pendingCount = 0;
      mockAttentionState.hasAttention = false;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <MonitoringActionBar {...defaultProps} />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      const link = root.findByProps({ 'data-testid': 'monitoring-model-prices-link' });
      expect(link.props.to).toBe('/model-prices');
      expect(root.findAllByProps({ 'data-testid': 'model-price-attention-dot' })).toHaveLength(0);
    });

    it('renders amber dot and links to /model-prices?filter=missing when pending > 0', () => {
      mockAttentionState.pendingModels = ['gpt-6-sol'];
      mockAttentionState.pendingCount = 1;
      mockAttentionState.hasAttention = true;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <MonitoringActionBar {...defaultProps} />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      const link = root.findByProps({ 'data-testid': 'monitoring-model-prices-link' });
      expect(link.props.to).toBe('/model-prices?filter=missing');
      expect(link.props.title).toBe('发现 1 个新模型待同步价格');
      const dot = root.findByProps({ 'data-testid': 'model-price-attention-dot' });
      expect(dot).toBeDefined();
    });
  });

  describe('Dashboard UsageMetricsCard', () => {
    const defaultSummary = {
      today: {
        total_calls: 100,
        success_calls: 95,
        total_tokens: 10000,
        total_cost: 12.34,
        average_latency_ms: 120,
        zero_token_calls: 2,
        success_rate: 0.95,
      },
      rolling_30m: {
        rpm: 10,
        tpm: 500,
        total_tokens: 2000,
      },
      top_models_today: [],
      model_cost_rank: [],
    };

    it('keeps cost UI untouched when pending = 0', () => {
      mockAttentionState.pendingCount = 0;
      mockAttentionState.hasAttention = false;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <UsageMetricsCard
              summary={defaultSummary as unknown as ComponentProps<typeof UsageMetricsCard>['summary']}
              topModels={[]}
              modelCostRank={[]}
              loading={false}
              lastRefreshedAt={new Date()}
              mode="metrics-only"
            />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      expect(root.findAllByProps({ 'data-testid': 'inline-model-price-attention-link' })).toHaveLength(0);
    });

    it('renders inline attention link in cost area when pending > 0', () => {
      mockAttentionState.pendingModels = ['new-model'];
      mockAttentionState.pendingCount = 1;
      mockAttentionState.hasAttention = true;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <UsageMetricsCard
              summary={defaultSummary as unknown as ComponentProps<typeof UsageMetricsCard>['summary']}
              topModels={[]}
              modelCostRank={[]}
              loading={false}
              lastRefreshedAt={new Date()}
              mode="metrics-only"
            />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      const link = root.findByProps({ 'data-testid': 'inline-model-price-attention-link' });
      expect(link.props.to).toBe('/model-prices?filter=missing');
      expect(link.props.title).toBe('发现 1 个新模型待同步价格');
    });
  });

  describe('Usage Analytics UsageSummaryCards', () => {
    const findInlineAttentionLinks = (root: ReactTestRenderer['root']) =>
      root.findAll((n) => n.type === 'a' && n.props['data-testid'] === 'inline-model-price-attention-link');

    it('Case A: cost icon alone no longer triggers attention when pending > 0', () => {
      mockAttentionState.pendingModels = ['gpt-6-preview'];
      mockAttentionState.pendingCount = 1;
      mockAttentionState.hasAttention = true;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <UsageSummaryCardView
              icon="cost"
              label="预估成本"
              value="$12.34"
              accent="amber"
              meta=""
            />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      expect(findInlineAttentionLinks(root)).toHaveLength(0);
    });

    it('Case B: explicit showModelPriceAttention triggers attention when pending > 0', () => {
      mockAttentionState.pendingModels = ['gpt-6-preview'];
      mockAttentionState.pendingCount = 1;
      mockAttentionState.hasAttention = true;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <UsageSummaryCardView
              icon="cost"
              showModelPriceAttention
              label="预估成本"
              value="$12.34"
              accent="amber"
              meta=""
            />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      const links = findInlineAttentionLinks(root);
      expect(links).toHaveLength(1);
      const link = root.findByProps({ 'data-testid': 'inline-model-price-attention-link' });
      expect(link.props.to).toBe('/model-prices?filter=missing');
    });

    it('Case C: only one attention link rendered even if grid has multiple cost cards', () => {
      mockAttentionState.pendingModels = ['gpt-6-preview'];
      mockAttentionState.pendingCount = 1;
      mockAttentionState.hasAttention = true;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <UsageSummaryGrid
              cards={[
                {
                  icon: 'cost',
                  label: '最高成本占比',
                  value: '45.0%',
                  accent: 'amber',
                  meta: 'gpt-5.5',
                },
                {
                  icon: 'cost',
                  label: '预估成本',
                  value: '$12.34',
                  accent: 'amber',
                  meta: '',
                  showModelPriceAttention: true,
                },
              ]}
            />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      const links = findInlineAttentionLinks(root);
      expect(links).toHaveLength(1);
      const link = root.findByProps({ 'data-testid': 'inline-model-price-attention-link' });
      expect(link.props.to).toBe('/model-prices?filter=missing');
    });

    it('Case D: compact/shared component does not trigger attention without showModelPriceAttention', () => {
      mockAttentionState.pendingModels = ['gpt-6-preview'];
      mockAttentionState.pendingCount = 1;
      mockAttentionState.hasAttention = true;

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MemoryRouter>
            <UsageSummaryGrid
              density="compact"
              cards={[
                {
                  icon: 'cost',
                  label: '总成本',
                  value: '$12.34',
                  accent: 'amber',
                  meta: '',
                },
              ]}
            />
          </MemoryRouter>
        );
      });

      const root = renderer!.root;
      expect(findInlineAttentionLinks(root)).toHaveLength(0);
    });
  });

  describe('Locales consistency', () => {
    it('defines model_price_settings_short as Model Prices across all locales', () => {
      expect(zhCNLocale.usage_stats.model_price_settings_short).toBe('模型价格');
      expect(enLocale.usage_stats.model_price_settings_short).toBe('Model Prices');
      expect(zhTWLocale.usage_stats.model_price_settings_short).toBe('模型定價');
      expect(ruLocale.usage_stats.model_price_settings_short).toBe('Цены моделей');
    });

    it('defines pending_sync_badge across all locales', () => {
      expect(zhCNLocale.model_prices.pending_sync_badge).toBe('待同步');
      expect(enLocale.model_prices.pending_sync_badge).toBe('New');
      expect(zhTWLocale.model_prices.pending_sync_badge).toBe('待同步');
      expect(ruLocale.model_prices.pending_sync_badge).toBe('Новый');
    });

    it('defines model_price_attention_tooltip across all locales', () => {
      expect(zhCNLocale.usage_stats.model_price_attention_tooltip).toContain('{{count}}');
      expect(enLocale.usage_stats.model_price_attention_tooltip).toContain('{{count}}');
      expect(zhTWLocale.usage_stats.model_price_attention_tooltip).toContain('{{count}}');
      expect(ruLocale.usage_stats.model_price_attention_tooltip).toContain('{{count}}');
    });
  });
});
