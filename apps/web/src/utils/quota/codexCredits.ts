import type { CodexQuotaState, CodexUsagePayload } from '@/types';
import { normalizeNumberValue, normalizeStringValue } from './parsers';

export type CodexCreditsFields = Pick<
  CodexQuotaState,
  'creditsBalance' | 'creditsHasCredits' | 'creditsUnlimited'
>;

const readCreditsFlag = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return null;
};

export const resolveCodexCreditsFields = (
  payload: CodexUsagePayload | null | undefined
): CodexCreditsFields => ({
  creditsHasCredits: readCreditsFlag(payload?.credits?.has_credits ?? payload?.credits?.hasCredits),
  creditsUnlimited: readCreditsFlag(payload?.credits?.unlimited),
  creditsBalance: normalizeStringValue(payload?.credits?.balance),
});

export type CodexCreditsDisplay = { kind: 'unlimited' } | { kind: 'balance'; balance: number };

export const getCodexCreditsDisplay = (
  fields: CodexCreditsFields | null | undefined
): CodexCreditsDisplay | null => {
  if (fields?.creditsHasCredits !== true) return null;
  if (fields.creditsUnlimited === true) return { kind: 'unlimited' };
  const balance = normalizeNumberValue(fields.creditsBalance);
  return balance !== null && balance > 0 ? { kind: 'balance', balance } : null;
};

export const areCodexCreditsUsable = (
  fields:
    | (CodexCreditsFields &
        Pick<
          CodexQuotaState,
          | 'creditsOverageLimitReached'
          | 'spendControlReached'
          | 'rateLimitReachedType'
          | 'rateLimitAllowed'
        >)
    | null
    | undefined
): boolean =>
  getCodexCreditsDisplay(fields) !== null &&
  fields?.rateLimitAllowed !== false &&
  fields?.creditsOverageLimitReached !== true &&
  fields?.spendControlReached !== true &&
  !fields?.rateLimitReachedType?.trim();

export const canUseCodexCreditsFromPayload = (
  payload: CodexUsagePayload | null | undefined
): boolean => {
  const rateLimit = payload?.rate_limit ?? payload?.rateLimit;
  return areCodexCreditsUsable({
    ...resolveCodexCreditsFields(payload),
    rateLimitAllowed: readCreditsFlag(rateLimit?.allowed),
    creditsOverageLimitReached: readCreditsFlag(
      payload?.credits?.overage_limit_reached ?? payload?.credits?.overageLimitReached
    ),
    spendControlReached: readCreditsFlag(
      (payload?.spend_control ?? payload?.spendControl)?.reached
    ),
    rateLimitReachedType: payload?.rate_limit_reached_type ?? payload?.rateLimitReachedType,
  });
};
