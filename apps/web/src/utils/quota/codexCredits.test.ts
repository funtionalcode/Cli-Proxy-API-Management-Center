import { describe, expect, it } from 'vitest';
import type { CodexUsagePayload } from '@/types';
import {
  areCodexCreditsUsable,
  canUseCodexCreditsFromPayload,
  getCodexCreditsDisplay,
  resolveCodexCreditsFields,
} from './codexCredits';

describe('Codex 积分可用性', () => {
  it.each(['59897.4803850000', '0.4'])('保留余额 %s 的精度', (balance) => {
    const fields = resolveCodexCreditsFields({ credits: { has_credits: true, balance } });
    expect(fields.creditsBalance).toBe(balance);
    expect(getCodexCreditsDisplay(fields)).toEqual({ kind: 'balance', balance: Number(balance) });
    expect(areCodexCreditsUsable(fields)).toBe(true);
  });

  it.each(['', '0', '-1', 'NaN', 'Infinity', 'invalid'])('不将 %s 视为可用余额', (balance) => {
    expect(getCodexCreditsDisplay({ creditsHasCredits: true, creditsBalance: balance })).toBeNull();
  });

  it('无限积分也要求 has_credits 为真', () => {
    expect(getCodexCreditsDisplay({ creditsHasCredits: true, creditsUnlimited: true })).toEqual({
      kind: 'unlimited',
    });
    expect(getCodexCreditsDisplay({ creditsHasCredits: false, creditsUnlimited: true })).toBeNull();
    expect(getCodexCreditsDisplay({ creditsBalance: '50' })).toBeNull();
  });

  it('兼容字符串布尔值且不把未知信号补成可用', () => {
    expect(
      resolveCodexCreditsFields({
        credits: { hasCredits: 'True', unlimited: 'False', balance: 12.5 },
      } as unknown as CodexUsagePayload)
    ).toEqual({
      creditsHasCredits: true,
      creditsUnlimited: false,
      creditsBalance: '12.5',
    });
    expect(resolveCodexCreditsFields(undefined)).toEqual({
      creditsHasCredits: null,
      creditsUnlimited: null,
      creditsBalance: null,
    });
  });

  it.each([
    { credits: { has_credits: true, balance: '100', overage_limit_reached: true } },
    { credits: { has_credits: true, balance: '100' }, spend_control: { reached: true } },
    {
      credits: { has_credits: true, balance: '100' },
      rate_limit_reached_type: 'workspace_member_credits_depleted',
    },
    { credits: { has_credits: true, balance: '100' }, rate_limit: { allowed: false } },
  ])('明确的限额拒绝优先于积分余额 %#', (payload) => {
    expect(canUseCodexCreditsFromPayload(payload)).toBe(false);
  });
});
