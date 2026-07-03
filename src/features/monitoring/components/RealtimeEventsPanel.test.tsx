import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { AccountDisplayMode } from '@/features/monitoring/accountOverviewState';
import type { MonitoringEventRow } from '@/features/monitoring/hooks/useMonitoringData';
import styles from '../MonitoringCenterPage.module.scss';
import { RealtimeEventsPanel } from './RealtimeEventsPanel';

const t = ((key: string, options?: Record<string, unknown>) => {
  const messages: Record<string, string> = {
    'common.loading': 'Loading',
    'common.copy': 'Copy',
    'monitoring.account_overview_account_display_masked': 'Masked',
    'monitoring.account_overview_account_display_full': 'Full',
    'monitoring.account_overview_show_full_accounts_hint': 'Show full accounts',
    'monitoring.account_overview_show_masked_accounts_hint': 'Show masked accounts',
    'monitoring.cache_creation_tokens_short': 'Create',
    'monitoring.cache_read_tokens_short': 'Read',
    'monitoring.column_latency': 'Latency',
    'monitoring.column_model': 'Model',
    'monitoring.column_output_tps': 'TPS',
    'monitoring.column_source_api_key': 'Source / API Key',
    'monitoring.column_success_rate': 'Success',
    'monitoring.column_time': 'Time',
    'monitoring.column_type': 'Type',
    'monitoring.elapsed_short': 'Elapsed',
    'monitoring.executor_type_short': 'Executor',
    'monitoring.fail_status_code_short': 'HTTP',
    'monitoring.filter_account': 'Account',
    'monitoring.filter_status_failed': 'Failed only',
    'monitoring.filter_provider': 'Provider',
    'monitoring.load_more_events': 'Load more',
    'monitoring.log_rows': 'Rows',
    'monitoring.no_more_events': 'No more events',
    'monitoring.events_loaded_summary': 'Loaded {{loaded}} of {{total}} events',
    'monitoring.events_all_loaded': 'All {{total}} events loaded',
    'monitoring.reasoning_effort': 'Effort',
    'monitoring.reasoning_effort_short': 'Effort',
    'monitoring.recent_failures': 'Failures',
    'monitoring.recent_status': 'Recent',
    'monitoring.realtime_api_key_hash': 'API Key hash',
    'monitoring.realtime_api_key_label': 'API Key',
    'monitoring.realtime_api_key_masked': 'Masked key',
    'monitoring.request_status': 'Status',
    'monitoring.result_failed': 'Failed',
    'monitoring.result_success': 'Success',
    'monitoring.service_tier_short': 'Tier',
    'monitoring.this_call_cost': 'Cost',
    'monitoring.this_call_usage': 'Usage',
    'monitoring.ttft_short': 'TTFT',
  };
  let message = messages[key] ?? key;
  if (options) {
    message = message.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String((options as Record<string, unknown>)[name] ?? '')
    );
  }
  return message;
}) as unknown as TFunction;

const noop = vi.fn();

type PanelRow = MonitoringEventRow & {
  requestCount: number;
  successRate: number;
  streamKey: string;
  recentPattern: boolean[];
};

type PanelOverrides = {
  accountDisplayMode?: AccountDisplayMode;
  eventsHasMore?: boolean;
  eventsLoadingMore?: boolean;
  eventsTotalCount?: number;
  eventsLoadedCount?: number;
};

const baseRow = (overrides: Partial<PanelRow> = {}): PanelRow => ({
  id: 'row-1',
  timestamp: '2026-04-25T00:00:00Z',
  timestampMs: Date.UTC(2026, 3, 25, 12, 34, 56),
  dayKey: '2026-04-25',
  hourLabel: '00:00',
  model: 'client-gpt',
  resolvedModel: 'gpt-5.4',
  endpoint: 'POST /v1/chat/completions',
  endpointMethod: 'POST',
  endpointPath: '/v1/chat/completions',
  sourceKey: 'source:user@example.com',
  source: 'user@example.com',
  sourceMasked: 'user@example.com',
  account: 'user@example.com',
  accountMasked: 'user@example.com',
  authIndex: '0',
  authIndexMasked: '0',
  authLabel: '0',
  projectId: '',
  apiKeyHash: '',
  apiKeyLabel: '-',
  apiKeyMasked: '-',
  provider: 'openai',
  planType: '-',
  channel: 'openai',
  channelHost: '-',
  channelDisabled: false,
  failed: false,
  statsIncluded: true,
  latencyMs: 1500,
  ttftMs: 500,
  tokensPerSecond: 20,
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 3,
  cachedTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 33,
  totalCost: 0,
  taskKey: 'task-1',
  searchText: '',
  requestCount: 1,
  successRate: 1,
  streamKey: 'stream-1',
  recentPattern: [true],
  ...overrides,
});

