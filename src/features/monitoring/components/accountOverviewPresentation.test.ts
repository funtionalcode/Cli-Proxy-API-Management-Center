import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  buildAccountQuotaInfoRows,
  type AccountQuotaEntry,
} from './accountOverviewPresentation';

const translations: Record<string, string> = {
  'codex_quota.tooltip_source_label': 'Source',
  'codex_quota.tooltip_source_api': 'Quota API',
  'codex_quota.tooltip_source_header': 'Latest usage response header',
  'codex_quota.tooltip_fetched_at_label': 'Fetched at',
  'codex_quota.tooltip_recorded_at_label': 'Recorded at',
};

const t = ((key: string) => translations[key] ?? key) as TFunction;

const createEntry = (overrides: Partial<AccountQuotaEntry> = {}): AccountQuotaEntry => ({
  key: 'codex::1::codex.json',
  provider: 'codex',
  providerLabel: 'Codex Quota',
  authLabel: 'Codex account',
  fileName: 'codex.json',
  planType: 'plus',
  windows: [],
  ...overrides,
});

describe('buildAccountQuotaInfoRows', () => {
  it('shows both sources and separate API/header timestamps for mixed entries', () => {
    const fetchedAtMs = Date.UTC(2026, 6, 1, 0, 0, 0);
    const observedAtMs = Date.UTC(2026, 6, 1, 0, 5, 0);

    expect(
      buildAccountQuotaInfoRows(
        createEntry({ fetchedAtMs, observedAtMs, observedFromUsageHeaders: true }),
        'en-US',
        t
      )
    ).toEqual([
      { key: 'source', label: 'Source', value: 'Quota API + Latest usage response header' },
      {
        key: 'fetched-at',
        label: 'Fetched at',
        value: new Date(fetchedAtMs).toLocaleString('en-US'),
      },
      {
        key: 'recorded-at',
        label: 'Recorded at',
        value: new Date(observedAtMs).toLocaleString('en-US'),
      },
    ]);
  });

  it('shows only the API source and fetched timestamp for API-only entries', () => {
    const fallbackFetchedAtMs = Date.UTC(2026, 6, 1, 1, 0, 0);

    expect(
      buildAccountQuotaInfoRows(createEntry(), 'en-US', t, fallbackFetchedAtMs)
    ).toEqual([
      { key: 'source', label: 'Source', value: 'Quota API' },
      {
        key: 'fetched-at',
        label: 'Fetched at',
        value: new Date(fallbackFetchedAtMs).toLocaleString('en-US'),
      },
    ]);
  });

  it('shows only the header source and recorded timestamp for header-only entries', () => {
    const observedAtMs = Date.UTC(2026, 6, 1, 2, 0, 0);

    expect(
      buildAccountQuotaInfoRows(
        createEntry({ observedAtMs, observedFromUsageHeaders: true }),
        'en-US',
        t,
        Date.UTC(2026, 6, 1, 3, 0, 0)
      )
    ).toEqual([
      { key: 'source', label: 'Source', value: 'Latest usage response header' },
      {
        key: 'recorded-at',
        label: 'Recorded at',
        value: new Date(observedAtMs).toLocaleString('en-US'),
      },
    ]);
  });
});
