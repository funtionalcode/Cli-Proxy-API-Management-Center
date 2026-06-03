/**
 * Shared plan normalization and ordering helpers.
 */

import { normalizeStringValue } from './parsers';

export type PlanSortDirection = 'asc' | 'desc';

export const normalizePlanKey = (value: unknown): string => {
  const normalized = normalizeStringValue(value);
  return normalized ? normalized.toLowerCase().replace(/[-_\s]/g, '') : '';
};

export const getCodexPlanSortRank = (value: unknown): number | null => {
  const key = normalizePlanKey(value);
  if (!key) return null;
  if (key === 'pro' || key === 'pro20x') return 50;
  if (key === 'prolite' || key === 'pro5x') return 40;
  if (key === 'team') return 30;
  if (key === 'plus') return 20;
  if (key === 'free') return 10;
  return 0;
};

export const isPremiumCodexPlanType = (value: unknown): boolean => {
  const key = normalizePlanKey(value);
  return key === 'pro' || key === 'pro20x' || key === 'prolite' || key === 'pro5x';
};

export const comparePlanValuesByRank = (
  left: unknown,
  right: unknown,
  direction: PlanSortDirection = 'desc'
): number => {
  const leftRank = getCodexPlanSortRank(left);
  const rightRank = getCodexPlanSortRank(right);
  const leftKnown = leftRank !== null;
  const rightKnown = rightRank !== null;

  if (leftKnown || rightKnown) {
    if (!leftKnown) return 1;
    if (!rightKnown) return -1;

    const rankDiff = direction === 'desc' ? rightRank - leftRank : leftRank - rightRank;
    if (rankDiff !== 0) return rankDiff;
  }

  if (leftRank === 0 && rightRank === 0) {
    const leftLabel = normalizeStringValue(left) ?? '';
    const rightLabel = normalizeStringValue(right) ?? '';
    const labelCompare = leftLabel.localeCompare(rightLabel, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (labelCompare !== 0) return direction === 'desc' ? -labelCompare : labelCompare;
  }

  return 0;
};
