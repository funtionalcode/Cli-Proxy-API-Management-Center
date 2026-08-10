import { describe, expect, it } from 'vitest';
import {
  classifyCodexRateLimitWindows,
  deriveCodexRateLimitUsedPercent,
  isCodexRateLimitReached,
  buildCodexQuotaWindowInfos,
} from './codexQuota';
import type { CodexQuotaWindowInfo } from './codexQuota';

describe('buildCodexQuotaWindowInfos', () => {
  it('distinguishes exact absolute resets from relative estimates anchored to observation time', () => {
    const observedAtMs = Date.parse('2026-07-29T10:00:00Z');
    const exactResetAtMs = Date.parse('2026-07-29T12:00:00Z');
    const windows = buildCodexQuotaWindowInfos(
      {
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18_000,
            reset_at: exactResetAtMs / 1000,
          },
          secondary_window: {
            used_percent: 20,
            limit_window_seconds: 604_800,
            reset_after_seconds: 7_200,
          },
        },
      },
      { observedAtMs }
    );

    expect(windows.find((window) => window.id === 'five-hour')).toMatchObject({
      resetAtMs: exactResetAtMs,
      resetAccuracy: 'exact',
    });
    expect(windows.find((window) => window.id === 'weekly')).toMatchObject({
      resetAtMs: observedAtMs + 7_200_000,
      resetAccuracy: 'estimated',
    });
  });

  it('keeps provider API absolute reset evidence exact when a relative reset is also present', () => {
    const observedAtMs = Date.parse('2026-08-05T10:00:00.638Z');
    const storedResetAtMs = Date.parse('2026-09-04T09:59:59.000Z');
    const windows = buildCodexQuotaWindowInfos(
      {
        rate_limit: {
          primary_window: {
            used_percent: 1,
            limit_window_seconds: 30 * 24 * 60 * 60,
            reset_at: storedResetAtMs / 1000,
            reset_after_seconds: 30 * 24 * 60 * 60,
          },
        },
      },
      { observedAtMs }
    );

    expect(windows.find((window) => window.id === 'monthly')).toMatchObject({
      resetAtMs: storedResetAtMs,
      resetAccuracy: 'exact',
    });
  });

  it('marks synthesized Header absolute resets as estimated when relative evidence is present', () => {
    const observedAtMs = Date.parse('2026-08-05T10:00:00.638Z');
    const storedResetAtMs = Date.parse('2026-09-04T09:59:59.000Z');
    const windows = buildCodexQuotaWindowInfos(
      {
        rate_limit: {
          primary_window: {
            used_percent: 1,
            limit_window_seconds: 30 * 24 * 60 * 60,
            reset_at: storedResetAtMs / 1000,
            reset_after_seconds: 30 * 24 * 60 * 60,
          },
        },
      },
      { observedAtMs, source: 'response_header' }
    );

    expect(windows.find((window) => window.id === 'monthly')).toMatchObject({
      resetAtMs: storedResetAtMs,
      resetAccuracy: 'estimated',
    });
  });

  it('accepts Codex absolute resets as Unix milliseconds or ISO timestamps', () => {
    const millisecondResetAtMs = Date.parse('2026-07-29T12:00:00Z');
    const isoResetAt = '2026-08-05T12:00:00Z';
    const windows = buildCodexQuotaWindowInfos({
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 18_000,
          reset_at: millisecondResetAtMs,
        },
        secondary_window: {
          used_percent: 20,
          limit_window_seconds: 604_800,
          reset_at: isoResetAt,
        },
      },
    });

    expect(windows.find((window) => window.id === 'five-hour')).toMatchObject({
      resetAtMs: millisecondResetAtMs,
      resetAccuracy: 'exact',
    });
    expect(windows.find((window) => window.id === 'weekly')).toMatchObject({
      resetAtMs: Date.parse(isoResetAt),
      resetAccuracy: 'exact',
    });
  });

  it('rejects reset timestamps that exceed the JavaScript date range', () => {
    const windows = buildCodexQuotaWindowInfos(
      {
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18_000,
            reset_at: Number.MAX_VALUE,
          },
          secondary_window: {
            used_percent: 20,
            limit_window_seconds: 604_800,
            reset_after_seconds: Number.MAX_VALUE,
          },
        },
      },
      { observedAtMs: Date.parse('2026-07-29T10:00:00Z') }
    );

    expect(windows).toMatchObject([
      {
        id: 'five-hour',
        resetLabel: '-',
        resetAtMs: null,
        resetAccuracy: 'unknown',
      },
      {
        id: 'weekly',
        resetLabel: '-',
        resetAtMs: null,
        resetAccuracy: 'unknown',
      },
    ]);
  });

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

  it('keeps generic windows unique across main, code-review, and repeated additional families', () => {
    const genericWindow = (usedPercent: number) => ({
      primary_window: {
        used_percent: usedPercent,
        limit_window_seconds: 2 * 24 * 60 * 60,
      },
    });
    const windows = buildCodexQuotaWindowInfos({
      rate_limit: genericWindow(10),
      code_review_rate_limit: genericWindow(20),
      additional_rate_limits: [
        { limit_name: 'Credits', rate_limit: genericWindow(30) },
        { limit_name: 'Credits', rate_limit: genericWindow(40) },
      ],
    });

    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['window-2d-0', 10],
      ['code-review-window-2d-0', 20],
      ['credits-0-window-2d-0', 30],
      ['credits-1-window-2d-0', 40],
    ]);
    expect(new Set(windows.map((window) => window.id)).size).toBe(windows.length);
  });

  it('keeps distinct additional family ids stable when the provider reorders the array', () => {
    const family = (limitName: string, usedPercent: number) => ({
      limit_name: limitName,
      rate_limit: {
        primary_window: {
          used_percent: usedPercent,
          limit_window_seconds: 18_000,
        },
      },
    });
    const forward = buildCodexQuotaWindowInfos({
      additional_rate_limits: [family('Credits', 30), family('Review Premium', 40)],
    });
    const reverse = buildCodexQuotaWindowInfos({
      additional_rate_limits: [family('Review Premium', 40), family('Credits', 30)],
    });

    const idsByUsage = (windows: CodexQuotaWindowInfo[]) =>
      Object.fromEntries(windows.map((window) => [window.usedPercent, window.id]));
    expect(idsByUsage(forward)).toEqual({
      30: 'credits-five-hour-0',
      40: 'review-premium-five-hour-0',
    });
    expect(idsByUsage(reverse)).toEqual(idsByUsage(forward));
  });

  it('uses metered feature to keep duplicate additional names stable across reorder', () => {
    const family = (meteredFeature: string, usedPercent: number) => ({
      limit_name: 'Credits',
      metered_feature: meteredFeature,
      rate_limit: {
        primary_window: {
          used_percent: usedPercent,
          limit_window_seconds: 18_000,
        },
      },
    });
    const forward = buildCodexQuotaWindowInfos({
      additional_rate_limits: [
        family('chat_completions', 30),
        family('code_review', 40),
        {
          limit_name: 'Credits Chat Completions',
          rate_limit: {
            primary_window: { used_percent: 50, limit_window_seconds: 18_000 },
          },
        },
      ],
    });
    const reverse = buildCodexQuotaWindowInfos({
      additional_rate_limits: [
        {
          limit_name: 'Credits Chat Completions',
          rate_limit: {
            primary_window: { used_percent: 50, limit_window_seconds: 18_000 },
          },
        },
        family('code_review', 40),
        family('chat_completions', 30),
      ],
    });

    const idsByUsage = (windows: CodexQuotaWindowInfo[]) =>
      Object.fromEntries(windows.map((window) => [window.usedPercent, window.id]));
    expect(idsByUsage(forward)).toEqual({
      30: 'credits--chat-completions-five-hour-0',
      40: 'credits--code-review-five-hour-0',
      50: 'credits-chat-completions-five-hour-0',
    });
    expect(idsByUsage(reverse)).toEqual(idsByUsage(forward));
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
