import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { USAGE_ANALYTICS_DEFAULT_FILTERS } from './usageAnalyticsModel';
import {
  USAGE_ANALYTICS_UI_STATE_STORAGE_KEY,
  buildUsageAnalyticsSearchParams,
  buildUsageAnalyticsUiStateFromSearchParams,
  getDefaultUsageAnalyticsUiState,
  normalizeUsageAnalyticsFilters,
  normalizeUsageAnalyticsUiState,
  readUsageAnalyticsUiState,
  writeUsageAnalyticsUiState,
} from './usageAnalyticsUiState';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const createMemoryStorage = (): StorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

const originalWindow = (globalThis as { window?: unknown }).window;

describe('usageAnalyticsUiState', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = createMemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('uses 24h defaults when storage is empty', () => {
    expect(getDefaultUsageAnalyticsUiState()).toEqual({
      activeTab: 'overview',
      filters: USAGE_ANALYTICS_DEFAULT_FILTERS,
    });
    expect(readUsageAnalyticsUiState()).toEqual(getDefaultUsageAnalyticsUiState());
    expect(readUsageAnalyticsUiState().filters.timeRange).toBe('24h');
  });

  it('normalizes persisted filters and ignores removed fields', () => {
    const filters = normalizeUsageAnalyticsFilters({
      timeRange: 'custom',
      customRange: { startMs: 1_000, endMs: 2_000 },
      granularity: 'day',
      model: ' gpt-4o ',
      apiKeyHash: ' hash ',
      provider: '',
      authFile: 'auth.json',
      status: 'failed',
      searchQuery: 'req-42',
      minLatencyMs: '10000',
      cacheStatus: 'hit',
      apiKeyKeyword: 'key',
      requestType: 'codex',
      projectId: 'project-a',
      excludeZeroToken: true,
    });

    expect(filters).toEqual({
      ...USAGE_ANALYTICS_DEFAULT_FILTERS,
      timeRange: 'custom',
      customRange: { startMs: 1_000, endMs: 2_000 },
      granularity: 'day',
      model: 'gpt-4o',
      apiKeyHash: 'hash',
      provider: 'all',
      authFile: 'auth.json',
      status: 'failed',
      searchQuery: 'req-42',
      minLatencyMs: '10000',
      cacheStatus: 'hit',
      apiKeyKeyword: 'key',
    });
    expect('requestType' in filters).toBe(false);
    expect('projectId' in filters).toBe(false);
    expect('excludeZeroToken' in filters).toBe(false);
  });

  it('falls back to safe defaults for dirty persisted values', () => {
    expect(
      normalizeUsageAnalyticsUiState({
        filters: {
          timeRange: 'custom',
          customRange: { startMs: 3_000, endMs: 2_000 },
          granularity: 'bad',
          status: 'bad',
          minLatencyMs: '1',
          cacheStatus: 'read',
          model: '',
          searchQuery: 42,
        },
      })
    ).toEqual({
      activeTab: 'overview',
      filters: {
        ...USAGE_ANALYTICS_DEFAULT_FILTERS,
        model: 'all',
      },
    });
  });

  it('persists and reads filters via localStorage', () => {
    writeUsageAnalyticsUiState({
      filters: {
        ...USAGE_ANALYTICS_DEFAULT_FILTERS,
        timeRange: '7d',
        model: 'gpt-4o',
        cacheStatus: 'miss',
      },
    });

    expect(JSON.parse(storage.getItem(USAGE_ANALYTICS_UI_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      activeTab: 'overview',
      filters: {
        ...USAGE_ANALYTICS_DEFAULT_FILTERS,
        timeRange: '7d',
        model: 'gpt-4o',
        cacheStatus: 'miss',
      },
    });
    expect(readUsageAnalyticsUiState()).toEqual({
      activeTab: 'overview',
      filters: {
        ...USAGE_ANALYTICS_DEFAULT_FILTERS,
        timeRange: '7d',
        model: 'gpt-4o',
        cacheStatus: 'miss',
      },
    });
  });

  it('returns defaults when stored payload is invalid JSON', () => {
    storage.setItem(USAGE_ANALYTICS_UI_STATE_STORAGE_KEY, '{not json');
    expect(readUsageAnalyticsUiState()).toEqual(getDefaultUsageAnalyticsUiState());
  });

  it('builds ui state from usage analytics query parameters', () => {
    const state = buildUsageAnalyticsUiStateFromSearchParams(
      new URLSearchParams(
        'tab=apiKeys&time_range=custom&from_ms=1000&to_ms=2000&granularity=day&model=gpt-4o&api_key_hash=ABC&provider=OpenAI&auth_file=auth.json&status=failed&search=req-42&min_latency_ms=10000&cache_status=hit&api_key_keyword=key'
      )
    );

    expect(state).toEqual({
      activeTab: 'apiKeys',
      filters: {
        ...USAGE_ANALYTICS_DEFAULT_FILTERS,
        timeRange: 'custom',
        customRange: { startMs: 1_000, endMs: 2_000 },
        granularity: 'day',
        model: 'gpt-4o',
        apiKeyHash: 'ABC',
        provider: 'OpenAI',
        authFile: 'auth.json',
        status: 'failed',
        searchQuery: 'req-42',
        minLatencyMs: '10000',
        cacheStatus: 'hit',
        apiKeyKeyword: 'key',
      },
    });
  });

  it('serializes non-default usage analytics state into query parameters', () => {
    const params = buildUsageAnalyticsSearchParams({
      activeTab: 'apiKeys',
      filters: {
        ...USAGE_ANALYTICS_DEFAULT_FILTERS,
        timeRange: 'custom',
        customRange: { startMs: 1_000, endMs: 2_000 },
        granularity: 'day',
        model: 'gpt-4o',
        apiKeyHash: 'ABC',
        provider: 'OpenAI',
        authFile: 'auth.json',
        status: 'failed',
        searchQuery: 'req-42',
        minLatencyMs: '10000',
        cacheStatus: 'hit',
        apiKeyKeyword: 'key',
      },
    });

    expect(params.get('tab')).toBe('apiKeys');
    expect(params.get('time_range')).toBe('custom');
    expect(params.get('from_ms')).toBe('1000');
    expect(params.get('to_ms')).toBe('2000');
    expect(params.get('granularity')).toBe('day');
    expect(params.get('model')).toBe('gpt-4o');
    expect(params.get('api_key_hash')).toBe('ABC');
    expect(params.get('provider')).toBe('OpenAI');
    expect(params.get('auth_file')).toBe('auth.json');
    expect(params.get('status')).toBe('failed');
    expect(params.get('search')).toBe('req-42');
    expect(params.get('min_latency_ms')).toBe('10000');
    expect(params.get('cache_status')).toBe('hit');
    expect(params.get('api_key_keyword')).toBe('key');
  });
});
