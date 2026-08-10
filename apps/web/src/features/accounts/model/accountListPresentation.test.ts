import { describe, expect, it } from 'vitest';
import type { AuthFileItem } from '@/types';
import type { QuotaCooldownInfo } from '@/services/api';
import type { AuthFileCodexStatusSummary } from '@/features/authFiles/model/authFilesPageModel';
import type { AccountRow } from './accountRows';
import { buildAccountListItem, buildRecommendationBySelectionKey } from './accountListPresentation';
import { summarizeGroupedQuotaAvailability } from './accountQuotaSummary';
import type { AccountRecommendation } from './quotaRecommendations';

type AccountRowOverrides = Omit<Partial<AccountRow>, 'quota'> & {
  quota?: Partial<AccountRow['quota']>;
};

const makeRow = (overrides: AccountRowOverrides = {}): AccountRow => {
  const { quota: quotaOverrides, ...rowOverrides } = overrides;
  const raw: AuthFileItem = {
    name: overrides.fileName ?? 'codex-1.json',
    type: overrides.provider ?? 'codex',
  };

  return {
    key: raw.name,
    selectionKey: `${raw.name}\u0000${overrides.authIndex ?? '-'}`,
    fileName: raw.name,
    accountLabel: raw.name,
    provider: 'codex',
    planType: null,
    disabled: false,
    runtimeOnly: false,
    statusMessage: '',
    authIndex: '',
    projectId: '',
    priority: null,
    createdAtMs: null,
    updatedAtMs: null,
    quota: {
      status: 'ok',
      remainingPercent: 80,
      usedPercent: 20,
      resetLabel: '-',
      resetAtMs: null,
      resetAccuracy: 'unknown',
      planType: null,
      source: 'cache',
      ...quotaOverrides,
    },
    usage: {
      success: 0,
      failure: 0,
      successRate: null,
      recentRequests: [],
    },
    inspection: null,
    raw,
    ...rowOverrides,
  };
};

const makeRecommendation = (
  row: AccountRow,
  overrides: Partial<AccountRecommendation> = {}
): AccountRecommendation => ({
  row,
  action: 'refresh',
  priority: 'high',
  reasonKey: 'accounts.recommend_reason_low',
  ...overrides,
});

const makeCodexStatus = (
  overrides: Partial<AuthFileCodexStatusSummary> = {}
): AuthFileCodexStatusSummary => ({
  isCodex: true,
  isHttp401: false,
  needsReauth: false,
  isQuotaLimited: false,
  isUnknownQuotaLimited: false,
  isFiveHourLimited: false,
  isWeeklyLimited: false,
  isMonthlyLimited: false,
  hasDisabledRecoveryReset: false,
  fiveHourResetLabel: null,
  weeklyResetLabel: null,
  monthlyResetLabel: null,
  recoveryResetLabel: null,
  fiveHourUsedPercent: null,
  weeklyUsedPercent: null,
  monthlyUsedPercent: null,
  badges: [],
  ...overrides,
});

