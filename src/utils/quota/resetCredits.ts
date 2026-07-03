import type { CodexRateLimitResetCredit, CodexResetCreditsSummary } from '@/types';
import { normalizeNumberValue, normalizeStringValue } from './parsers';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeCredit = (value: unknown): CodexRateLimitResetCredit | null => {
  const record = asRecord(value);
  if (!record) return null;
  if (normalizeStringValue(record.reset_type ?? record.resetType) !== 'codex_rate_limits') {
    return null;
  }
  if (normalizeStringValue(record.status) !== 'available') {
    return null;
  }

  const expiresAt = normalizeStringValue(record.expires_at ?? record.expiresAt);
  if (!expiresAt) return null;

  return {
    id: normalizeStringValue(record.id) ?? '',
    status: normalizeStringValue(record.status) ?? '',
    grantedAt: normalizeStringValue(record.granted_at ?? record.grantedAt) ?? '',
    expiresAt,
  };
};

export const normalizeCodexResetCreditsPayload = (
  payload: unknown
): CodexResetCreditsSummary => {
  let parsedPayload = payload;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return { availableCount: null, credits: [], invalidPayload: true };
    try {
      parsedPayload = JSON.parse(trimmed);
    } catch {
      return { availableCount: null, credits: [], invalidPayload: true };
    }
  }

  const record = asRecord(parsedPayload);
  if (!record) return { availableCount: null, credits: [], invalidPayload: true };

  const hasExpectedShape =
    'credits' in record || 'available_count' in record || 'availableCount' in record;
  const credits = Array.isArray(record.credits)
    ? record.credits.map(normalizeCredit).filter((credit): credit is CodexRateLimitResetCredit =>
        Boolean(credit)
      )
    : [];

  return {
    availableCount: normalizeNumberValue(record.available_count ?? record.availableCount),
    credits,
    invalidPayload: !hasExpectedShape,
  };
};