const renderPanel = (row: PanelRow, overrides: PanelOverrides = {}) =>
  renderToStaticMarkup(
    <RealtimeEventsPanel
      embedded
      rows={[row]}
      pagination={{
        currentPage: 1,
        totalPages: 1,
        pageItems: [row],
        startItem: 1,
        endItem: 1,
      }}
      pageSize={10}
      scopedFailureCount={row.failed ? 1 : 0}
      failedOnlyActive={false}
      eventsHasMore={overrides.eventsHasMore ?? false}
      eventsLoadingMore={overrides.eventsLoadingMore ?? false}
      eventsTotalCount={overrides.eventsTotalCount ?? 1}
      eventsLoadedCount={overrides.eventsLoadedCount ?? 1}
      overallLoading={false}
      hasPrices={false}
      accountDisplayMode={overrides.accountDisplayMode ?? 'masked'}
      locale="en-US"
      emptyState={<span>empty</span>}
      t={t}
      onToggleFailedOnly={noop}
      onAccountDisplayModeChange={noop}
      onPageChange={noop}
      onPageSizeChange={noop}
      onLoadMoreEvents={noop}
    />
  );

describe('RealtimeEventsPanel', () => {
  const expectedDate = new Date(baseRow().timestampMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const expectedTime = new Date(baseRow().timestampMs).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  it('renders CPA v7.1.18 usage details for failed rows', () => {
    const markup = renderPanel(
      baseRow({
        failed: true,
        successRate: 0,
        executorType: 'codex',
        reasoningEffort: 'medium',
        serviceTier: 'priority',
        cacheReadTokens: 4,
        cacheCreationTokens: 1,
        failStatusCode: 429,
        failSummary: 'rate limit exceeded',
      })
    );

    expect(markup).toContain('<th>Effort</th>');
    expect(markup).toContain('>TPS</th>');
    expect(markup).toContain('Source / API Key');
    expect(markup).not.toContain('>Executor: codex<');
    expect(markup).not.toContain('Executor: codex');
    expect(markup).toContain('medium');
    expect(markup).toContain('Tier: priority');
    expect(markup).toContain('client-gpt');
    expect(markup).toContain('gpt-5.4');
    expect(markup).not.toContain('Resolved');
    expect(markup).not.toContain('POST /v1/chat/completions');
    expect(markup).toContain('Failed');
    expect(markup).toMatch(/TTFT<\/span><span class="[^"]+">｜<\/span><span class="[^"]+">Elapsed/);
    expect(markup).toContain('500 ms');
    expect(markup).toContain('Elapsed');
    expect(markup).toContain('1.5 s');
    expect(markup).toContain('20');
    expect(markup).toContain('I 10 · O 20 · R 3 · C 5 · Create 1 · Read 4');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain(styles.realtimeFailureTooltip);
    expect(markup).toContain(styles.realtimeFailureTooltipBelow);
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('aria-label="HTTP 429 · rate limit exceeded"');
    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain('HTTP 429');
    expect(markup).toContain('rate limit exceeded');
  });

  it('renders safe defaults when optional usage fields are missing', () => {
    const markup = renderPanel(baseRow({ reasoningTokens: 0 }));

    expect(markup).toContain('<colgroup>');
    expect(markup.match(/<col\b/g)).toHaveLength(12);
    expect(markup).not.toContain('Effort -');
    expect(markup).toContain('<th>Effort</th>');
    expect(markup).toContain('>TPS</th>');
    expect(markup).toContain('Success');
    expect(markup).toMatch(/TTFT<\/span><span class="[^"]+">｜<\/span><span class="[^"]+">Elapsed/);
    expect(markup).toContain(expectedDate);
    expect(markup).toContain(expectedTime);
    expect(markup).toContain('I 10 · O 20 · C 5');
    expect(markup).not.toContain('R 0');
    expect(markup).not.toContain('Read 0');
    expect(markup).not.toContain('Create 0');
    expect(markup).not.toContain('role="tooltip"');
    expect(markup).not.toContain('aria-describedby=');
    expect(markup).not.toContain('HTTP');
  });

  it('renders API key alias inside the source cell without adding another column', () => {
    const markup = renderPanel(
      baseRow({
        apiKeyHash: '1234567890abcdef',
        apiKeyLabel: 'Team A',
        apiKeyMasked: 'sk-...cdef',
        executorType: 'codex',
      })
    );

    expect(markup).toContain('<th>Source / API Key</th>');
    expect(markup).toContain('API Key: Team A');
    expect(markup).not.toContain('#12345678');
    expect(markup).toContain('API Key hash: 1234567890abcdef');
    expect(markup).toContain('Masked key: sk-...cdef');
    expect(markup).toContain('Executor: codex');
    expect(markup).not.toContain('>Executor: codex<');
  });

  it('keeps long realtime model names constrained with a full title', () => {
    const longModel =
      'claude-opus-4-6-thinking-with-a-very-long-provider-routing-suffix-for-realtime-monitoring';
    const markup = renderPanel(baseRow({ model: longModel, resolvedModel: longModel }));

    expect(markup).toContain(`title="${longModel}"`);
    expect(markup).toContain(longModel);
    expect(markup).toMatch(/class="[^"]*realtimeModelCell[^"]*"/);
    expect(markup).toMatch(/class="[^"]*realtimeModelText[^"]*"/);
  });

  it('switches realtime source labels between masked and full display', () => {
    const row = baseRow({
      source: 'very-long-user@example.com',
      sourceMasked: 'ver***@example.com',
      account: 'very-long-user@example.com',
      accountMasked: 'ver***@example.com',
      authLabel: '',
      channel: 'openai',
      channelHost: '-',
      provider: 'openai',
    });
    const maskedMarkup = renderPanel(row);
    const fullMarkup = renderPanel(row, { accountDisplayMode: 'full' });

    expect(maskedMarkup).toContain('>ver***@example.com</span>');
    expect(maskedMarkup).toContain(
      'title="ver***@example.com · Provider: openai · very-long-user@example.com'
    );
    expect(fullMarkup).toContain('>very-long-user@example.com</span>');
    expect(fullMarkup).toContain('title="very-long-user@example.com · Provider: openai');
  });

  it('switches the primary source text instead of adding an account metadata line', () => {
    const row = baseRow({
      source: 'visible-user@example.com',
      sourceMasked: 'vis***@example.com',
      account: 'visible-user@example.com',
      accountMasked: 'vis***@example.com',
      authLabel: '',
      channel: 'openai',
      channelHost: '-',
      provider: 'openai',
    });
    const maskedMarkup = renderPanel(row);
    const fullMarkup = renderPanel(row, { accountDisplayMode: 'full' });

    expect(maskedMarkup).toContain('>vis***@example.com</span>');
    expect(maskedMarkup).not.toContain('<small>Account: vis***@example.com</small>');
    expect(fullMarkup).toContain('>visible-user@example.com</span>');
    expect(fullMarkup).not.toContain('<small>Account: visible-user@example.com</small>');
  });

  it('renders a ttft placeholder when ttft is missing', () => {
    const markup = renderPanel(baseRow({ ttftMs: null }));

    expect(markup).toContain('>TPS</th>');
    expect(markup).toMatch(/TTFT<\/span><span class="[^"]+">｜<\/span><span class="[^"]+">Elapsed/);
    expect(markup).not.toContain('500 ms');
    expect(markup).toContain('1.5 s');
    expect(markup).toMatch(
      /--<\/span><span class="[^"]+">｜<\/span><span class="[^"]*realtimeMetricText[^"]*realtimeMetricRight[^"]*">1\.5 s<\/span>/
    );
  });

  it('keeps latency warning and error tone classes on plain text metrics', () => {
    const warningMarkup = renderPanel(baseRow({ latencyMs: 20_000, ttftMs: 1_000 }));
    const errorMarkup = renderPanel(baseRow({ latencyMs: 35_000, ttftMs: 1_000 }));

    expect(warningMarkup).toMatch(/class="[^"]*realtimeMetricText[^"]*warnText[^"]*"/);
    expect(errorMarkup).toMatch(/class="[^"]*realtimeMetricText[^"]*badText[^"]*"/);
  });

  it('colors normal millisecond and second metrics green for both ttft and elapsed time', () => {
    const markup = renderPanel(baseRow({ latencyMs: 470, ttftMs: 120 }));

    expect(markup).toMatch(
      /class="[^"]*realtimeMetricText[^"]*realtimeMetricLeft[^"]*goodText[^"]*">120 ms/
    );
    expect(markup).toMatch(
      /class="[^"]*realtimeMetricText[^"]*realtimeMetricRight[^"]*goodText[^"]*">470 ms/
    );
  });

  it('renders residual cached tokens even when they equal cache read tokens', () => {
    const markup = renderPanel(
      baseRow({
        cachedTokens: 4,
        cacheReadTokens: 4,
        cacheCreationTokens: 1,
      })
    );

    expect(markup).toContain('C 4');
    expect(markup).toContain('Read 4');
    expect(markup).toContain('Create 1');
  });

  it('shows the loaded vs total summary with a load-more action when more pages exist', () => {
    const markup = renderPanel(baseRow(), {
      eventsHasMore: true,
      eventsLoadedCount: 500,
      eventsTotalCount: 8000,
    });

    expect(markup).toContain('Loaded 500 of 8000 events');
    expect(markup).toContain('Load more');
    expect(markup).not.toContain('Loaded 8000 of 8000');
  });

  it('shows the all-loaded summary without a load-more action once fully loaded', () => {
    const markup = renderPanel(baseRow(), {
      eventsHasMore: false,
      eventsLoadedCount: 8000,
      eventsTotalCount: 8000,
    });

    expect(markup).toContain('All 8000 events loaded');
    expect(markup).not.toContain('Load more');
  });

  it('falls back to the loaded count when the backend omits a larger total', () => {
    const markup = renderPanel(baseRow(), {
      eventsHasMore: true,
      eventsLoadedCount: 500,
      eventsTotalCount: 500,
    });

    expect(markup).toContain('Loaded 500 of 500 events');
    expect(markup).toContain('Load more');
  });
});
