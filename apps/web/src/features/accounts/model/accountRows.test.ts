import { describe, expect, it, vi } from 'vitest';
import type { AuthFileItem, CodexQuotaState, CredentialScopedQuotaState } from '@/types';
import type { UsageHeaderSnapshot } from '@/services/api/usageService';
import {
  getAuthFileCodexStatus,
  getAuthFileSelectionKey,
} from '@/features/authFiles/model/authFilesPageModel';
import {
  buildAccountMetrics,
  buildAccountRows as buildAccountRowsBase,
  findAccountRowForInspectionTarget,
  filterAccountRows,
  getPlanOptions,
  sortAccountRows,
  type AccountInspectionResult,
  type AccountQuotaStores,
} from './accountRows';
import {
  buildQuotaCredentialIdentity,
  getQuotaCredentialStoreKey,
} from '@/utils/quota/credentialScope';

const emptyStores = (): AccountQuotaStores => ({
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  kimiQuota: {},
  xaiQuota: {},
});

const scopeTestQuotaStores = (files: AuthFileItem[], stores: AccountQuotaStores) => {
  const fileNameCounts = files.reduce((counts, file) => {
    counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const records = [
    stores.antigravityQuota,
    stores.claudeQuota,
    stores.codexQuota,
    stores.kimiQuota,
    stores.xaiQuota,
  ] as Array<Record<string, CredentialScopedQuotaState>>;

  files.forEach((file) => {
    records.forEach((record) => {
      const legacy = record[file.name];
      if (!legacy || (!legacy.authFileKey && fileNameCounts.get(file.name) !== 1)) return;
      const identity = buildQuotaCredentialIdentity(file);
      const storeKey = legacy.authFileKey || getQuotaCredentialStoreKey(file);
      record[storeKey] = { ...legacy, ...identity, authFileKey: storeKey };
    });
  });
  return stores;
};

const buildAccountRows = (
  files: AuthFileItem[],
  stores: AccountQuotaStores,
  inspectionResults?: Parameters<typeof buildAccountRowsBase>[2],
  overrides?: Parameters<typeof buildAccountRowsBase>[3]
) => buildAccountRowsBase(files, scopeTestQuotaStores(files, stores), inspectionResults, overrides);

describe('accountRows', () => {
  it('normalizes Codex quota usage into remaining percent and risk status', () => {
    const files: AuthFileItem[] = [
      {
        name: 'codex-low.json',
        type: 'codex',
        authIndex: '1',
      },
    ];
    const rows = buildAccountRows(files, {
      ...emptyStores(),
      codexQuota: {
        'codex-low.json': {
          status: 'success',
          planType: 'plus',
          windows: [
            {
              id: 'weekly',
              label: 'Weekly',
              usedPercent: 87,
              resetLabel: 'Mon',
            },
          ],
        },
      },
    });

    expect(rows[0].quota.remainingPercent).toBe(13);
    expect(rows[0].quota.usedPercent).toBe(87);
    expect(rows[0].quota.status).toBe('low');
    expect(rows[0].planType).toBe('plus');
  });

  it('reads the Codex plan from a nested ID token payload', () => {
    const [row] = buildAccountRows(
      [
        {
          name: 'nested-plan.codex.json',
          type: 'codex',
          metadata: {
            id_token: JSON.stringify({ plan_type: 'plus' }),
          },
        },
      ],
      emptyStores()
    );

    expect(row.planType).toBe('plus');
    expect(row.quota.planType).toBe('plus');
  });

  it('uses the latest recovery across equally exhausted Codex windows', () => {
    const earlierResetAtMs = Date.parse('2026-07-30T04:00:00Z');
    const laterResetAtMs = Date.parse('2026-07-30T06:00:00Z');
    const rows = buildAccountRows([{ name: 'codex.json', type: 'codex' }], {
      ...emptyStores(),
      codexQuota: {
        'codex.json': {
          status: 'success',
          windows: [
            {
              id: 'weekly-base',
              label: 'Weekly base',
              usedPercent: 100,
              resetLabel: '2026-07-30T04:00:00Z',
              resetAtMs: earlierResetAtMs,
              resetAccuracy: 'exact',
            },
            {
              id: 'weekly-model',
              label: 'Weekly model',
              usedPercent: 100,
              resetLabel: '2026-07-30T06:00:00Z',
              resetAtMs: laterResetAtMs,
              resetAccuracy: 'exact',
            },
          ],
        },
      },
    });

    expect(rows[0].quota).toMatchObject({
      status: 'exhausted',
      resetLabel: '2026-07-30T06:00:00Z',
      resetAtMs: laterResetAtMs,
      resetAccuracy: 'exact',
    });
  });

  it('does not promise recovery when an equally exhausted Codex window has no reset time', () => {
    const rows = buildAccountRows([{ name: 'codex.json', type: 'codex' }], {
      ...emptyStores(),
      codexQuota: {
        'codex.json': {
          status: 'success',
          windows: [
            {
              id: 'weekly-known',
              label: 'Weekly known',
              usedPercent: 100,
              resetLabel: '2026-07-30T04:00:00Z',
              resetAtMs: Date.parse('2026-07-30T04:00:00Z'),
              resetAccuracy: 'exact',
            },
            {
              id: 'weekly-unknown',
              label: 'Weekly unknown',
              usedPercent: 100,
              resetLabel: '-',
              resetAtMs: null,
              resetAccuracy: 'unknown',
            },
          ],
        },
      },
    });

    expect(rows[0].quota).toMatchObject({
      status: 'exhausted',
      resetLabel: '-',
      resetAtMs: null,
      resetAccuracy: 'unknown',
    });
  });

  it('rejects an out-of-range cached reset timestamp and recovers from its ISO label', () => {
    const resetAtMs = Date.parse('2026-07-30T04:00:00Z');
    const [row] = buildAccountRows([{ name: 'codex.json', type: 'codex' }], {
      ...emptyStores(),
      codexQuota: {
        'codex.json': {
          status: 'success',
          windows: [
            {
              id: 'weekly',
              label: 'Weekly',
              usedPercent: 100,
              resetLabel: '2026-07-30T04:00:00Z',
              resetAtMs: Number.MAX_VALUE,
              resetAccuracy: 'exact',
            },
          ],
        },
      },
    });

    expect(row.quota).toMatchObject({
      resetAtMs,
      resetAccuracy: 'unknown',
    });
  });

  it('keeps the last successful Codex windows visible after a refresh failure', () => {
    const rows = buildAccountRows([{ name: 'codex-stale.json', type: 'codex', authIndex: '1' }], {
      ...emptyStores(),
      codexQuota: {
        'codex-stale.json': {
          status: 'error',
          error: 'temporary failure',
          errorStatus: 503,
          fetchedAtMs: 1_000,
          windows: [
            {
              id: 'weekly',
              label: 'Weekly',
              usedPercent: 25,
              resetLabel: 'Mon',
            },
          ],
        },
      },
    });

    expect(rows[0].quota).toMatchObject({
      status: 'ok',
      remainingPercent: 75,
      error: 'temporary failure',
      errorStatus: 503,
      fetchedAtMs: 1_000,
    });
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'problem',
        plan: 'all',
        quotaBand: 'all',
        search: '',
      })
    ).toHaveLength(1);
    expect(buildAccountMetrics(rows).available).toBe(0);
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'available',
        plan: 'all',
        quotaBand: 'all',
        search: '',
      })
    ).toHaveLength(0);
  });

  it('marks observed Codex usage header quota and searches header diagnostics', () => {
    const rows = buildAccountRows(
      [
        {
          name: 'codex-observed.json',
          type: 'codex',
          authIndex: '2',
          account: 'observed@example.com',
        },
      ],
      {
        ...emptyStores(),
        codexQuota: {
          'codex-observed.json': {
            status: 'success',
            planType: 'plus',
            windows: [
              {
                id: 'usage-header-observed',
                label: 'Latest request',
                usedPercent: 100,
                resetLabel: '2026-06-25 10:00',
              },
            ],
            observedFromUsageHeaders: true,
            observedAtMs: 1000,
            observedTraceId: 'trace-observed',
            observedErrorKind: 'rate_limit',
            observedErrorCode: 'usage_limit',
            activeLimit: 'primary',
            rateLimitReachedType: 'primary',
          },
        },
      }
    );

    expect(rows[0].quota.source).toBe('observed-header');
    expect(rows[0].quota.status).toBe('exhausted');
    expect(rows[0].quota.observedTraceId).toBe('trace-observed');
    expect(rows[0].quota.observedErrorCode).toBe('usage_limit');

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'all',
        search: 'trace-observed',
      }).map((row) => row.fileName)
    ).toEqual(['codex-observed.json']);

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'all',
        search: 'usage_limit',
      }).map((row) => row.fileName)
    ).toEqual(['codex-observed.json']);
  });

  it('supports wildcard search across account notes', () => {
    const rows = buildAccountRows(
      [
        {
          name: 'primary-codex.json',
          type: 'codex',
          account: 'primary@example.com',
          note: 'Production Team Alpha',
        },
        {
          name: 'backup-codex.json',
          type: 'codex',
          account: 'backup@example.com',
          note: 'Standby Team Beta',
        },
      ],
      emptyStores()
    );

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'all',
        search: 'prod*alpha',
      }).map((row) => row.fileName)
    ).toEqual(['primary-codex.json']);
  });

  it('builds selection keys with auth indexes for shared auth rows', () => {
    const rows = buildAccountRows(
      [
        { name: 'shared.codex.json', type: 'codex', authIndex: '0' },
        { name: 'plain.codex.json', type: 'codex' },
      ],
      emptyStores()
    );

    expect(rows[0].selectionKey).toBe('shared.codex.json\u00000');
    expect(rows[1].selectionKey).toBe(
      getAuthFileSelectionKey({ name: 'plain.codex.json', type: 'codex' })
    );
  });

  it('uses selection-key Codex quota overrides for shared auth rows', () => {
    const rows = buildAccountRows(
      [
        { name: 'shared.codex.json', type: 'codex', authIndex: '0' },
        { name: 'shared.codex.json', type: 'codex', authIndex: '1' },
      ],
      emptyStores(),
      undefined,
      {
        codexQuotaBySelectionKey: new Map<string, CodexQuotaState>([
          [
            'shared.codex.json\u00000',
            {
              status: 'success',
              windows: [{ id: 'a', label: 'A', usedPercent: 10, resetLabel: 'A reset' }],
            },
          ],
          [
            'shared.codex.json\u00001',
            {
              status: 'success',
              windows: [{ id: 'b', label: 'B', usedPercent: 90, resetLabel: 'B reset' }],
              observedFromUsageHeaders: true,
              observedTraceId: 'trace-auth-index-1',
            },
          ],
        ]),
      }
    );

    expect(rows[0].quota.usedPercent).toBe(10);
    expect(rows[0].quota.source).toBe('cache');
    expect(rows[1].quota.usedPercent).toBe(90);
    expect(rows[1].quota.source).toBe('observed-header');
    expect(rows[1].quota.observedTraceId).toBe('trace-auth-index-1');
  });

  it('finds inspection targets exactly and only falls back for unique file names', () => {
    const sharedRows = buildAccountRows(
      [
        { name: 'shared.codex.json', type: 'codex', authIndex: '0' },
        { name: 'shared.codex.json', type: 'codex', authIndex: '1' },
      ],
      emptyStores()
    );
    const uniqueRows = buildAccountRows(
      [{ name: 'unique.codex.json', type: 'codex', authIndex: '2' }],
      emptyStores()
    );

    expect(
      findAccountRowForInspectionTarget(sharedRows, {
        fileName: 'shared.codex.json',
        authIndex: '1',
      })?.selectionKey
    ).toBe('shared.codex.json\u00001');
    expect(
      findAccountRowForInspectionTarget(sharedRows, {
        fileName: 'shared.codex.json',
        authIndex: null,
      })
    ).toBeNull();
    expect(
      findAccountRowForInspectionTarget(uniqueRows, {
        fileName: 'unique.codex.json',
        provider: 'codex',
        authIndex: null,
      })?.selectionKey
    ).toBe('unique.codex.json\u00002');
  });

  it('matches Codex inspection results by auth index for shared auth rows', () => {
    const inspection: AccountInspectionResult = {
      id: 10,
      runId: 1,
      accountKey: 'second',
      fileName: 'shared.codex.json',
      displayAccount: 'second@example.com',
      authIndex: '1',
      provider: 'codex',
      disabled: false,
      action: 'reauth',
      actionReason: 'expired',
      statusCode: 401,
      isQuota: false,
      createdAtMs: 1000,
      inspectionSource: 'server',
    };
    const rows = buildAccountRows(
      [
        { name: 'shared.codex.json', type: 'codex', authIndex: '0' },
        { name: 'shared.codex.json', type: 'codex', authIndex: '1' },
      ],
      emptyStores(),
      [inspection]
    );

    expect(rows[0].inspection).toBeNull();
    expect(rows[1].inspection?.action).toBe('reauth');
    expect(rows[1].inspection?.statusCode).toBe(401);
    expect(rows[1].inspection?.source).toBe('server');
  });

  it('matches same-file inspection results by canonical identity without auth indexes', () => {
    const files: AuthFileItem[] = [
      {
        id: 'runtime-first',
        name: 'shared.codex.json',
        type: 'codex',
        provider: 'codex',
        account: 'first@example.com',
      },
      {
        id: 'runtime-second',
        name: 'shared.codex.json',
        type: 'codex',
        provider: 'codex',
        account: 'second@example.com',
      },
    ];
    const inspection: AccountInspectionResult = {
      id: 11,
      runId: 2,
      accountKey: 'second',
      fileName: 'shared.codex.json',
      displayAccount: 'second@example.com',
      runtimeId: 'runtime-second',
      provider: 'codex',
      accountSnapshot: 'second@example.com',
      disabled: false,
      action: 'reauth',
      actionReason: 'expired',
      statusCode: 401,
      isQuota: false,
      createdAtMs: 1000,
      inspectionSource: 'server',
    };
    const rows = buildAccountRows(files, emptyStores(), [inspection]);

    expect(rows[0].inspection).toBeNull();
    expect(rows[1].inspection).toMatchObject({ action: 'reauth', statusCode: 401 });
    expect(
      findAccountRowForInspectionTarget(rows, {
        fileName: 'shared.codex.json',
        runtimeId: 'runtime-second',
        provider: 'codex',
        accountSnapshot: 'second@example.com',
      })?.selectionKey
    ).toBe(rows[1].selectionKey);
  });

  it('uses missing-auth-index inspection results only for unique file names', () => {
    const inspection: AccountInspectionResult = {
      id: -1,
      runId: 0,
      accountKey: 'local-only',
      fileName: 'shared.codex.json',
      displayAccount: 'local@example.com',
      provider: 'codex',
      disabled: false,
      action: 'disable',
      actionReason: 'local reason',
      statusCode: 429,
      isQuota: true,
      createdAtMs: 1000,
      inspectionSource: 'local',
    };
    const uniqueRows = buildAccountRows(
      [{ name: 'shared.codex.json', type: 'codex', authIndex: '0' }],
      emptyStores(),
      [inspection]
    );
    const sharedRows = buildAccountRows(
      [
        { name: 'shared.codex.json', type: 'codex', authIndex: '0' },
        { name: 'shared.codex.json', type: 'codex', authIndex: '1' },
      ],
      emptyStores(),
      [inspection]
    );

    expect(uniqueRows[0].inspection).toMatchObject({ action: 'disable', source: 'local' });
    expect(sharedRows[0].inspection).toBeNull();
    expect(sharedRows[1].inspection).toBeNull();
  });

  it('surfaces diagnostic-only Codex header snapshots without quota cache', () => {
    const snapshot: UsageHeaderSnapshot = {
      event_hash: 'diagnostic-only',
      timestamp_ms: 1700000000000,
      header_trace_id: 'trace-diagnostic-only',
      header_error_kind: 'rate_limit',
      header_error_code: 'usage_limit_reached',
    };
    const rows = buildAccountRows(
      [
        {
          name: 'codex-diagnostic.json',
          type: 'codex',
          authIndex: '2',
          account: 'diagnostic@example.com',
        },
      ],
      emptyStores(),
      undefined,
      {
        codexHeaderSnapshotBySelectionKey: new Map<string, UsageHeaderSnapshot>([
          ['codex-diagnostic.json\u00002', snapshot],
        ]),
      }
    );

    expect(rows[0].quota.source).toBe('observed-header');
    expect(rows[0].quota.status).toBe('unknown');
    expect(rows[0].quota.usedPercent).toBeNull();
    expect(rows[0].quota.observedAtMs).toBe(1700000000000);
    expect(rows[0].quota.observedTraceId).toBe('trace-diagnostic-only');
    expect(rows[0].quota.observedErrorKind).toBe('rate_limit');
    expect(rows[0].quota.observedErrorCode).toBe('usage_limit_reached');

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'all',
        search: 'trace-diagnostic-only',
      }).map((row) => row.fileName)
    ).toEqual(['codex-diagnostic.json']);

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'all',
        search: 'usage_limit_reached',
      }).map((row) => row.fileName)
    ).toEqual(['codex-diagnostic.json']);
  });

  it('uses Antigravity quota buckets and subscription plan in account rows', () => {
    const rows = buildAccountRows([{ name: 'antigravity.json', type: 'antigravity' }], {
      ...emptyStores(),
      antigravityQuota: {
        'antigravity.json': {
          status: 'success',
          subscription: {
            plan: 'pro',
            tierName: 'Pro',
            tierId: 'pro',
          },
          groups: [
            {
              id: 'primary',
              label: 'Primary',
              buckets: [
                {
                  id: 'weekly',
                  label: 'Weekly',
                  remainingFraction: 0.42,
                  resetTime: '07-11 12:00',
                },
              ],
            },
          ],
        },
      },
    });

    expect(rows[0].planType).toBe('pro');
    expect(rows[0].quota.remainingPercent).toBe(42);
    expect(rows[0].quota.usedPercent).toBe(58);
    expect(rows[0].quota.resetLabel).toBe('07-11 12:00');
  });

  it('normalizes legacy yearless reset labels against the next recovery year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 0, 0, 0));
    try {
      const [row] = buildAccountRows([{ name: 'legacy-reset.json', type: 'codex' }], {
        ...emptyStores(),
        codexQuota: {
          'legacy-reset.json': {
            status: 'success',
            windows: [
              {
                id: 'weekly',
                label: 'Weekly',
                usedPercent: 50,
                resetLabel: '01/01 01:30',
              },
            ],
          },
        },
      });

      expect(row.quota.resetAtMs).toBe(new Date(2027, 0, 1, 1, 30, 0, 0).getTime());
      expect(row.quota.resetAccuracy).toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Antigravity available while at least one model group can serve requests', () => {
    const rows = buildAccountRows(
      [
        { name: 'codex-healthy.json', type: 'codex' },
        {
          name: 'antigravity-mixed.json',
          type: 'antigravity',
          status: 'cooldown',
          statusMessage: 'Gemini 5-hour pool exhausted; waiting for Antigravity reset',
        },
      ],
      {
        ...emptyStores(),
        codexQuota: {
          'codex-healthy.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 20, resetLabel: 'Mon' }],
          },
        },
        antigravityQuota: {
          'antigravity-mixed.json': {
            status: 'success',
            groups: [
              {
                id: 'gemini',
                label: 'Gemini models',
                buckets: [
                  {
                    id: 'five-hour',
                    label: 'Five hour',
                    remainingFraction: 0,
                    resetTime: '2026-07-30T02:00:00Z',
                  },
                  {
                    id: 'weekly',
                    label: 'Weekly',
                    remainingFraction: 0.44,
                    resetTime: '2026-08-02T02:00:00Z',
                  },
                ],
              },
              {
                id: 'claude-gpt',
                label: 'Claude and GPT models',
                buckets: [
                  {
                    id: 'five-hour',
                    label: 'Five hour',
                    remainingFraction: 0.82,
                    resetTime: '2026-07-30T01:00:00Z',
                  },
                  {
                    id: 'weekly',
                    label: 'Weekly',
                    remainingFraction: 0.66,
                    resetTime: '2026-08-04T02:00:00Z',
                  },
                ],
              },
            ],
          },
        },
      }
    );
    const row = rows.find((candidate) => candidate.fileName === 'antigravity-mixed.json');

    expect(row?.quota).toMatchObject({
      status: 'ok',
      remainingPercent: 66,
      usedPercent: 34,
      resetLabel: '2026-07-30T02:00:00Z',
      groupedAvailabilityState: 'partial',
    });
    expect(buildAccountMetrics(rows)).toMatchObject({
      available: 1,
      needsAttention: 0,
      quotaRisk: 1,
    });
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'available',
        plan: 'all',
        quotaBand: 'all',
        search: '',
      }).map((candidate) => candidate.fileName)
    ).toEqual(['codex-healthy.json', 'antigravity-mixed.json']);
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'problem',
        plan: 'all',
        quotaBand: 'all',
        search: '',
      })
    ).toHaveLength(0);
    expect(sortAccountRows(rows).map((candidate) => candidate.fileName)).toEqual([
      'antigravity-mixed.json',
      'codex-healthy.json',
    ]);
  });

  it('uses the latest blocking window when summarizing an unavailable Antigravity group', () => {
    const [row] = buildAccountRows([{ name: 'antigravity-recovery.json', type: 'antigravity' }], {
      ...emptyStores(),
      antigravityQuota: {
        'antigravity-recovery.json': {
          status: 'success',
          groups: [
            {
              id: 'gemini',
              label: 'Gemini models',
              buckets: [
                {
                  id: 'five-hour',
                  label: 'Five hour',
                  remainingFraction: 0,
                  resetTime: '2026-07-30T02:00:00Z',
                },
                {
                  id: 'weekly',
                  label: 'Weekly',
                  remainingFraction: 0,
                  resetTime: '2026-08-02T02:00:00Z',
                },
              ],
            },
            {
              id: 'claude-gpt',
              label: 'Claude and GPT models',
              buckets: [
                {
                  id: 'weekly',
                  label: 'Weekly',
                  remainingFraction: 0.66,
                  resetTime: '2026-08-04T02:00:00Z',
                },
              ],
            },
          ],
        },
      },
    });

    expect(row.quota).toMatchObject({
      status: 'ok',
      remainingPercent: 66,
      resetLabel: '2026-08-02T02:00:00Z',
    });
  });

  it('marks Antigravity exhausted only after every known model group is exhausted', () => {
    const rows = buildAccountRows([{ name: 'antigravity-empty.json', type: 'antigravity' }], {
      ...emptyStores(),
      antigravityQuota: {
        'antigravity-empty.json': {
          status: 'success',
          groups: [
            {
              id: 'gemini',
              label: 'Gemini models',
              buckets: [
                { id: 'weekly', label: 'Weekly', remainingFraction: 0, resetTime: 'later' },
              ],
            },
            {
              id: 'claude-gpt',
              label: 'Claude and GPT models',
              buckets: [
                { id: 'weekly', label: 'Weekly', remainingFraction: 0, resetTime: 'later' },
              ],
            },
          ],
        },
      },
    });

    expect(rows[0].quota.status).toBe('exhausted');
    expect(rows[0].quota.remainingPercent).toBe(0);
  });

  it('keeps credential update time separate and uses the latest update signal', () => {
    const [row] = buildAccountRows(
      [
        {
          name: 'updated.json',
          type: 'codex',
          updatedAtMs: 1_700_000_000_000,
          modified: 1_700_000_100_000,
          lastRefresh: 1_700_000_200_000,
        },
      ],
      emptyStores()
    );

    expect(row.updatedAtMs).toBe(1_700_000_200_000);
  });

  it('uses the tightest Kimi quota row for account summary and reset label', () => {
    const rows = buildAccountRows([{ name: 'kimi.json', type: 'kimi' }], {
      ...emptyStores(),
      kimiQuota: {
        'kimi.json': {
          status: 'success',
          rows: [
            {
              id: 'daily',
              label: 'Daily',
              used: 1,
              limit: 10,
              resetHint: '1d',
            },
            {
              id: 'weekly',
              label: 'Weekly',
              used: 9,
              limit: 10,
              resetHint: '6d',
            },
          ],
        },
      },
    });

    expect(rows[0].quota.remainingPercent).toBe(10);
    expect(rows[0].quota.usedPercent).toBe(90);
    expect(rows[0].quota.resetLabel).toBe('6d');
    expect(rows[0].quota.status).toBe('low');
  });

  it('keeps xAI account available while pay-as-you-go quota remains', () => {
    const rows = buildAccountRows([{ name: 'xai.json', type: 'xai' }], {
      ...emptyStores(),
      xaiQuota: {
        'xai.json': {
          status: 'success',
          billing: {
            periodType: 'monthly',
            usagePercent: null,
            productUsage: [],
            monthlyLimitCents: 10_000,
            usedCents: 12_500,
            includedUsedCents: 10_000,
            onDemandCapCents: 5_000,
            onDemandUsedCents: 2_500,
            onDemandUsedPercent: 50,
            billingPeriodEnd: '2026-07-31T00:00:00Z',
            usedPercent: 100,
          },
        },
      },
    });

    expect(rows[0].quota.remainingPercent).toBeCloseTo(16.667, 2);
    expect(rows[0].quota.usedPercent).toBeCloseTo(83.333, 2);
    expect(rows[0].quota.resetLabel).toBe('2026-07-31T00:00:00Z');
    expect(rows[0].quota.status).toBe('low');
  });

  it('keeps an official-API-only xAI credential available without inventing quota', () => {
    const rows = buildAccountRows([{ name: 'paid-xai.json', type: 'xai' }], {
      ...emptyStores(),
      xaiQuota: {
        'paid-xai.json': {
          status: 'success',
          billing: {
            periodType: 'unknown',
            usagePercent: null,
            productUsage: [],
            monthlyLimitCents: null,
            usedCents: null,
            includedUsedCents: null,
            onDemandCapCents: null,
            onDemandUsedCents: null,
            onDemandUsedPercent: null,
            usedPercent: null,
            officialApiHealth: {
              source: 'api.x.ai/v1/me',
              userId: 'user-1',
              teamId: 'team-1',
              teamBlocked: false,
            },
          },
        },
      },
    });

    expect(rows[0].quota).toMatchObject({
      status: 'unknown',
      remainingPercent: null,
      usedPercent: null,
    });
    expect(rows[0].quota).not.toHaveProperty('error');
    expect(buildAccountMetrics(rows)).toMatchObject({ available: 0, unconfirmed: 1 });
  });

  it('uses xAI weekly credits when they are the tightest quota window', () => {
    const rows = buildAccountRows([{ name: 'xai.json', type: 'xai' }], {
      ...emptyStores(),
      xaiQuota: {
        'xai.json': {
          status: 'success',
          billing: {
            periodType: 'weekly',
            usagePercent: 92,
            periodEnd: '2026-07-08T00:00:00Z',
            productUsage: [{ product: 'Grok Code Fast', usagePercent: 92 }],
            monthlyLimitCents: 10_000,
            usedCents: 2_000,
            includedUsedCents: 2_000,
            onDemandCapCents: null,
            onDemandUsedCents: null,
            onDemandUsedPercent: null,
            billingPeriodEnd: '2026-07-31T00:00:00Z',
            usedPercent: 20,
          },
        },
      },
    });

    expect(rows[0].quota.remainingPercent).toBe(8);
    expect(rows[0].quota.usedPercent).toBe(92);
    expect(rows[0].quota.resetLabel).toBe('2026-07-08T00:00:00Z');
    expect(rows[0].quota.status).toBe('low');
  });

  it('uses xAI product usage when period usage is not available', () => {
    const rows = buildAccountRows([{ name: 'xai.json', type: 'xai' }], {
      ...emptyStores(),
      xaiQuota: {
        'xai.json': {
          status: 'success',
          billing: {
            periodType: 'weekly',
            usagePercent: null,
            periodEnd: '2026-07-08T00:00:00Z',
            productUsage: [{ product: 'Grok Code Fast', usagePercent: 100 }],
            monthlyLimitCents: 10_000,
            usedCents: 2_000,
            includedUsedCents: 2_000,
            onDemandCapCents: null,
            onDemandUsedCents: null,
            onDemandUsedPercent: null,
            billingPeriodEnd: '2026-07-31T00:00:00Z',
            usedPercent: 20,
          },
        },
      },
    });

    expect(rows[0].quota.remainingPercent).toBe(0);
    expect(rows[0].quota.usedPercent).toBe(100);
    expect(rows[0].quota.resetLabel).toBe('2026-07-08T00:00:00Z');
    expect(rows[0].quota.status).toBe('exhausted');
  });

  it('keeps cached Codex quota source while appending header diagnostics', () => {
    const rows = buildAccountRows(
      [
        {
          name: 'codex-cache.json',
          type: 'codex',
          authIndex: 'auth-cache',
        },
      ],
      {
        ...emptyStores(),
        codexQuota: {
          'codex-cache.json': {
            status: 'success',
            planType: 'plus',
            windows: [
              {
                id: 'weekly',
                label: 'Weekly',
                usedPercent: 25,
                resetLabel: 'Mon',
              },
            ],
          },
        },
      },
      undefined,
      {
        codexHeaderSnapshotBySelectionKey: new Map<string, UsageHeaderSnapshot>([
          [
            'codex-cache.json\u0000auth-cache',
            {
              event_hash: 'cache-diagnostic',
              timestamp_ms: 1700000000100,
              header_trace_id: 'trace-cache-diagnostic',
              header_error_code: 'quota_warning',
            },
          ],
        ]),
      }
    );

    expect(rows[0].quota.source).toBe('cache');
    expect(rows[0].quota.usedPercent).toBe(25);
    expect(rows[0].quota.observedTraceId).toBe('trace-cache-diagnostic');
    expect(rows[0].quota.observedErrorCode).toBe('quota_warning');
  });

  it('builds account metrics from quota, disabled state, usage, and inspection results', () => {
    const files: AuthFileItem[] = [
      {
        name: 'codex-low.json',
        type: 'codex',
        recent_requests: [{ success: 9, failed: 1 }],
      },
      {
        name: 'codex-disabled.json',
        type: 'codex',
        disabled: true,
        recent_requests: [{ success: 0, failed: 2 }],
      },
    ];
    const inspection: AccountInspectionResult[] = [
      {
        id: 10,
        runId: 1,
        accountKey: 'codex-low.json',
        fileName: 'codex-low.json',
        displayAccount: 'codex-low.json',
        provider: 'codex',
        disabled: false,
        action: 'disable',
        actionReason: 'low quota',
        actionStatus: 'pending',
        statusCode: 200,
        usedPercent: 96,
        isQuota: true,
        createdAtMs: 1000,
        inspectionSource: 'server',
      },
    ];

    const rows = buildAccountRows(
      files,
      {
        ...emptyStores(),
        codexQuota: {
          'codex-low.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 96, resetLabel: 'Mon' }],
          },
        },
      },
      inspection
    );

    expect(rows[0].inspection?.action).toBe('disable');
    expect(rows[1].quota.status).toBe('disabled');

    const metrics = buildAccountMetrics(rows);
    expect(metrics.total).toBe(2);
    expect(metrics.needsAttention).toBe(1);
    expect(metrics.quotaRisk).toBe(0);
    expect(metrics.disabled).toBe(1);
    expect(metrics.unconfirmed).toBe(0);
    expect(metrics.available).toBe(0);
    expect(metrics.needsInspectionAction).toBe(1);
  });

  it('builds an exclusive six-card status summary with operational context', () => {
    const rows = buildAccountRows(
      [
        { name: 'available.json', type: 'codex', authIndex: 'available' },
        { name: 'attention.json', type: 'codex', authIndex: 'attention' },
        { name: 'low.json', type: 'codex', authIndex: 'low' },
        { name: 'cooldown.json', type: 'codex', authIndex: 'cooldown' },
        { name: 'disabled.json', type: 'codex', authIndex: 'disabled', disabled: true },
        { name: 'unconfirmed.json', type: 'gemini', authIndex: 'unconfirmed' },
      ],
      {
        ...emptyStores(),
        codexQuota: {
          'available.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetLabel: 'Mon' }],
          },
          'low.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 90, resetLabel: 'Mon' }],
          },
        },
      }
    );
    const byName = new Map(rows.map((row) => [row.fileName, row]));
    const attentionKey = byName.get('attention.json')?.selectionKey ?? '';
    const cooldownKey = byName.get('cooldown.json')?.selectionKey ?? '';
    const disabledKey = byName.get('disabled.json')?.selectionKey ?? '';

    const metrics = buildAccountMetrics(rows, {
      pendingActionsByRowKey: new Map([
        [attentionKey, [{ id: 1 }]],
        [disabledKey, [{ id: 2 }]],
      ]),
      quotaCooldownsByRowKey: new Map([
        [cooldownKey, [{ id: 3 }]],
        [disabledKey, [{ id: 4 }]],
      ]),
    });

    expect(metrics).toEqual({
      total: 6,
      available: 1,
      needsAttention: 1,
      quotaRisk: 2,
      disabled: 1,
      unconfirmed: 1,
      needsInspectionAction: 0,
    });
    expect(
      metrics.available +
        metrics.needsAttention +
        metrics.quotaRisk +
        metrics.disabled +
        metrics.unconfirmed
    ).toBe(metrics.total);
  });

  it('filters rows by quota band and search text', () => {
    const rows = buildAccountRows(
      [
        { name: 'codex-low.json', type: 'codex', email: 'low@example.com' },
        { name: 'claude-ok.json', type: 'claude', email: 'ok@example.com' },
      ],
      {
        ...emptyStores(),
        codexQuota: {
          'codex-low.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 90, resetLabel: 'Mon' }],
          },
        },
        claudeQuota: {
          'claude-ok.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetLabel: 'Mon' }],
          },
        },
      }
    );

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'lt20',
        search: '',
      }).map((row) => row.fileName)
    ).toEqual(['codex-low.json']);

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'all',
        quotaBand: 'all',
        search: 'ok@example',
      }).map((row) => row.fileName)
    ).toEqual(['claude-ok.json']);
  });

  it('filters rows by credential-scoped Codex status evidence', () => {
    const weeklyQuota: CodexQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'weekly',
          label: 'Weekly',
          usedPercent: 100,
          resetLabel: 'Mon',
        },
      ],
    };
    const rows = buildAccountRows(
      [
        { name: 'weekly.json', type: 'codex', authIndex: 'weekly' },
        { name: 'reauth.json', type: 'codex', authIndex: 'reauth' },
      ],
      emptyStores()
    );
    const codexStatusBySelectionKey = new Map([
      [rows[0].selectionKey, getAuthFileCodexStatus(rows[0].raw, weeklyQuota)],
      [
        rows[1].selectionKey,
        getAuthFileCodexStatus(rows[1].raw, undefined, {
          fileName: rows[1].fileName,
          authIndex: rows[1].authIndex,
          statusCode: 401,
          action: 'reauth',
        }),
      ],
    ]);

    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'weekly_limited',
        plan: 'all',
        quotaBand: 'all',
        search: '',
        codexStatusBySelectionKey,
      }).map((row) => row.fileName)
    ).toEqual(['weekly.json']);
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'reauth',
        plan: 'all',
        quotaBand: 'all',
        search: '',
        codexStatusBySelectionKey,
      }).map((row) => row.fileName)
    ).toEqual(['reauth.json']);
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'quota_limited',
        plan: 'all',
        quotaBand: 'all',
        search: '',
      })
    ).toHaveLength(0);
  });

  it('exposes unknown plans and orders Codex plans by tier with unknown last', () => {
    const rows = buildAccountRows(
      [
        { name: 'pro.json', type: 'codex', planType: 'pro' },
        { name: 'pro-lite.json', type: 'codex', planType: 'prolite' },
        { name: 'team.json', type: 'codex', planType: 'team' },
        { name: 'plus.json', type: 'codex', planType: 'plus' },
        { name: 'free.json', type: 'codex', planType: 'free' },
        { name: 'enterprise.json', type: 'codex', planType: 'enterprise' },
        { name: 'unknown.json', type: 'codex' },
      ],
      emptyStores()
    );
    const plusRow = rows.find((row) => row.fileName === 'plus.json');
    if (!plusRow) throw new Error('Plus plan row not found');
    plusRow.planType = ' plus ';

    expect(getPlanOptions(rows)).toEqual([
      'enterprise',
      'free',
      'plus',
      'team',
      'prolite',
      'pro',
      'unknown',
    ]);
    expect(
      sortAccountRows(rows, { key: 'plan', direction: 'asc' }).map((row) => row.fileName)
    ).toEqual([
      'enterprise.json',
      'free.json',
      'plus.json',
      'team.json',
      'pro-lite.json',
      'pro.json',
      'unknown.json',
    ]);
    expect(
      sortAccountRows(rows, { key: 'plan', direction: 'desc' }).map((row) => row.fileName)
    ).toEqual([
      'pro.json',
      'pro-lite.json',
      'team.json',
      'plus.json',
      'free.json',
      'enterprise.json',
      'unknown.json',
    ]);
    expect(
      filterAccountRows(rows, {
        provider: 'all',
        status: 'all',
        plan: 'plus',
        quotaBand: 'all',
        search: '',
      }).map((row) => row.fileName)
    ).toEqual(['plus.json']);
  });

  it('sorts rows by priority, recent requests, and reset label', () => {
    const rows = buildAccountRows(
      [
        {
          name: 'low.json',
          type: 'codex',
          priority: -1,
          createdAtMs: 1000,
          recent_requests: [{ success: 1, failed: 0 }],
        },
        {
          name: 'middle.json',
          type: 'codex',
          priority: 2,
          createdAtMs: 3000,
          recent_requests: [{ success: 3, failed: 2 }],
        },
        {
          name: 'high.json',
          type: 'codex',
          priority: 10,
          createdAtMs: 2000,
          recent_requests: [{ success: 2, failed: 1 }],
        },
      ],
      {
        ...emptyStores(),
        codexQuota: {
          'low.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 90, resetLabel: '2026-01-10' }],
          },
          'middle.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 40, resetLabel: '2026-01-02' }],
          },
          'high.json': {
            status: 'success',
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 10, resetLabel: '-' }],
          },
        },
      }
    );

    expect(
      sortAccountRows(rows, { key: 'priority', direction: 'desc' }).map((row) => row.fileName)
    ).toEqual(['high.json', 'middle.json', 'low.json']);
    expect(
      sortAccountRows(rows, { key: 'recent', direction: 'desc' }).map((row) => row.fileName)
    ).toEqual(['middle.json', 'high.json', 'low.json']);
    expect(
      sortAccountRows(rows, { key: 'reset', direction: 'asc' }).map((row) => row.fileName)
    ).toEqual(['middle.json', 'low.json', 'high.json']);
    expect(
      sortAccountRows(rows, { key: 'quota', direction: 'desc' }).map((row) => row.fileName)
    ).toEqual(['high.json', 'middle.json', 'low.json']);
    expect(
      sortAccountRows(rows, { key: 'quota', direction: 'asc' }).map((row) => row.fileName)
    ).toEqual(['low.json', 'middle.json', 'high.json']);
    expect(
      sortAccountRows(rows, { key: 'created', direction: 'desc' }).map((row) => row.fileName)
    ).toEqual(['middle.json', 'high.json', 'low.json']);
    expect(
      sortAccountRows(rows, { key: 'created', direction: 'asc' }).map((row) => row.fileName)
    ).toEqual(['low.json', 'high.json', 'middle.json']);
  });

  it('sorts the name column by account label instead of credential file name', () => {
    const rows = buildAccountRows(
      [
        { name: 'a-file.json', type: 'codex', account: 'Zulu Account' },
        { name: 'z-file.json', type: 'codex', account: 'Alpha Account' },
      ],
      emptyStores()
    );

    expect(
      sortAccountRows(rows, { key: 'name', direction: 'asc' }).map((row) => row.fileName)
    ).toEqual(['z-file.json', 'a-file.json']);
  });
});
