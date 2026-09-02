import type { TFunction } from 'i18next';

/** Providers with a known subscription/plan identity are resolved explicitly. */
export type PlanProvider = string;

export type PlanDisplayMode = 'compact' | 'full';

export interface PlanPresentation {
  provider: PlanProvider;
  rawPlanType: string | null;
  canonicalPlanType: string | null;
  shortLabel: string;
  fullLabel: string;
  known: boolean;
}

export interface GetPlanPresentationInput {
  provider: unknown;
  planType: unknown;
  t?: TFunction;
}
