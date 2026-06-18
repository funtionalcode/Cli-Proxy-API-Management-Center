import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  AccountExpandedDetails,
  AccountOverviewCard,
  buildRealtimeLogRows,
} from './MonitoringCenterPage';
import { buildEmptyMonitoringStatusData } from '@/features/monitoring/accountOverviewState';
import { buildRealtimeSourceDisplay } from '@/features/monitoring/realtimeSourceDisplay';
import { buildModelPriceCandidateModels } from '@/features/monitoring/modelPriceCandidates';
import type { MonitoringEventRow } from '@/features/monitoring/hooks/useMonitoringData';

const t = ((key: string, options?: Record<string, unknown>) => {
  const copy: Record<string, string> = {
    'monitoring.account_overview_enable_all': 'Enable all',
    'monitoring.account_overview_disable_all': 'Disable all',
    'monitoring.restore_account_scope': 'Restore account scope',
    'monitoring.focus_account': 'Focus account',
    'monitoring.account_overview_enabled_label': 'Enabled',
    'monitoring.account_overview_enabled_label_short': 'Enabled',
    'auth_files.status_toggle_label': 'Enabled',
    'monitoring.account_overview_health_label': 'Health',
    'monitoring.account_overview_health_hint': 'Health hint',
    'monitoring.account_overview_scope_current_filters': 'Scope: current filters',
    'monitoring.account_overview_scope_range': 'Scope: {{range}}',
    'monitoring.account_overview_tokens_title': 'Tokens Usage',
    'monitoring.account_overview_token_structure': 'Token Structure',
    'monitoring.account_overview_models_top': 'Model Usage Top {{count}}',
    'monitoring.account_overview_models_all': 'Model Usage Details',
    'monitoring.account_overview_model_calls_short': 'Calls',
    'monitoring.account_overview_model_success_rate_short': 'Success',
    'monitoring.account_overview_model_input_tokens_short': 'Input',
    'monitoring.account_overview_model_output_tokens_short': 'Output',
    'monitoring.account_overview_model_cached_tokens_short': 'Cache',
    'monitoring.account_overview_model_total_tokens_short': 'Total Tokens',
    'monitoring.account_overview_model_total_cost_short': 'Total Cost',
    'monitoring.account_overview_view_all': 'View All',
    'monitoring.account_overview_collapse_models': 'Collapse',
    'monitoring.account_overview_no_models': 'No model details',
    'monitoring.total_calls': 'Total calls',
    'monitoring.calls': 'Calls',
    'stats.success': 'Success',
    'stats.failure': 'Failure',
    'monitoring.latest_request_time': 'Latest request',
    'monitoring.column_success_rate': 'Success rate',
    'monitoring.success_calls': 'Success calls',
    'monitoring.failure_calls': 'Failure calls',
    'monitoring.total_tokens': 'Total Tokens',
    'monitoring.input_tokens': 'Input Tokens',
    'monitoring.output_tokens': 'Output Tokens',
    'monitoring.cached_tokens': 'Cached Tokens',
    'monitoring.estimated_cost': 'Estimated Cost',
    'usage_stats.model_price_model': 'Model',
    'monitoring.last_sync': 'Last sync',
    'monitoring.account_quota_reset_at': 'Reset',
    'monitoring.account_quota_title': 'Account Quota',
    'monitoring.account_quota_loading': 'Loading quotas',
    'monitoring.account_quota_empty': 'No quota data',
    'monitoring.account_quota_idle': 'Click refresh quota',
    'monitoring.account_quota_load_failed': 'Failed to load quota: {{message}}',
    'monitoring.account_quota_refresh': 'Refresh',
    'monitoring.account_quota_retry': 'Retry',
    'monitoring.filter_provider': 'Provider',
    'monitoring.column_host': 'Host',
    'monitoring.source': 'Source',
    'status_bar.no_requests': 'No requests',
  };
  let value = copy[key] ?? key;
  Object.entries(options ?? {}).forEach(([name, replacement]) => {
    value = value.replace(`{{${name}}}`, String(replacement));
  });
  return value;
}) as TFunction;

