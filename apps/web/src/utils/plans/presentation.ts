import type { TFunction } from 'i18next';
import {
  normalizePlanProvider,
  normalizeRawPlanType,
  readRawPlanType,
} from './normalize';
import {
  resolveAntigravityPlanDescriptor,
  resolveClaudePlanDescriptor,
  resolveCodexPlanDescriptor,
} from './providers';
import type { PlanResolverDescriptor } from './providers/types';
import type { GetPlanPresentationInput, PlanDisplayMode, PlanPresentation } from './types';

type PlanResolver = (planType: unknown) => PlanResolverDescriptor | null;

const PLAN_RESOLVERS: Readonly<Record<string, PlanResolver>> = {
  codex: resolveCodexPlanDescriptor,
  claude: resolveClaudePlanDescriptor,
  antigravity: resolveAntigravityPlanDescriptor,
};

const RESERVED_UNKNOWN_PLAN = 'unknown';
const UNKNOWN_PLAN_PREFIX = 'unknown:';

type ScopedUnknownPlanIdentity = {
  provider: string;
  normalizedPlanType: string;
};

const parseScopedUnknownPlanIdentity = (
  canonicalPlanType: string
): ScopedUnknownPlanIdentity | null => {
  if (!canonicalPlanType.startsWith(UNKNOWN_PLAN_PREFIX)) return null;

  const identity = canonicalPlanType.slice(UNKNOWN_PLAN_PREFIX.length);
  const separatorIndex = identity.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === identity.length - 1) return null;

  return {
    provider: identity.slice(0, separatorIndex),
    normalizedPlanType: identity.slice(separatorIndex + 1),
  };
};

/**
 * Filter labels are keyed by canonical identity, not by the provider that
 * happened to produce the first matching row. Existing provider locale keys
 * are reused with one fixed key per canonical identity.
 */
const CANONICAL_PLAN_FILTER_LABELS: Readonly<
  Record<string, { key: string; fallback: string }>
> = {
  free: { key: 'plans.codex.free', fallback: 'Free' },
  go: { key: 'plans.codex.go', fallback: 'Go' },
  plus: { key: 'plans.codex.plus', fallback: 'Plus' },
  pro: { key: 'plans.antigravity.pro', fallback: 'Pro' },
  pro_5x: { key: 'plans.codex.pro_5x', fallback: 'Pro 5x' },
  pro_20x: { key: 'plans.codex.pro_20x', fallback: 'Pro 20x' },
  team: { key: 'plans.codex.team', fallback: 'Team' },
  business: { key: 'plans.codex.business', fallback: 'Business' },
  business_premium_5x: {
    key: 'plans.codex.business_premium_5x.short',
    fallback: 'Business 5x',
  },
  business_usage_based: {
    key: 'plans.codex.business_usage_based.short',
    fallback: 'Business PAYG',
  },
  enterprise: { key: 'plans.codex.enterprise', fallback: 'Enterprise' },
  enterprise_automation: {
    key: 'plans.codex.enterprise_automation.short',
    fallback: 'Ent. Auto',
  },
  enterprise_usage_based: {
    key: 'plans.codex.enterprise_usage_based.short',
    fallback: 'Ent. PAYG',
  },
  edu: { key: 'plans.codex.edu.short', fallback: 'Edu' },
  edu_plus: { key: 'plans.codex.edu_plus.short', fallback: 'Edu Plus' },
  edu_pro: { key: 'plans.codex.edu_pro.short', fallback: 'Edu Pro' },
  max: { key: 'plans.claude.max', fallback: 'Max' },
  max_5x: { key: 'plans.claude.max_5x', fallback: 'Max 5x' },
  max_20x: { key: 'plans.claude.max_20x', fallback: 'Max 20x' },
  ultra: { key: 'plans.antigravity.ultra', fallback: 'Ultra' },
  'ultra-lite': { key: 'plans.antigravity.ultra_lite', fallback: 'Ultra Lite' },
};

const translate = (t: TFunction | undefined, key: string, fallback: string): string => {
  if (!t) return fallback;
  const value = t(key, { defaultValue: fallback });
  return value === key ? fallback : value;
};

const resolveDescriptor = (provider: string, planType: unknown) =>
  PLAN_RESOLVERS[provider]?.(planType) ?? null;

const getUnknownPlanIdentity = (provider: string, normalizedPlanType: string): string =>
  normalizedPlanType === RESERVED_UNKNOWN_PLAN
    ? RESERVED_UNKNOWN_PLAN
    : `${UNKNOWN_PLAN_PREFIX}${provider || 'unknown'}:${normalizedPlanType}`;

export const getCanonicalPlanType = (provider: unknown, planType: unknown): string | null => {
  const normalizedProvider = normalizePlanProvider(provider) || 'unknown';
  const normalized = normalizeRawPlanType(planType);
  if (!normalized) return null;
  return (
    resolveDescriptor(normalizedProvider, normalized)?.canonicalPlanType ??
    getUnknownPlanIdentity(normalizedProvider, normalized)
  );
};

export const getCanonicalPlanFilterLabel = (
  canonicalPlanType: string | null | undefined,
  t?: TFunction,
  fallback?: string
): string => {
  const normalized = normalizeRawPlanType(canonicalPlanType);
  if (!normalized) return fallback ?? '';
  if (normalized === RESERVED_UNKNOWN_PLAN) {
    return translate(t, 'auth_files.codex_plan_filter_unknown', 'Unknown plan');
  }
  const scopedUnknown = parseScopedUnknownPlanIdentity(normalized);
  if (scopedUnknown) {
    return fallback ?? scopedUnknown.normalizedPlanType;
  }
  const label = CANONICAL_PLAN_FILTER_LABELS[normalized];
  return label ? translate(t, label.key, label.fallback) : (fallback ?? normalized);
};

export const getPlanPresentation = ({
  provider,
  planType,
  t,
}: GetPlanPresentationInput): PlanPresentation | null => {
  const normalizedProvider = normalizePlanProvider(provider) || 'unknown';
  const rawPlanType = readRawPlanType(planType);
  if (!rawPlanType) return null;

  const normalizedPlanType = normalizeRawPlanType(rawPlanType);
  if (!normalizedPlanType) return null;
  const resolved = resolveDescriptor(normalizedProvider, normalizedPlanType);
  if (!resolved) {
    return {
      provider: normalizedProvider,
      rawPlanType,
      canonicalPlanType: getUnknownPlanIdentity(normalizedProvider, normalizedPlanType),
      shortLabel: rawPlanType,
      fullLabel: rawPlanType,
      known: false,
    };
  }

  const shortLabel = translate(t, resolved.shortLabelKey, resolved.shortDefault);
  const fullLabel = translate(
    t,
    resolved.fullLabelKey ?? resolved.shortLabelKey,
    resolved.fullDefault ?? resolved.shortDefault
  );
  return {
    provider: normalizedProvider,
    rawPlanType,
    canonicalPlanType: resolved.canonicalPlanType,
    shortLabel,
    fullLabel,
    known: true,
  };
};

export const getPlanLabel = (
  presentation: PlanPresentation | null | undefined,
  mode: PlanDisplayMode = 'compact'
): string | null => {
  if (!presentation) return null;
  return mode === 'full' ? presentation.fullLabel : presentation.shortLabel;
};
