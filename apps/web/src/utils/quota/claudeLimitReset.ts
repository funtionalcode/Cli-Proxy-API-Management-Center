import type { ClaudeLimitResetGrant, ClaudeLimitResetStatus } from '@/types';
import { isRecord } from '@/utils/helpers';

export const isClaudeResetGrantId = (value: string): boolean => /^[a-z0-9_-]{1,40}$/.test(value);

export const normalizeClaudeOrganizationId = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null;

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const parseTimestamp = (value: unknown): number | null =>
  value === undefined || value === null
    ? null
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN;

export const parseClaudeLimitResets = (value: unknown): ClaudeLimitResetStatus | null => {
  if (!isRecord(value) || value.eligible === false || !Array.isArray(value.grants)) return null;
  const cooldownUntilMs = parseTimestamp(value.cooldown_until);
  if (cooldownUntilMs !== null && !Number.isFinite(cooldownUntilMs)) return null;

  const grants: ClaudeLimitResetGrant[] = [];
  for (const raw of value.grants) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.resets_left !== 'number' ||
      !Number.isSafeInteger(raw.resets_left) ||
      raw.resets_left < 0
    ) {
      return null;
    }
    const endsAtMs = parseTimestamp(raw.ends_at);
    const startsAtMs = parseTimestamp(raw.starts_at);
    if (endsAtMs !== null && !Number.isFinite(endsAtMs)) return null;
    if (startsAtMs !== null && !Number.isFinite(startsAtMs)) return null;
    const clears = Array.isArray(raw.clears)
      ? raw.clears.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    const kind =
      raw.gives_back_weekly === true || raw.type === 'fable'
        ? 'fable'
        : raw.type === 'full' || (clears.includes('five_hour') && clears.includes('seven_day'))
          ? 'full'
          : 'unknown';
    grants.push({
      id: raw.id,
      label: optionalText(raw.label) ?? raw.id,
      kind,
      resetsLeft: raw.resets_left,
      startsAtMs,
      endsAtMs,
      clears,
      paused: raw.paused === true,
      usableNow: raw.usable_now === true,
      useRequiresLimit: raw.use_requires_limit === true,
      unavailableReason: optionalText(raw.unavailable_reason),
    });
  }
  return {
    atLimit: value.at_limit === true,
    ineligibleReason: optionalText(value.ineligible_reason),
    cooldownUntilMs,
    grants,
  };
};

export const getClaudeResetUnavailableReason = (
  status: ClaudeLimitResetStatus,
  grant: ClaudeLimitResetGrant,
  nowMs = Date.now()
): string | null => {
  if (!isClaudeResetGrantId(grant.id)) return 'invalid';
  if (grant.resetsLeft <= 0) return 'exhausted';
  if (grant.endsAtMs !== null && grant.endsAtMs <= nowMs) return 'expired';
  if (grant.startsAtMs !== null && grant.startsAtMs > nowMs) return 'not_started';
  if (status.ineligibleReason) return 'ineligible';
  if (grant.paused) return 'paused';
  if (status.cooldownUntilMs !== null && status.cooldownUntilMs > nowMs) return 'cooldown';
  if (grant.useRequiresLimit && !status.atLimit) return 'limit_required';
  return grant.usableNow ? null : 'unavailable';
};