describe('accountListPresentation', () => {
  it('prioritizes re-authentication over quota state', () => {
    const row = makeRow({
      quota: {
        status: 'low',
        remainingPercent: 5,
        usedPercent: 95,
        resetLabel: 'later',
        planType: null,
        source: 'cache',
      },
      inspection: {
        source: 'server',
        action: 'reauth',
        actionReason: 'expired',
        actionStatus: 'pending',
        statusCode: 401,
        usedPercent: null,
        runId: 1,
        resultId: 2,
        createdAtMs: 3,
      },
    });
    const recommendation = makeRecommendation(row, {
      action: 'reauth',
      priority: 'critical',
      reasonKey: 'accounts.recommend_reason_inspection',
    });

    const item = buildAccountListItem(row, { recommendation });

    expect(item.health.status).toBe('reauth');
    expect(item.health.labelKey).toBe('accounts.health_reauth');
    expect(item.health.reasonKey).toBe('accounts.health_reason_reauth_inspection');
    expect(item.health.reasonParams).toEqual({ detail: 'HTTP 401' });
    expect(item.health.reasonTone).toBe('danger');
    expect(item.recommendation.actionLabelKey).toBe('accounts.recommend_action_reauth');
  });

  it('summarizes quota refresh 401 as a quota refresh reauth reason', () => {
    const item = buildAccountListItem(
      makeRow({
        quota: {
          status: 'error',
          remainingPercent: null,
          usedPercent: null,
          resetLabel: '-',
          planType: null,
          source: 'cache',
          error:
            '额度获取失败：401 Your authentication token has been invalidated. Please try signing in again.',
        },
      })
    );

    expect(item.health.status).toBe('reauth');
    expect(item.health.reasonKey).toBe('accounts.health_reason_reauth_quota_refresh');
    expect(item.health.reasonParams).toEqual({ code: '401' });
    expect(item.health.tooltipParams.detail).toBe(
      '额度获取失败：401 Your authentication token has been invalidated. Please try signing in again.'
    );
  });

  it('shows window cooldown ahead of exhausted and disabled states', () => {
    const row = makeRow({
      disabled: true,
      quota: {
        status: 'exhausted',
        remainingPercent: 0,
        usedPercent: 100,
        resetLabel: 'later',
        planType: null,
        source: 'cache',
      },
    });
    const quotaCooldown: QuotaCooldownInfo = {
      authFileName: row.fileName,
      recoverAtMs: 1700000000000,
    };

    const item = buildAccountListItem(row, {
      quotaCooldown,
      codexStatus: makeCodexStatus({
        isQuotaLimited: true,
        isFiveHourLimited: true,
        fiveHourResetLabel: 'later',
      }),
    });

    expect(item.health.status).toBe('five_hour_cooldown');
    expect(item.health.reasonKey).toBe('accounts.health_reason_cooldown');
    expect(item.health.reasonTone).toBe('warning');
    expect(item.health.cooldown).toBe(quotaCooldown);
  });

  it('classifies quota and account fallback states', () => {
    const weeklyExhaustedItem = buildAccountListItem(
      makeRow({
        quota: {
          status: 'exhausted',
          remainingPercent: 0,
          usedPercent: 100,
          resetLabel: '-',
          planType: null,
          source: 'cache',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'weekly',
            label: 'Weekly quota',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '-',
          },
        ],
      }
    );
    expect(weeklyExhaustedItem.health.status).toBe('weekly_exhausted');
    expect(weeklyExhaustedItem.health.reasonKey).toBe('accounts.health_reason_weekly_exhausted');
    expect(weeklyExhaustedItem.health.reasonTone).toBe('warning');

    const explicitMonthlyItem = buildAccountListItem(
      makeRow({
        quota: {
          status: 'exhausted',
          remainingPercent: 0,
          usedPercent: 100,
          resetLabel: '-',
          planType: null,
          source: 'cache',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'opaque-window',
            label: 'Allowance',
            kind: 'monthly',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: 'month-end',
          },
        ],
      }
    );
    expect(explicitMonthlyItem.health.status).toBe('monthly_exhausted');

    const dailyExhaustedItem = buildAccountListItem(
      makeRow({
        quota: {
          status: 'exhausted',
          remainingPercent: 0,
          usedPercent: 100,
          resetLabel: '-',
          planType: null,
          source: 'cache',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'daily',
            label: 'Daily limit',
            kind: 'daily',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: 'tomorrow',
          },
        ],
      }
    );
    expect(dailyExhaustedItem.health.status).toBe('limited');

    const xaiPaygAvailableItem = buildAccountListItem(
      makeRow({
        provider: 'xai',
        quota: {
          status: 'low',
          remainingPercent: 16.667,
          usedPercent: 83.333,
          resetLabel: 'month-end',
          planType: null,
          source: 'cache',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'billing',
            label: 'Monthly credits',
            kind: 'billing',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: 'month-end',
          },
          {
            key: 'pay-as-you-go',
            label: 'Pay-as-you-go',
            kind: 'payg',
            remainingPercent: 50,
            usedPercent: 50,
            resetLabel: 'month-end',
          },
        ],
      }
    );
    expect(xaiPaygAvailableItem.health.status).toBe('available');

    const lowQuotaItem = buildAccountListItem(
      makeRow({
        quota: {
          status: 'low',
          remainingPercent: 12,
          usedPercent: 88,
          resetLabel: '-',
          planType: null,
          source: 'cache',
        },
      })
    );
    expect(lowQuotaItem.health.status).toBe('available');
    expect(lowQuotaItem.health.reasonKey).toBe('accounts.health_reason_available');
    expect(lowQuotaItem.health.reasonTone).toBe('muted');

    const exceptionItem = buildAccountListItem(makeRow({ statusMessage: 'custom problem' }));
    expect(exceptionItem.health.status).toBe('exception');
    expect(exceptionItem.health.reasonKey).toBe('accounts.health_reason_exception_request');
    expect(exceptionItem.health.reasonParams).toEqual({ detail: 'custom problem' });
    expect(exceptionItem.health.reasonTone).toBe('danger');

    const disabledItem = buildAccountListItem(
      makeRow({
        disabled: true,
        quota: {
          status: 'disabled',
          remainingPercent: null,
          usedPercent: null,
          resetLabel: '-',
          planType: null,
          source: 'none',
        },
      })
    );
    expect(disabledItem.health.status).toBe('disabled');
    expect(disabledItem.health.reasonKey).toBe('accounts.health_reason_disabled');
    expect(disabledItem.health.reasonTone).toBe('muted');

    expect(buildAccountListItem(makeRow()).health.status).toBe('available');
    expect(
      buildAccountListItem(
        makeRow({
          quota: {
            status: 'exhausted',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '-',
            planType: null,
            source: 'cache',
          },
        })
      ).health.status
    ).toBe('limited');
    const rawItem = buildAccountListItem(
      makeRow({
        quota: {
          status: 'unknown',
          remainingPercent: null,
          usedPercent: null,
          resetLabel: '-',
          planType: null,
          source: 'none',
        },
      })
    );
    expect(rawItem.health.status).toBe('raw');
    expect(rawItem.health.reasonKey).toBe('accounts.health_reason_raw');
    expect(rawItem.health.reasonTone).toBe('muted');
  });

  it('uses the latest known recovery for multiple exhausted windows of the same kind', () => {
    const earlierResetAtMs = Date.parse('2026-07-30T04:00:00Z');
    const laterResetAtMs = Date.parse('2026-07-30T06:00:00Z');
    const item = buildAccountListItem(
      makeRow({
        quota: {
          status: 'exhausted',
          remainingPercent: 0,
          usedPercent: 100,
          resetLabel: '2026-07-30T04:00:00Z',
          resetAtMs: earlierResetAtMs,
          resetAccuracy: 'exact',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'weekly-base',
            label: 'Weekly base',
            kind: 'weekly',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '2026-07-30T04:00:00Z',
            resetAtMs: earlierResetAtMs,
            resetAccuracy: 'exact',
          },
          {
            key: 'weekly-model',
            label: 'Weekly model',
            kind: 'weekly',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '2026-07-30T06:00:00Z',
            resetAtMs: laterResetAtMs,
            resetAccuracy: 'exact',
          },
        ],
      }
    );

    expect(item.health.status).toBe('weekly_exhausted');
    expect(item.health.tooltipParams).toEqual({ resetAt: '2026-07-30T06:00:00Z' });
    expect(item.health.resetAtMs).toBe(laterResetAtMs);
  });

  it('does not promise recovery when one matching exhausted window has no reset time', () => {
    const item = buildAccountListItem(
      makeRow({
        quota: {
          status: 'exhausted',
          remainingPercent: 0,
          usedPercent: 100,
          resetLabel: '2026-07-30T04:00:00Z',
          resetAtMs: Date.parse('2026-07-30T04:00:00Z'),
          resetAccuracy: 'exact',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'weekly-known',
            label: 'Weekly known',
            kind: 'weekly',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '2026-07-30T04:00:00Z',
            resetAtMs: Date.parse('2026-07-30T04:00:00Z'),
            resetAccuracy: 'exact',
          },
          {
            key: 'weekly-unknown',
            label: 'Weekly unknown',
            kind: 'weekly',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '-',
            resetAtMs: null,
            resetAccuracy: 'unknown',
          },
        ],
      }
    );

    expect(item.health.status).toBe('weekly_exhausted');
    expect(item.health.tooltipParams).toEqual({ resetAt: '-' });
    expect(item.health.resetAtMs).toBeNull();
  });

  it('marks mixed Antigravity model groups as partially available', () => {
    const item = buildAccountListItem(
      makeRow({
        provider: 'antigravity',
        statusMessage: 'Gemini 5-hour pool exhausted; waiting for Antigravity reset',
        quota: {
          status: 'ok',
          remainingPercent: 66,
          usedPercent: 34,
          resetLabel: 'later',
          planType: 'pro',
          source: 'cache',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'gemini:five-hour',
            label: 'Five hour',
            kind: 'five_hour',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: 'later',
            groupLabel: 'Gemini models',
          },
          {
            key: 'claude:five-hour',
            label: 'Five hour',
            kind: 'five_hour',
            remainingPercent: 82,
            usedPercent: 18,
            resetLabel: 'later',
            groupLabel: 'Claude and GPT models',
          },
          {
            key: 'claude:weekly',
            label: 'Weekly',
            kind: 'weekly',
            remainingPercent: 66,
            usedPercent: 34,
            resetLabel: 'later',
            groupLabel: 'Claude and GPT models',
          },
        ],
      }
    );

    expect(item.health.status).toBe('partial');
    expect(item.health.labelKey).toBe('accounts.health_partial');
    expect(item.health.reasonKey).toBe('accounts.health_reason_partial');
    expect(item.health.reasonParams).toEqual({ available: 1, total: 2 });
    expect(item.health.tooltipParams).toEqual({
      available: 1,
      total: 2,
      limited: 'Gemini models',
    });
  });

  it('keeps the exhausted state when every Antigravity model group is blocked', () => {
    const geminiFiveHourResetAtMs = Date.parse('2026-07-30T04:00:00Z');
    const geminiWeeklyResetAtMs = Date.parse('2026-08-02T08:00:00Z');
    const claudeFiveHourResetAtMs = Date.parse('2026-07-30T06:00:00Z');
    const item = buildAccountListItem(
      makeRow({
        provider: 'antigravity',
        quota: {
          status: 'exhausted',
          remainingPercent: 0,
          usedPercent: 100,
          resetLabel: '2026-07-30T06:00:00Z',
          resetAtMs: claudeFiveHourResetAtMs,
          resetAccuracy: 'exact',
          planType: 'pro',
          source: 'cache',
        },
      }),
      {
        quotaWindows: [
          {
            key: 'gemini:five-hour',
            label: 'Five hour',
            kind: 'five_hour',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '2026-07-30T04:00:00Z',
            resetAtMs: geminiFiveHourResetAtMs,
            resetAccuracy: 'exact',
            groupLabel: 'Gemini models',
          },
          {
            key: 'gemini:weekly',
            label: 'Weekly',
            kind: 'weekly',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '2026-08-02T08:00:00Z',
            resetAtMs: geminiWeeklyResetAtMs,
            resetAccuracy: 'exact',
            groupLabel: 'Gemini models',
          },
          {
            key: 'claude:five-hour',
            label: 'Five hour',
            kind: 'five_hour',
            remainingPercent: 0,
            usedPercent: 100,
            resetLabel: '2026-07-30T06:00:00Z',
            resetAtMs: claudeFiveHourResetAtMs,
            resetAccuracy: 'exact',
            groupLabel: 'Claude and GPT models',
          },
        ],
      }
    );

    expect(item.health.status).toBe('five_hour_exhausted');
    expect(item.health.tooltipParams).toEqual({ resetAt: '2026-07-30T06:00:00Z' });
    expect(item.health.resetAtMs).toBe(claudeFiveHourResetAtMs);
  });

  it('does not promise a group recovery while one blocking bucket has no reset time', () => {
    const summary = summarizeGroupedQuotaAvailability([
      {
        groupLabel: 'Gemini models',
        kind: 'five_hour',
        remainingPercent: 0,
        resetLabel: '2026-07-30T04:00:00Z',
        resetAtMs: Date.parse('2026-07-30T04:00:00Z'),
        resetAccuracy: 'exact',
      },
      {
        groupLabel: 'Gemini models',
        kind: 'weekly',
        remainingPercent: 0,
        resetLabel: '-',
        resetAtMs: null,
        resetAccuracy: 'unknown',
      },
    ]);

    expect(summary?.groups[0]).toMatchObject({
      resetLabel: '-',
      resetAtMs: null,
      resetAccuracy: 'unknown',
      resetKind: 'weekly',
    });
  });

  it('does not substitute an available-group reset for an unknown limited-group recovery', () => {
    const summary = summarizeGroupedQuotaAvailability([
      {
        groupLabel: 'Gemini models',
        kind: 'weekly',
        remainingPercent: 0,
        resetLabel: '-',
        resetAtMs: null,
        resetAccuracy: 'unknown',
      },
      {
        groupLabel: 'Claude and GPT models',
        kind: 'five_hour',
        remainingPercent: 60,
        resetLabel: '2026-07-30T05:00:00Z',
        resetAtMs: Date.parse('2026-07-30T05:00:00Z'),
        resetAccuracy: 'exact',
      },
    ]);

    expect(summary).toMatchObject({
      state: 'partial',
      resetLabel: '-',
      resetAtMs: null,
      resetAccuracy: 'unknown',
    });
  });

  it('degrades grouped recovery accuracy when any blocking reset is estimated', () => {
    const laterExactResetAtMs = Date.parse('2026-07-30T06:00:00Z');
    const summary = summarizeGroupedQuotaAvailability([
      {
        groupLabel: 'Gemini models',
        kind: 'five_hour',
        remainingPercent: 0,
        resetLabel: '2026-07-30T05:00:00Z',
        resetAtMs: Date.parse('2026-07-30T05:00:00Z'),
        resetAccuracy: 'estimated',
      },
      {
        groupLabel: 'Gemini models',
        kind: 'weekly',
        remainingPercent: 0,
        resetLabel: '2026-07-30T06:00:00Z',
        resetAtMs: laterExactResetAtMs,
        resetAccuracy: 'exact',
      },
    ]);

    expect(summary?.groups[0]).toMatchObject({
      resetAtMs: laterExactResetAtMs,
      resetAccuracy: 'estimated',
      resetKind: 'weekly',
    });
  });

  it('builds identity and activity summaries for list rendering', () => {
    const item = buildAccountListItem(
      makeRow({
        fileName: 'shared-codex.json',
        authIndex: 'auth-2',
        projectId: 'project-a',
        priority: -5,
        usage: {
          success: 3,
          failure: 1,
          successRate: 75,
          recentRequests: [],
        },
      })
    );

    expect(item.identity.subtitle).toBe('shared-codex.json · #auth-2 · project-a');
    expect(item.identity.priority).toBe(-5);
    expect(item.identity.priorityIsNegative).toBe(true);
    expect(item.activity.recentTotal).toBe(4);
    expect(item.activity.successCount).toBe(3);
    expect(item.activity.failureCount).toBe(1);
    expect(item.activity.successRate).toBe(75);
    expect(item.activity.hasHealthData).toBe(true);
    expect(item.activity.estimatedValue).toBeCloseTo(0.072);
  });

  it('uses monitoring activity when provided for list summaries', () => {
    const item = buildAccountListItem(
      makeRow({
        usage: {
          success: 1,
          failure: 0,
          successRate: 100,
          recentRequests: [],
        },
      }),
      {
        activity: {
          requests: 31,
          successRate: 96.8,
          inputTokens: 1200,
          outputTokens: 300,
          estimatedCost: 0.42,
          lastSeenMs: 1700000000000,
          source: 'monitoring',
        },
      }
    );

    expect(item.activity.recentTotal).toBe(31);
    expect(item.activity.successCount).toBe(30);
    expect(item.activity.failureCount).toBe(1);
    expect(item.activity.successRate).toBe(96.8);
    expect(item.activity.totalTokens).toBe(1500);
    expect(item.activity.estimatedValue).toBe(0.42);
    expect(item.activity.source).toBe('monitoring');
    expect(item.activity.hasHealthData).toBe(true);
  });

  it('maps recommendations by auth-file selection key', () => {
    const first = makeRow({ fileName: 'shared.json', authIndex: 'auth-1' });
    const second = makeRow({ fileName: 'shared.json', authIndex: 'auth-2' });
    const secondRecommendation = makeRecommendation(second, { action: 'disable' });

    const map = buildRecommendationBySelectionKey([
      makeRecommendation(first),
      secondRecommendation,
    ]);

    expect(map.get(first.selectionKey)?.row.authIndex).toBe('auth-1');
    expect(map.get(second.selectionKey)).toBe(secondRecommendation);
  });
});