const createMonitoringEventRow = (
  overrides: Partial<MonitoringEventRow> = {}
): MonitoringEventRow => ({
  id: overrides.id ?? 'row-1',
  timestamp: overrides.timestamp ?? '2026-05-09T01:12:43.000Z',
  timestampMs: overrides.timestampMs ?? Date.parse('2026-05-09T01:12:43.000Z'),
  dayKey: overrides.dayKey ?? '2026-05-09',
  hourLabel: overrides.hourLabel ?? '01:00',
  model: overrides.model ?? 'gpt-4.1',
  endpoint: overrides.endpoint ?? 'POST /v1/chat/completions',
  endpointMethod: overrides.endpointMethod ?? 'POST',
  endpointPath: overrides.endpointPath ?? '/v1/chat/completions',
  sourceKey: overrides.sourceKey ?? 'source:alpha',
  source: overrides.source ?? 'alpha.json',
  sourceMasked: overrides.sourceMasked ?? 'alpha.json',
  account: overrides.account ?? 'alice@example.com',
  accountMasked: overrides.accountMasked ?? 'ali***@example.com',
  authIndex: overrides.authIndex ?? 'auth-1',
  authIndexMasked: overrides.authIndexMasked ?? 'auth-1',
  authLabel: overrides.authLabel ?? 'alice',
  apiKeyHash: overrides.apiKeyHash ?? '',
  apiKeyLabel: overrides.apiKeyLabel ?? '',
  apiKeyMasked: overrides.apiKeyMasked ?? '',
  provider: overrides.provider ?? 'codex',
  projectId: overrides.projectId ?? '',
  planType: overrides.planType ?? '-',
  channel: overrides.channel ?? 'codex',
  channelHost: overrides.channelHost ?? 'example.com',
  channelDisabled: overrides.channelDisabled ?? false,
  failed: overrides.failed ?? false,
  requestCount: overrides.requestCount ?? 1,
  successCalls: overrides.successCalls ?? (overrides.failed ? 0 : 1),
  failureCalls: overrides.failureCalls ?? (overrides.failed ? 1 : 0),
  statsIncluded: overrides.statsIncluded ?? true,
  latencyMs: overrides.latencyMs ?? 120,
  latencySumMs: overrides.latencySumMs ?? overrides.latencyMs ?? 120,
  latencyCount: overrides.latencyCount ?? 1,
  inputTokens: overrides.inputTokens ?? 10,
  outputTokens: overrides.outputTokens ?? 5,
  reasoningTokens: overrides.reasoningTokens ?? 0,
  cachedTokens: overrides.cachedTokens ?? 0,
  totalTokens: overrides.totalTokens ?? 15,
  totalCost: overrides.totalCost ?? 0,
  serverStreamKey: overrides.serverStreamKey,
  serverStreamTotalCalls: overrides.serverStreamTotalCalls,
  serverStreamSuccessCalls: overrides.serverStreamSuccessCalls,
  serverStreamFailureCalls: overrides.serverStreamFailureCalls,
  serverStreamRecentPattern: overrides.serverStreamRecentPattern,
  serverStreamRequestCount: overrides.serverStreamRequestCount,
  serverStreamSuccessCallsToEvent: overrides.serverStreamSuccessCallsToEvent,
  serverStreamFailureCallsToEvent: overrides.serverStreamFailureCallsToEvent,
  serverStreamRecentPatternToEvent: overrides.serverStreamRecentPatternToEvent,
  taskKey: overrides.taskKey ?? 'task-1',
  searchText: overrides.searchText ?? 'alice codex gpt-4.1',
});

