import { normalizeRawPlanType } from '../normalize';
import type { PlanResolverDescriptor } from './types';

const descriptor = (
  canonicalPlanType: string,
  shortLabelKey: string,
  shortDefault: string,
  fullLabelKey?: string,
  fullDefault?: string
): PlanResolverDescriptor => ({
  canonicalPlanType,
  shortLabelKey,
  shortDefault,
  ...(fullLabelKey ? { fullLabelKey } : {}),
  ...(fullDefault ? { fullDefault } : {}),
});

/** Codex raw plan aliases mapped to one stable internal plan identity. */
export const CODEX_PLAN_DESCRIPTORS: Readonly<Record<string, PlanResolverDescriptor>> = {
  free: descriptor('free', 'plans.codex.free', 'Free'),
  go: descriptor('go', 'plans.codex.go', 'Go'),
  plus: descriptor('plus', 'plans.codex.plus', 'Plus'),
  prolite: descriptor('pro_5x', 'plans.codex.pro_5x', 'Pro 5x'),
  'pro-lite': descriptor('pro_5x', 'plans.codex.pro_5x', 'Pro 5x'),
  pro_lite: descriptor('pro_5x', 'plans.codex.pro_5x', 'Pro 5x'),
  pro_5x: descriptor('pro_5x', 'plans.codex.pro_5x', 'Pro 5x'),
  pro: descriptor('pro_20x', 'plans.codex.pro_20x', 'Pro 20x'),
  pro_20x: descriptor('pro_20x', 'plans.codex.pro_20x', 'Pro 20x'),
  team: descriptor('team', 'plans.codex.team', 'Team'),
  self_serve_business_prolite: descriptor(
    'business_premium_5x',
    'plans.codex.business_premium_5x.short',
    'Business 5x',
    'plans.codex.business_premium_5x.full',
    'Business Premium 5x'
  ),
  self_serve_business_usage_based: descriptor(
    'business_usage_based',
    'plans.codex.business_usage_based.short',
    'Business PAYG',
    'plans.codex.business_usage_based.full',
    'Business Usage-based'
  ),
  business_premium_5x: descriptor(
    'business_premium_5x',
    'plans.codex.business_premium_5x.short',
    'Business 5x',
    'plans.codex.business_premium_5x.full',
    'Business Premium 5x'
  ),
  business_usage_based: descriptor(
    'business_usage_based',
    'plans.codex.business_usage_based.short',
    'Business PAYG',
    'plans.codex.business_usage_based.full',
    'Business Usage-based'
  ),
  business: descriptor('business', 'plans.codex.business', 'Business'),
  ent26: descriptor('enterprise', 'plans.codex.enterprise', 'Enterprise'),
  enterprise: descriptor('enterprise', 'plans.codex.enterprise', 'Enterprise'),
  hc: descriptor('enterprise', 'plans.codex.enterprise', 'Enterprise'),
  enterprise_cbp_automation: descriptor(
    'enterprise_automation',
    'plans.codex.enterprise_automation.short',
    'Ent. Auto',
    'plans.codex.enterprise_automation.full',
    'Enterprise Automation'
  ),
  enterprise_automation: descriptor(
    'enterprise_automation',
    'plans.codex.enterprise_automation.short',
    'Ent. Auto',
    'plans.codex.enterprise_automation.full',
    'Enterprise Automation'
  ),
  enterprise_cbp_usage_based: descriptor(
    'enterprise_usage_based',
    'plans.codex.enterprise_usage_based.short',
    'Ent. PAYG',
    'plans.codex.enterprise_usage_based.full',
    'Enterprise Usage-based'
  ),
  enterprise_usage_based: descriptor(
    'enterprise_usage_based',
    'plans.codex.enterprise_usage_based.short',
    'Ent. PAYG',
    'plans.codex.enterprise_usage_based.full',
    'Enterprise Usage-based'
  ),
  edu: descriptor('edu', 'plans.codex.edu.short', 'Edu', 'plans.codex.edu.full', 'Education'),
  education: descriptor(
    'edu',
    'plans.codex.edu.short',
    'Edu',
    'plans.codex.edu.full',
    'Education'
  ),
  edu_plus: descriptor(
    'edu_plus',
    'plans.codex.edu_plus.short',
    'Edu Plus',
    'plans.codex.edu_plus.full',
    'Education Plus'
  ),
  edu_pro: descriptor(
    'edu_pro',
    'plans.codex.edu_pro.short',
    'Edu Pro',
    'plans.codex.edu_pro.full',
    'Education Pro'
  ),
};

export const resolveCodexPlanDescriptor = (planType: unknown): PlanResolverDescriptor | null => {
  const normalized = normalizeRawPlanType(planType);
  return normalized ? (CODEX_PLAN_DESCRIPTORS[normalized] ?? null) : null;
};
