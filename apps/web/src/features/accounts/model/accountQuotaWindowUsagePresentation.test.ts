import { describe, expect, it } from 'vitest';
import type { MonitoringAccountWindowUsageItem } from '@/services/api/usageService';
import type { AccountRow } from './accountRows';
import { accountWindowUsageRequestKey } from './accountWindowUsageRows';
import {
  resolveAccountQuotaWindowUsageAndForecast,
  type AccountQuotaWindowUsagePresentationInput,
} from './accountQuotaWindowUsagePresentation';

const makeAccountRow = (overrides: Partial<AccountRow> = {}): AccountRow =>
  ({
    key: 'account:test:key',
    selectionKey: 'account:test:key',
    fileName: 'account.json',
    provider: 'codex',
    accountLabel: 'test@example.com',
    planType: 'plus',
    priority: 0,
    disabled: false,
    runtimeOnly: false,
    authIndex: '1',
    updatedAtMs: 1000,
    statusMessage: '',
    raw: {
      name: 'account.json',
      type: 'codex',
    },
    usage: {
      success: 0,
      failure: 0,
      successRate: 100,
      recentRequests: [],
    },
    quota: {
      status: 'ok',
      remainingPercent: 100,
      usedPercent: 0,
      resetLabel: '-',
      resetAtMs: null,
      resetAccuracy: 'unknown',
      planType: 'plus',
      source: 'none',
    },
    ...overrides,
  }) as AccountRow;

const makeUsageItem = (
  overrides: Partial<MonitoringAccountWindowUsageItem> = {}
): MonitoringAccountWindowUsageItem => ({
  row_key: 'account:test:key',
  matched: true,
  from_ms: 1000,
  to_ms: 2000,
  total_requests: 10,
  success_calls: 9,
  failure_calls: 1,
  total_tokens: 15_000,
  total_cost: 1.5,
  success_rate: 0.9,
  last_seen_ms: 1500,
  sync_status: 'ready',
  scope_match_status: 'complete',
  unmatched_requests: 0,
  ...overrides,
});

describe('accountQuotaWindowUsagePresentation', () => {
  it('correctly maps matched current usage to cost and tokens', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
      cycleStartMs: 1000,
      cycleEndMs: 3000,
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [reqKey, makeUsageItem({ total_cost: 2.5, total_tokens: 20_000 })],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.currentCost).toBe(2.5);
    expect(result.currentTokens).toBe(20_000);
  });

  it('handles matched actual 0 correctly', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [reqKey, makeUsageItem({ total_cost: 0, total_tokens: 0, total_requests: 0 })],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.currentCost).toBe(0);
    expect(result.currentTokens).toBe(0);
  });

  it('does not treat unmatched current usage as trusted 0 or trusted actual', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [reqKey, makeUsageItem({ matched: false })],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(false);
    expect(result.currentCost).toBeNull();
    expect(result.currentTokens).toBeNull();
  });

  it('does not treat incomplete model scope as trusted current actual', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [reqKey, makeUsageItem({ scope_match_status: 'partial' })],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(false);
    expect(result.currentCost).toBeNull();
    expect(result.currentTokens).toBeNull();
  });

  it('produces forecast when current usage and reliable quota progress are available', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
      cycleStartMs: 1000,
      cycleEndMs: 5000,
      usedPercent: 50,
      quotaProgressObservedAtMs: 3000,
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [
        reqKey,
        makeUsageItem({
          total_cost: 2.0,
          total_tokens: 10_000,
          last_seen_ms: 2500,
        }),
      ],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.currentCost).toBe(2.0);
    expect(result.currentTokens).toBe(10_000);
    expect(result.forecast).not.toBeNull();
    expect(result.forecastCost).toBe(4.0); // 2.0 / 0.5
    expect(result.forecastTokens).toBe(20_000);
  });

  it('supports previous usage fallback when current has no observation', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
      cycleStartMs: 1000,
      cycleEndMs: 5000,
      usedPercent: 20,
      quotaProgressObservedAtMs: 2000,
    };
    const prevReqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'previous');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [
        prevReqKey,
        makeUsageItem({
          total_cost: 10.0,
          total_tokens: 50_000,
        }),
      ],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(false);
    // Detail VM gets the forecast from previous cycle:
    expect(result.forecast).not.toBeNull();
    expect(result.forecast?.cost).toBe(10.0);
    // But list presentation must NOT show standalone forecast without current actual:
    expect(result.forecastCost).toBeNull();
    expect(result.forecastTokens).toBeNull();
  });

  it('does not forecast rolling window as fixed/calendar', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'rolling-1',
      providerWindowId: 'rolling-1',
      windowMode: 'rolling',
      usedPercent: 50,
      quotaProgressObservedAtMs: 3000,
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'rolling-1', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [reqKey, makeUsageItem({ total_cost: 1.0, total_tokens: 5000, last_seen_ms: 2000 })],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.currentCost).toBe(1.0);
    expect(result.forecast).toBeNull();
    expect(result.forecastCost).toBeNull();
  });

  it('does not forecast when stale or inactive lifecycle', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
      cycleStartMs: 1000,
      cycleEndMs: 5000,
      usedPercent: 50,
      quotaProgressObservedAtMs: 3000,
      availability: 'inactive',
      stale: true,
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [reqKey, makeUsageItem({ total_cost: 2.0, total_tokens: 10_000, last_seen_ms: 2500 })],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.forecast).toBeNull();
  });

  it('does not do unsafe quota scaling when usage observation is after quota progress observation', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
      cycleStartMs: 1000,
      cycleEndMs: 5000,
      usedPercent: 50,
      quotaProgressObservedAtMs: 2000, // quota observed at 2000
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [
        reqKey,
        makeUsageItem({
          total_cost: 3.0,
          total_tokens: 15_000,
          last_seen_ms: 2500, // usage occurred AFTER quota observation
        }),
      ],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.currentCost).toBe(3.0);
    // Scaling should not be attempted on current usage that is ahead of quota observation
    expect(result.forecast).toBeNull();
    expect(result.forecastCost).toBeNull();
  });

  it('ensures forecast is never lower than trusted current actual', () => {
    const row = makeAccountRow();
    const window: AccountQuotaWindowUsagePresentationInput = {
      key: 'five-hour',
      providerWindowId: 'five-hour',
      windowMode: 'fixed',
      cycleStartMs: 1000,
      cycleEndMs: 5000,
      usedPercent: 80,
      quotaProgressObservedAtMs: 3000,
    };
    const reqKey = accountWindowUsageRequestKey(row.selectionKey, 'five-hour', 'current');
    // If estimateWindowUsage somehow gave a smaller result than trusted actual, forecast is discarded
    const usageByKey = new Map<string, MonitoringAccountWindowUsageItem>([
      [
        reqKey,
        makeUsageItem({
          total_cost: 10.0,
          total_tokens: 100_000,
          last_seen_ms: 2500,
        }),
      ],
    ]);

    const result = resolveAccountQuotaWindowUsageAndForecast(row, window, usageByKey);
    expect(result.hasTrustedCurrentActual).toBe(true);
    expect(result.currentCost).toBe(10.0);
    if (result.forecast) {
      expect(result.forecast.cost).toBeGreaterThanOrEqual(10.0);
      expect(result.forecast.tokens).toBeGreaterThanOrEqual(100_000);
    }
  });
});
