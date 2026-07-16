import { describe, expect, it } from 'vitest';
import {
  classifyCodexRateLimitWindows,
  deriveCodexRateLimitUsedPercent,
  isCodexRateLimitReached,
  buildCodexQuotaWindowInfos,
} from './codexQuota';

describe('buildCodexQuotaWindowInfos', () => {
  it('classifies Codex primary and weekly windows by duration', () => {
    const windows = buildCodexQuotaWindowInfos({
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 604_800,
          reset_after_seconds: 60,
        },
        secondary_window: {
          used_percent: 30,
          limit_window_seconds: 18_000,
          reset_after_seconds: 120,
        },
      },
    });

    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['five-hour', 30],
      ['weekly', 10],
    ]);
  });

  it('marks reached windows as fully used when usage percent is absent', () => {
    const windows = buildCodexQuotaWindowInfos({
      rate_limit: {
        limit_reached: true,
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 300,
        },
      },
    });

    expect(windows[0]).toMatchObject({
      id: 'five-hour',
      usedPercent: 100,
    });
  });

  it('classifies current Codex monthly-only quota without falling back to five-hour', () => {
    const payload = {
      user_id: 'user-test',
      account_id: 'acct-test',
      email: 'user@example.test',
      plan_type: 'free',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 5,
          limit_window_seconds: 2_592_000,
          reset_after_seconds: 2_592_000,
          reset_at: 1_782_895_966,
        },
        secondary_window: null,
      },
      code_review_rate_limit: null,
      additional_rate_limits: null,
      credits: {
        has_credits: false,
        unlimited: false,
        overage_limit_reached: false,
        balance: null,
      },
      spend_control: {
        reached: false,
        individual_limit: null,
      },
      rate_limit_reset_credits: {
        available_count: 0,
      },
    };

    const windows = buildCodexQuotaWindowInfos(payload);
    const classified = classifyCodexRateLimitWindows(payload.rate_limit);

    expect(windows).toMatchObject([
      {
        id: 'monthly',
        labelKey: 'codex_quota.monthly_window',
        usedPercent: 5,
        limitWindowSeconds: 2_592_000,
      },
    ]);
    expect(classified.fiveHourWindow).toBeNull();
    expect(classified.weeklyWindow).toBeNull();
    expect(classified.monthlyWindow?.used_percent).toBe(5);
    expect(classified.longWindow).toBe(classified.monthlyWindow);
    expect(deriveCodexRateLimitUsedPercent(payload.rate_limit)).toBe(5);
    expect(isCodexRateLimitReached(payload.rate_limit)).toBe(false);
  });

  it('classifies 28 to 31 day windows as monthly quota', () => {
    const monthLikeDurations = [2_419_200, 2_505_600, 2_592_000, 2_678_400];

    monthLikeDurations.forEach((duration) => {
      const classified = classifyCodexRateLimitWindows({
        primary_window: {
          used_percent: 20,
          limit_window_seconds: duration,
        },
      });

      expect(classified.monthlyWindow?.limit_window_seconds).toBe(duration);
      expect(classified.weeklyWindow).toBeNull();
    });
  });

  it('does not classify windows longer than 31 days as monthly quota', () => {
    const classified = classifyCodexRateLimitWindows({
      primary_window: {
        used_percent: 20,
        limit_window_seconds: 2_764_800,
      },
    });

    expect(classified.monthlyWindow).toBeNull();
    expect(classified.longWindow?.limit_window_seconds).toBe(2_764_800);
  });

  it('treats a Team secondary window without duration as monthly quota', () => {
    const windows = buildCodexQuotaWindowInfos(
      {
        plan_type: 'team',
        rate_limit: {
          primary_window: {
            used_percent: 10,
            reset_after_seconds: 60,
          },
          secondary_window: {
            used_percent: 70,
            reset_after_seconds: 120,
          },
        },
      },
      { planType: 'team' }
    );

    expect(windows.map((window) => [window.id, window.labelKey, window.usedPercent])).toEqual([
      ['five-hour', 'codex_quota.primary_window', 10],
      ['monthly', 'codex_quota.monthly_window', 70],
    ]);
  });

  it('normalizes additional rate limit labels into stable ids and params', () => {
    const windows = buildCodexQuotaWindowInfos({
      additional_rate_limits: [
        {
          limit_name: 'Code Review Premium',
          rate_limit: {
            primary_window: {
              used_percent: 45,
              limit_window_seconds: 18_000,
              reset_after_seconds: 600,
            },
            secondary_window: {
              used_percent: 55,
              limit_window_seconds: 604_800,
              reset_after_seconds: 1_200,
            },
          },
        },
      ],
    });

    expect(windows).toMatchObject([
      {
        id: 'code-review-premium-five-hour-0',
        labelKey: 'codex_quota.additional_primary_window',
        labelParams: { name: 'Code Review Premium' },
        usedPercent: 45,
      },
      {
        id: 'code-review-premium-weekly-0',
        labelKey: 'codex_quota.additional_secondary_window',
        labelParams: { name: 'Code Review Premium' },
        usedPercent: 55,
      },
    ]);
  });

  it('shares rate-limit helpers used by Codex inspection', () => {
    const rateLimit = {
      allowed: true,
      primary_window: {
        used_percent: 65,
        limit_window_seconds: 604_800,
      },
      secondary_window: {
        used_percent: 100,
        limit_window_seconds: 18_000,
      },
    };

    const classified = classifyCodexRateLimitWindows(rateLimit);

    expect(classified.fiveHourWindow?.used_percent).toBe(100);
    expect(classified.weeklyWindow?.used_percent).toBe(65);
    expect(deriveCodexRateLimitUsedPercent(rateLimit)).toBe(100);
    expect(isCodexRateLimitReached(rateLimit)).toBe(true);
  });
});
