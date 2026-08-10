import type { AccountRow } from './accountRows';

export type AccountRecommendationAction =
  | 'refresh'
  | 'disable'
  | 'enable'
  | 'restore-default'
  | 'reauth'
  | 'review';

export type AccountRecommendationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface AccountRecommendation {
  row: AccountRow;
  action: AccountRecommendationAction;
  priority: AccountRecommendationPriority;
  reasonKey: string;
}

const priorityRank: Record<AccountRecommendationPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const getRecommendationRank = (priority: AccountRecommendationPriority) =>
  priorityRank[priority] ?? 0;

export const buildAccountRecommendation = (row: AccountRow): AccountRecommendation | null => {
  if (row.runtimeOnly) {
    return {
      row,
      action: 'review',
      priority: 'low',
      reasonKey: 'accounts.recommend_reason_runtime',
    };
  }

  if (row.inspection && row.inspection.action !== 'keep') {
    const action =
      row.inspection.action === 'disable' ||
      row.inspection.action === 'enable' ||
      row.inspection.action === 'reauth'
        ? row.inspection.action
        : 'review';
    return {
      row,
      action,
      priority: row.inspection.action === 'reauth' ? 'critical' : 'high',
      reasonKey: 'accounts.recommend_reason_inspection',
    };
  }

  if (row.quota.status === 'exhausted') {
    return {
      row,
      action: row.disabled ? 'enable' : 'disable',
      priority: 'critical',
      reasonKey: row.disabled
        ? 'accounts.recommend_reason_disabled_exhausted'
        : 'accounts.recommend_reason_exhausted',
    };
  }

  if (row.quota.status === 'low') {
    return {
      row,
      action: 'refresh',
      priority: 'high',
      reasonKey: 'accounts.recommend_reason_low',
    };
  }

  if (row.quota.status === 'error' || row.quota.error) {
    return {
      row,
      action: 'refresh',
      priority: 'medium',
      reasonKey: 'accounts.recommend_reason_error',
    };
  }

  if (row.disabled && row.quota.status === 'ok') {
    return {
      row,
      action: 'enable',
      priority: 'medium',
      reasonKey: 'accounts.recommend_reason_recovered',
    };
  }

  if (row.priority !== null && row.priority < 0) {
    return {
      row,
      action: 'restore-default',
      priority: 'low',
      reasonKey: 'accounts.recommend_reason_priority',
    };
  }

  return null;
};

export const buildAccountRecommendations = (rows: AccountRow[]): AccountRecommendation[] =>
  rows
    .map(buildAccountRecommendation)
    .filter((item): item is AccountRecommendation => item !== null)
    .sort((left, right) => {
      const rankDiff = getRecommendationRank(right.priority) - getRecommendationRank(left.priority);
      if (rankDiff !== 0) return rankDiff;
      return left.row.fileName.localeCompare(right.row.fileName, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
