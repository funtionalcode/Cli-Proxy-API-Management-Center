import { normalizeRawPlanType } from '../normalize';
import type { PlanResolverDescriptor } from './types';

const descriptor = (canonicalPlanType: string, labelKey: string, labelDefault: string) =>
  ({
    canonicalPlanType,
    shortLabelKey: labelKey,
    shortDefault: labelDefault,
  }) satisfies PlanResolverDescriptor;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readTrimmed = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

/** Resolves Antigravity's plan field and falls back to provider tier metadata. */
export const resolveAntigravityPlanType = (
  subscription: unknown,
  fallback?: unknown
): string | null => {
  const record = isRecord(subscription) ? subscription : null;
  const toValue = (value: unknown) => {
    const raw = readTrimmed(value);
    if (!raw) return null;
    const normalized = normalizeRawPlanType(raw);
    return normalized ? { raw, normalized } : null;
  };
  const directValue = toValue(record?.plan ?? (record ? undefined : subscription));
  const fallbackValue = toValue(fallback);
  const tierValues = [toValue(record?.tierName), toValue(record?.tierId)].filter(
    (value): value is { raw: string; normalized: string } => value !== null
  );

  if (directValue && directValue.normalized !== 'unknown') return directValue.raw;
  if (fallbackValue && fallbackValue.normalized !== 'unknown') return fallbackValue.raw;
  return (
    [directValue, ...tierValues, fallbackValue].find(
      (value): value is { raw: string; normalized: string } =>
        value !== null && value.normalized !== 'unknown'
    )?.raw ??
    directValue?.raw ??
    tierValues[0]?.raw ??
    fallbackValue?.raw ??
    null
  );
};

export const ANTIGRAVITY_PLAN_DESCRIPTORS: Readonly<Record<string, PlanResolverDescriptor>> = {
  free: descriptor('free', 'plans.antigravity.free', 'Free'),
  pro: descriptor('pro', 'plans.antigravity.pro', 'Pro'),
  ultra: descriptor('ultra', 'plans.antigravity.ultra', 'Ultra'),
  'ultra-lite': descriptor('ultra-lite', 'plans.antigravity.ultra_lite', 'Ultra Lite'),
  ultra_lite: descriptor('ultra-lite', 'plans.antigravity.ultra_lite', 'Ultra Lite'),
};

export const resolveAntigravityPlanDescriptor = (
  planType: unknown
): PlanResolverDescriptor | null => {
  const normalized = normalizeRawPlanType(planType);
  return normalized ? (ANTIGRAVITY_PLAN_DESCRIPTORS[normalized] ?? null) : null;
};