describe('MonitoringCenterPage account card', () => {
  it('builds model price candidates from summary facets when detail rows are empty', () => {
    expect(
      buildModelPriceCandidateModels(
        [' gpt-5 ', 'gemini-2.5-flash', ''],
        [],
        {
          'claude-sonnet-4-5': {
            prompt: 3,
            completion: 15,
            cache: 0.3,
          },
        }
      )
    ).toEqual(['claude-sonnet-4-5', 'gemini-2.5-flash', 'gpt-5']);
  });

  it('keeps legacy row and saved-price model candidates available', () => {
    expect(
      buildModelPriceCandidateModels(
        [],
        [
          createMonitoringEventRow({ model: 'gpt-4.1' }),
          createMonitoringEventRow({ id: 'row-2', model: ' gpt-4.1 ' }),
        ],
        {
          'codex-mini-latest': {
            prompt: 1,
            completion: 4,
            cache: 0.1,
          },
        }
      )
    ).toEqual(['codex-mini-latest', 'gpt-4.1']);
  });

  it('uses server realtime stream identities without duplicating final totals per row', () => {
    const rows = buildRealtimeLogRows([
      createMonitoringEventRow({
        serverStreamKey: 'alice@example.com\u0000codex\u0000gpt-4.1\u0000auth-1',
        serverStreamTotalCalls: 37,
        serverStreamSuccessCalls: 35,
        serverStreamFailureCalls: 2,
        serverStreamRecentPattern: [true, true, false],
        serverStreamRequestCount: 12,
        serverStreamSuccessCallsToEvent: 11,
        serverStreamFailureCallsToEvent: 1,
        serverStreamRecentPatternToEvent: [true, false, true],
      }),
      createMonitoringEventRow({
        id: 'row-2',
        timestampMs: Date.parse('2026-05-09T01:12:44.000Z'),
        serverStreamKey: 'alice@example.com\u0000codex\u0000gpt-4.1\u0000auth-1',
        serverStreamTotalCalls: 37,
        serverStreamSuccessCalls: 35,
        serverStreamFailureCalls: 2,
        serverStreamRecentPattern: [true, true, false],
        serverStreamRequestCount: 13,
        serverStreamSuccessCallsToEvent: 11,
        serverStreamFailureCallsToEvent: 2,
        serverStreamRecentPatternToEvent: [false, true, false],
        failed: true,
      }),
      createMonitoringEventRow({
        id: 'row-3',
        timestampMs: Date.parse('2026-05-09T01:12:45.000Z'),
        serverStreamKey: 'alice@example.com\u0000codex\u0000gpt-4.1\u0000auth-2',
        serverStreamTotalCalls: 1,
        serverStreamSuccessCalls: 0,
        serverStreamFailureCalls: 1,
        serverStreamRecentPattern: [false],
        serverStreamRequestCount: 1,
        serverStreamSuccessCallsToEvent: 0,
        serverStreamFailureCallsToEvent: 1,
        serverStreamRecentPatternToEvent: [false],
        failed: true,
      }),
    ]);

    expect(rows).toHaveLength(3);
    const rowsByStreamKey = new Map(rows.map((row) => [row.streamKey, row]));
    const authOneRows = rows
      .filter(
        (row) => row.streamKey === 'server:alice@example.com\u0000codex\u0000gpt-4.1\u0000auth-1'
      )
      .sort((left, right) => left.timestampMs - right.timestampMs);
    const authTwoRow = rowsByStreamKey.get(
      'server:alice@example.com\u0000codex\u0000gpt-4.1\u0000auth-2'
    );

    expect(authOneRows.map((row) => row.requestCount)).toEqual([12, 13]);
    expect(authOneRows[0].successRate).toBeCloseTo(11 / 12);
    expect(authOneRows[0].recentPattern).toEqual([true, false, true]);
    expect(authOneRows[1].successRate).toBeCloseTo(11 / 13);
    expect(authOneRows[1].recentPattern).toEqual([false, true, false]);
    expect(authTwoRow?.requestCount).toBe(1);
    expect(authTwoRow?.successRate).toBe(0);
    expect(authTwoRow?.recentPattern).toEqual([false]);
  });

  it('prefers readable channel names in realtime source cells', () => {
    const display = buildRealtimeSourceDisplay(
      {
        account: 'alice@example.com',
        accountMasked: 'ali***@example.com',
        authLabel: 'alice',
        channel: 'Claude Relay',
        channelHost: 'relay.example.com',
        provider: 'openai',
        sourceMasked: 'Team Key',
      },
      t
    );

    expect(display.primary).toBe('Claude Relay');
    expect(display.meta).toBe('Provider: openai');
  });

  it('shows one realtime source meta value by priority', () => {
    const baseRow = {
      account: 'alice@example.com',
      accountMasked: 'ali***@example.com',
      authLabel: 'alice',
      channel: '-',
      channelHost: 'relay.example.com',
      sourceMasked: 'Team Key',
    };

    expect(
      buildRealtimeSourceDisplay(
        {
          ...baseRow,
          provider: 'openai',
        },
        t
      ).primary
    ).toBe('openai');
    expect(
      buildRealtimeSourceDisplay(
        {
          ...baseRow,
          provider: 'openai',
        },
        t
      ).meta
    ).toBe('Host: relay.example.com');

    expect(
      buildRealtimeSourceDisplay(
        {
          ...baseRow,
          provider: '-',
        },
        t
      ).meta
    ).toBe('alice@example.com');
  });

  it('renders bulk action buttons for mixed account auth state', () => {
    const html = renderToStaticMarkup(
      <AccountOverviewCard
        row={{
          id: 'account@example.com',
          account: 'account@example.com',
          displayAccount: 'account@example.com',
          accountMasked: 'acc***@example.com',
          authLabels: ['alpha', 'beta'],
          authIndices: ['1', '2'],
          channels: ['default'],
          totalCalls: 10,
          successCalls: 8,
          failureCalls: 2,
          successRate: 0.8,
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 10,
          totalTokens: 160,
          totalCost: 1.25,
          averageLatencyMs: 120,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [true, false],
          models: [],
        }}
        authState={{
          files: [],
          toggleableFileNames: ['alpha.json', 'beta.json'],
          enabledState: 'mixed',
        }}
        hasPrices
        locale="en"
        t={t}
        isExpanded={false}
        isFocused={false}
        statusData={buildEmptyMonitoringStatusData({
          startMs: Date.UTC(2026, 4, 10, 0, 0, 0),
          endMs: Date.UTC(2026, 4, 10, 23, 59, 59),
        })}
        scopeText="Scope: 5/10 12:00 AM - 11:59 PM"
        statusUpdating={false}
        onToggle={() => {}}
        onFocus={() => {}}
        onToggleEnabled={() => {}}
        onRefreshQuota={() => {}}
      />
    );

    expect(html).toContain('Enable all');
    expect(html).toContain('Disable all');
    expect(html).not.toContain('type="checkbox"');
  });

  it('renders expanded card model usage as readable metadata instead of a table', () => {
    const html = renderToStaticMarkup(
      <AccountOverviewCard
        row={{
          id: 'account@example.com',
          account: 'account@example.com',
          displayAccount: 'account@example.com',
          accountMasked: 'acc***@example.com',
          authLabels: ['alpha'],
          authIndices: ['1'],
          channels: ['default'],
          totalCalls: 221,
          successCalls: 220,
          failureCalls: 1,
          successRate: 0.995,
          inputTokens: 35_000_000,
          outputTokens: 68_500,
          cachedTokens: 33_900_000,
          totalTokens: 35_068_500,
          totalCost: 23.04,
          averageLatencyMs: 120,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [true, true],
          models: [
            {
              model: 'gpt-5.5',
              totalCalls: 196,
              successCalls: 195,
              failureCalls: 1,
              successRate: 0.995,
              inputTokens: 33_400_000,
              outputTokens: 66_600,
              cachedTokens: 32_500_000,
              totalTokens: 33_466_600,
              totalCost: 23.04,
              lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
            },
            {
              model: 'codex-auto-review',
              totalCalls: 25,
              successCalls: 24,
              failureCalls: 1,
              successRate: 0.96,
              inputTokens: 1_600_000,
              outputTokens: 1_900,
              cachedTokens: 1_400_000,
              totalTokens: 1_601_900,
              totalCost: 0,
              lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
            },
          ],
        }}
        authState={{
          files: [],
          toggleableFileNames: ['alpha.json'],
          enabledState: 'enabled',
        }}
        hasPrices
        locale="en"
        t={t}
        isExpanded
        isFocused={false}
        statusData={buildEmptyMonitoringStatusData({
          startMs: Date.UTC(2026, 4, 10, 0, 0, 0),
          endMs: Date.UTC(2026, 4, 10, 23, 59, 59),
        })}
        scopeText="Scope: 5/10 12:00 AM - 11:59 PM"
        statusUpdating={false}
        onToggle={() => {}}
        onFocus={() => {}}
        onToggleEnabled={() => {}}
        onRefreshQuota={() => {}}
      />
    );

    expect(html).toContain('gpt-5.5');
    expect(html).toContain('<small>Calls</small><strong>196</strong>');
    expect(html).toContain('<small>Success</small><strong class="_goodText');
    expect(html).toContain('<small>Total Tokens</small><strong>33.5M</strong>');
    expect(html).toContain('<small>Total Cost</small><strong>$23.04</strong>');
    expect(html).not.toContain('<table');
  });

  it('uses a static enabled label beside the account toggle', () => {
    const html = renderToStaticMarkup(
      <AccountOverviewCard
        row={{
          id: 'disabled@example.com',
          account: 'disabled@example.com',
          displayAccount: 'disabled@example.com',
          accountMasked: 'dis***@example.com',
          authLabels: ['alpha'],
          authIndices: ['1'],
          channels: ['default'],
          totalCalls: 0,
          successCalls: 0,
          failureCalls: 0,
          successRate: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          averageLatencyMs: null,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [],
          models: [],
        }}
        authState={{
          files: [],
          toggleableFileNames: ['alpha.json'],
          enabledState: 'disabled',
        }}
        hasPrices
        locale="en"
        t={t}
        isExpanded={false}
        isFocused={false}
        statusData={buildEmptyMonitoringStatusData({
          startMs: Date.UTC(2026, 4, 10, 0, 0, 0),
          endMs: Date.UTC(2026, 4, 10, 23, 59, 59),
        })}
        scopeText="Scope: 5/10 12:00 AM - 11:59 PM"
        statusUpdating={false}
        onToggle={() => {}}
        onFocus={() => {}}
        onToggleEnabled={() => {}}
        onRefreshQuota={() => {}}
      />
    );

    expect(html).toContain('Enabled');
    expect(html).not.toContain('monitoring.account_overview_enabled_label_short');
  });

  it('renders table expanded details with token cards and a nine-column top model table', () => {
    const row = {
      id: 'account@example.com',
      account: 'account@example.com',
      displayAccount: 'account@example.com',
      accountMasked: 'acc***@example.com',
      authLabels: ['alpha'],
      authIndices: ['1'],
      channels: ['default'],
      totalCalls: 221,
      successCalls: 220,
      failureCalls: 1,
      successRate: 0.995,
      inputTokens: 35_000_000,
      outputTokens: 68_500,
      cachedTokens: 33_900_000,
      totalTokens: 35_068_500,
      totalCost: 23.04,
      averageLatencyMs: 120,
      lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
      recentPattern: [true, true],
      models: [
        {
          model: 'gpt-5.5',
          totalCalls: 196,
          successCalls: 195,
          failureCalls: 1,
          successRate: 0.995,
          inputTokens: 33_400_000,
          outputTokens: 66_600,
          cachedTokens: 32_500_000,
          totalTokens: 33_466_600,
          totalCost: 23.04,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
        },
        {
          model: 'codex-auto-review',
          totalCalls: 25,
          successCalls: 24,
          failureCalls: 1,
          successRate: 0.96,
          inputTokens: 1_600_000,
          outputTokens: 1_900,
          cachedTokens: 1_400_000,
          totalTokens: 1_601_900,
          totalCost: 0,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 1, 0),
        },
        {
          model: 'long-tail-model',
          totalCalls: 1,
          successCalls: 1,
          failureCalls: 0,
          successRate: 1,
          inputTokens: 100,
          outputTokens: 20,
          cachedTokens: 0,
          totalTokens: 120,
          totalCost: 0.01,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 2, 0),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <AccountExpandedDetails
        row={row}
        hasPrices
        locale="en"
        t={t}
        summaryMetrics={[
          { key: 'total-tokens', label: 'Total Tokens', value: '35.1M' },
          { key: 'input-tokens', label: 'Input Tokens', value: '35.0M' },
          { key: 'output-tokens', label: 'Output Tokens', value: '68.5K' },
          { key: 'cached-tokens', label: 'Cached Tokens', value: '33.9M' },
        ]}
        onRefreshQuota={() => {}}
        variant="table"
      />
    );

    expect(html).toContain('Token Structure');
    expect(html).toContain('Input Tokens');
    expect(html).toContain('Output Tokens');
    expect(html).toContain('Cached Tokens');
    expect(html).toContain('Model Usage Top 2');
    expect(html).toContain('View All');
    expect(html).toContain('<th>Total Tokens</th>');
    expect(html).toContain('<th>Latest request</th>');
    expect(html).toContain('gpt-5.5');
    expect(html).toContain('codex-auto-review');
    expect(html).not.toContain('long-tail-model');
  });

  it('renders a retry button when account quota refresh failed', () => {
    const html = renderToStaticMarkup(
      <AccountExpandedDetails
        row={{
          id: 'account@example.com',
          account: 'account@example.com',
          displayAccount: 'account@example.com',
          accountMasked: 'acc***@example.com',
          authLabels: ['alpha'],
          authIndices: ['1'],
          channels: ['default'],
          totalCalls: 0,
          successCalls: 0,
          failureCalls: 0,
          successRate: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          averageLatencyMs: null,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [],
          models: [],
        }}
        hasPrices={false}
        locale="en"
        t={t}
        summaryMetrics={[
          { key: 'total-tokens', label: 'Total Tokens', value: '0' },
          { key: 'input-tokens', label: 'Input Tokens', value: '0' },
          { key: 'output-tokens', label: 'Output Tokens', value: '0' },
          { key: 'cached-tokens', label: 'Cached Tokens', value: '0' },
        ]}
        quotaState={{
          status: 'error',
          targetKey: 'account@example.com',
          entries: [],
          error: 'upstream timeout',
        }}
        onRefreshQuota={() => {}}
        variant="table"
      />
    );

    expect(html).toContain('Failed to load quota: upstream timeout');
    expect(html).toContain('Retry');
  });
});
