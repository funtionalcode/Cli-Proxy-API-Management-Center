import type { AuthFileItem } from '@/types';
import type { CodexInspectionResult } from '@/services/api/usageService';
import {
  normalizeRecentRequestBuckets,
  sumRecentRequests,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import {
  authFileMatchesCodexStatusFilter,
  getAuthFileCodexInspectionKey,
  getAuthFileCodexInspectionKeyForFile,
  getAuthFileCodexInspectionKeyForIdentity,
  getAuthFileSelectionKey,
  type AuthFileCodexStatusSummary,
} from '@/features/authFiles/model/authFilesPageModel';
import { resolveCodexPlanType } from '@/utils/quota/resolvers';
import {
  compareQuotaResetLabels,
  compareQuotaResets,
  normalizeAccountProvider,
  readAuthFileCreatedAtMs,
  readAuthFileUpdatedAtMs,
  resolveAccountQuota,
  type AccountQuotaOverrides,
  type AccountQuotaSortDirection,
  type AccountQuotaStores,
  type AccountQuotaSummary,
} from '@/features/accounts/model/accountQuotaSummary';

export {
  compareQuotaResetLabels,
  compareQuotaResets,
  normalizeAccountProvider,
  readAuthFileCreatedAtMs,
  readAuthFileUpdatedAtMs,
  resolveAccountQuota,
};
export type {
  AccountQuotaOverrides,
  AccountQuotaSource,
  AccountQuotaStatus,
  AccountQuotaStores,
  AccountQuotaSummary,
} from '@/features/accounts/model/accountQuotaSummary';

export type AccountQuotaBand = 'all' | 'ge50' | 'between20and50' | 'lt20' | 'spent';
export const ACCOUNT_CODEX_STATUS_FILTERS = [
  'reauth',
  'quota_limited',
  'five_hour_limited',
  'weekly_limited',
  'monthly_limited',
  'disabled_with_reset',
] as const;
export const ACCOUNT_STATUS_FILTERS = [
  'all',
  'available',
  'disabled',
  'problem',
  'low',
  'exhausted',
  'inspection',
  ...ACCOUNT_CODEX_STATUS_FILTERS,
] as const;
export type AccountCodexStatusFilter = (typeof ACCOUNT_CODEX_STATUS_FILTERS)[number];
export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];
export type AccountRowSortKey =
  | 'default'
  | 'name'
  | 'plan'
  | 'note'
  | 'reset'
  | 'priority'
  | 'recent'
  | 'quota'
  | 'created';
export type AccountRowSortDirection = AccountQuotaSortDirection;

export interface AccountRowSort {
  key: AccountRowSortKey;
  direction: AccountRowSortDirection;
}

export interface AccountInspectionSummary {
  source: 'local' | 'server';
  action: string;
  actionReason: string;
  actionStatus: string;
  statusCode: number | null;
  usedPercent: number | null;
  isQuota?: boolean | null;
  runId: number;
  resultId: number;
  createdAtMs: number;
}

export type AccountInspectionResult = CodexInspectionResult & {
  inspectionSource?: 'local' | 'server';
};

export interface AccountUsageSummary {
  success: number;
  failure: number;
  successRate: number | null;
  recentRequests: RecentRequestBucket[];
}

export interface AccountRow {
  key: string;
  selectionKey: string;
  fileName: string;
  accountLabel: string;
  provider: string;
  planType: string | null;
  disabled: boolean;
  runtimeOnly: boolean;
  statusMessage: string;
  authIndex: string;
  projectId: string;
  note?: string;
  priority: number | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  quota: AccountQuotaSummary;
  usage: AccountUsageSummary;
  inspection: AccountInspectionSummary | null;
  raw: AuthFileItem;
}

export interface AccountInspectionTarget {
  fileName: string;
  runtimeId?: string | null;
  provider?: string | null;
  authIndex?: string | null;
  accountId?: string | null;
  accountSnapshot?: string | null;
}

export interface AccountMetrics {
  total: number;
  available: number;
  needsAttention: number;
  quotaRisk: number;
  disabled: number;
  unconfirmed: number;
  needsInspectionAction: number;
}

export interface AccountMetricOperationalContext {
  pendingActionsByRowKey?: ReadonlyMap<string, readonly unknown[]>;
  quotaCooldownsByRowKey?: ReadonlyMap<string, readonly unknown[]>;
}

export interface AccountRowFilters {
  provider: string;
  status: AccountStatusFilter;
  plan: string;
  quotaBand: AccountQuotaBand;
  search: string;
  codexStatusBySelectionKey?: ReadonlyMap<string, AuthFileCodexStatusSummary>;
}

const QUOTA_LOW_THRESHOLD = 20;
const QUOTA_OK_THRESHOLD = 50;
const UNKNOWN_ACCOUNT_PLAN = 'unknown';
const ACCOUNT_CODEX_STATUS_FILTER_SET = new Set<AccountCodexStatusFilter>(
  ACCOUNT_CODEX_STATUS_FILTERS
);
const PREMIUM_CODEX_PLAN_TYPES = new Set(['prolite', 'pro-lite', 'pro_lite']);

export const isAccountCodexStatusFilter = (
  status: AccountStatusFilter
): status is AccountCodexStatusFilter =>
  ACCOUNT_CODEX_STATUS_FILTER_SET.has(status as AccountCodexStatusFilter);

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getAccountPlanFilterValue = (planType: string | null): string =>
  planType?.trim() || UNKNOWN_ACCOUNT_PLAN;

const readAuthIndex = (file: AuthFileItem): string =>
  readString(file.authIndex ?? file['auth_index']);

const readProjectId = (file: AuthFileItem): string =>
  readString(
    file.projectId ?? file.project_id ?? file.geminiVirtualProject ?? file.gemini_virtual_project
  );

const readPlanType = (file: AuthFileItem): string | null => {
  if (normalizeAccountProvider(file) === 'codex') {
    const codexPlanType = resolveCodexPlanType(file);
    if (codexPlanType) return codexPlanType;
  }
  const idToken = file.id_token;
  const idTokenPlan =
    idToken && typeof idToken === 'object' && !Array.isArray(idToken)
      ? readString((idToken as Record<string, unknown>).plan_type)
      : '';
  const raw =
    idTokenPlan || readString(file.planType ?? file.plan_type ?? file.tier ?? file.subscription);
  return raw ? raw.toLowerCase() : null;
};

const resolveAccountLabel = (file: AuthFileItem): string =>
  readString(file.email) ||
  readString(file.account) ||
  readString(file.label) ||
  readString(file.note) ||
  file.name;

const resolveStatusMessage = (file: AuthFileItem): string =>
  readString(file.statusMessage ?? file['status_message']);

const buildInspectionMap = (
  results: AccountInspectionResult[] | undefined
): Map<string, AccountInspectionSummary> => {
  const map = new Map<string, AccountInspectionSummary>();
  if (!results) return map;

  results.forEach((result) => {
    const fileName = result.fileName.trim();
    if (!fileName) return;
    const key = getAuthFileCodexInspectionKeyForIdentity({
      fileName,
      runtimeId: result.runtimeId,
      provider: result.provider,
      authIndex: result.authIndex,
      accountId: result.accountId,
      accountSnapshot: result.accountSnapshot,
    });
    const current = map.get(key);
    if (current && current.createdAtMs >= result.createdAtMs) return;
    map.set(key, {
      source: result.inspectionSource ?? 'server',
      action: result.action || 'keep',
      actionReason: result.actionReason || '',
      actionStatus: result.actionStatus || 'none',
      statusCode: result.statusCode ?? null,
      usedPercent: result.usedPercent ?? null,
      isQuota: result.isQuota ?? null,
      runId: result.runId,
      resultId: result.id,
      createdAtMs: result.createdAtMs,
    });
  });
  return map;
};

const buildUsageSummary = (file: AuthFileItem): AccountUsageSummary => {
  const recentRequests = normalizeRecentRequestBuckets(file.recent_requests ?? file.recentRequests);
  const totals = sumRecentRequests(recentRequests);
  const total = totals.success + totals.failure;
  return {
    success: totals.success,
    failure: totals.failure,
    successRate: total > 0 ? (totals.success / total) * 100 : null,
    recentRequests,
  };
};

export const buildAccountRows = (
  files: AuthFileItem[],
  stores: AccountQuotaStores,
  inspectionResults?: AccountInspectionResult[],
  overrides?: AccountQuotaOverrides
): AccountRow[] => {
  const inspectionByFile = buildInspectionMap(inspectionResults);
  const fileNameCounts = files.reduce((counts, file) => {
    counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  return files.map((file) => {
    const provider = normalizeAccountProvider(file);
    const authIndex = readAuthIndex(file);
    const selectionKey = getAuthFileSelectionKey(file);
    const quota = resolveAccountQuota(file, stores, overrides);
    return {
      key: file.name,
      selectionKey,
      fileName: file.name,
      accountLabel: resolveAccountLabel(file),
      provider,
      planType: quota.planType ?? readPlanType(file),
      disabled: file.disabled === true,
      runtimeOnly:
        file.runtimeOnly === true || file.runtimeOnly === 'true' || file.runtime_only === true,
      statusMessage: resolveStatusMessage(file),
      authIndex,
      projectId: readProjectId(file),
      note: readString(file.note),
      priority: readNumber(file.priority),
      createdAtMs: readAuthFileCreatedAtMs(file),
      updatedAtMs: readAuthFileUpdatedAtMs(file),
      quota,
      usage: buildUsageSummary(file),
      inspection:
        inspectionByFile.get(getAuthFileCodexInspectionKeyForFile(file)) ??
        (fileNameCounts.get(file.name) === 1
          ? inspectionByFile.get(getAuthFileCodexInspectionKey(file.name, null))
          : undefined) ??
        null,
      raw: file,
    };
  });
};

export const findAccountRowForInspectionTarget = (
  rows: AccountRow[],
  target: AccountInspectionTarget
): AccountRow | null => {
  const targetKey = getAuthFileCodexInspectionKeyForIdentity(target);
  const exactMatches = rows.filter(
    (row) => getAuthFileCodexInspectionKeyForFile(row.raw) === targetKey
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const hasStableIdentity = Boolean(
    String(target.runtimeId ?? '').trim() ||
    String(target.authIndex ?? '').trim() ||
    String(target.accountId ?? '').trim() ||
    String(target.accountSnapshot ?? '').trim()
  );
  if (hasStableIdentity) return null;

  const matchingFileRows = rows.filter((row) => row.fileName === target.fileName);
  return matchingFileRows.length === 1 ? matchingFileRows[0] : null;
};

type AccountMetricStatus =
  | 'available'
  | 'needsAttention'
  | 'quotaRisk'
  | 'disabled'
  | 'unconfirmed';

const hasOperationalItems = (
  itemsByRowKey: ReadonlyMap<string, readonly unknown[]> | undefined,
  rowKey: string
): boolean => (itemsByRowKey?.get(rowKey)?.length ?? 0) > 0;

const hasPartialGroupedQuota = (row: AccountRow): boolean =>
  row.quota.groupedAvailabilityState === 'partial';

const needsAccountAttention = (
  row: AccountRow,
  context: AccountMetricOperationalContext
): boolean =>
  Boolean(
    (row.statusMessage && !hasPartialGroupedQuota(row)) ||
    row.quota.status === 'error' ||
    row.quota.error ||
    (row.inspection && row.inspection.action !== 'keep') ||
    hasOperationalItems(context.pendingActionsByRowKey, row.selectionKey)
  );

const hasAccountQuotaRisk = (row: AccountRow, context: AccountMetricOperationalContext): boolean =>
  row.quota.status === 'low' ||
  row.quota.status === 'exhausted' ||
  hasPartialGroupedQuota(row) ||
  hasOperationalItems(context.quotaCooldownsByRowKey, row.selectionKey);

const hasConfirmedAvailableEvidence = (row: AccountRow): boolean =>
  row.quota.status === 'ok' || row.inspection?.action === 'keep';

const hasAccountDiagnosticException = (row: AccountRow): boolean =>
  Boolean(row.quota.observedErrorKind || row.quota.observedErrorCode);

const classifyAccountMetricStatus = (
  row: AccountRow,
  context: AccountMetricOperationalContext
): AccountMetricStatus => {
  if (row.disabled || row.quota.status === 'disabled') return 'disabled';
  if (needsAccountAttention(row, context)) return 'needsAttention';
  if (hasAccountQuotaRisk(row, context)) return 'quotaRisk';
  if (hasAccountDiagnosticException(row)) return 'needsAttention';
  if (!hasConfirmedAvailableEvidence(row)) return 'unconfirmed';
  return 'available';
};

export const buildAccountMetrics = (
  rows: AccountRow[],
  context: AccountMetricOperationalContext = {}
): AccountMetrics => {
  const metrics: AccountMetrics = {
    total: rows.length,
    available: 0,
    needsAttention: 0,
    quotaRisk: 0,
    disabled: 0,
    unconfirmed: 0,
    needsInspectionAction: 0,
  };

  rows.forEach((row) => {
    const status = classifyAccountMetricStatus(row, context);
    metrics[status] += 1;
    if (
      row.inspection &&
      ['delete', 'disable', 'enable', 'reauth'].includes(row.inspection.action)
    ) {
      metrics.needsInspectionAction += 1;
    }
  });

  return metrics;
};

const isAccountRowAvailable = (row: AccountRow): boolean =>
  !row.disabled &&
  (!row.statusMessage || hasPartialGroupedQuota(row)) &&
  !row.quota.error &&
  row.quota.status !== 'error' &&
  row.quota.status !== 'exhausted' &&
  (!row.inspection || row.inspection.action === 'keep');

export const filterAccountRows = (rows: AccountRow[], filters: AccountRowFilters): AccountRow[] => {
  const search = filters.search.trim().toLowerCase();
  const wildcard = search.includes('*')
    ? new RegExp(
        search
          .split('*')
          .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*'),
        'i'
      )
    : null;
  return rows.filter((row) => {
    if (filters.provider !== 'all' && row.provider !== filters.provider) return false;
    if (filters.plan !== 'all' && getAccountPlanFilterValue(row.planType) !== filters.plan) {
      return false;
    }
    if (!matchesStatusFilter(row, filters.status, filters.codexStatusBySelectionKey)) return false;
    if (!matchesQuotaBand(row, filters.quotaBand)) return false;
    if (!search) return true;
    const values = [
      row.accountLabel,
      row.fileName,
      row.provider,
      row.planType,
      row.authIndex,
      row.projectId,
      row.note,
      row.statusMessage,
      row.raw.state,
      row.raw.status,
      row.raw.error,
      row.raw.errorStatus,
      row.raw['error_status'],
      row.quota.source,
      row.quota.error,
      row.quota.observedTraceId,
      row.quota.observedErrorKind,
      row.quota.observedErrorCode,
      row.quota.activeLimit,
      row.quota.creditsBalance,
      row.quota.rateLimitReachedType,
      row.inspection?.actionReason,
    ];
    return values.some((value) => {
      const text = readString(value);
      return wildcard ? wildcard.test(text) : text.toLowerCase().includes(search);
    });
  });
};

export const sortAccountRows = (rows: AccountRow[], sort?: AccountRowSort): AccountRow[] => {
  const defaultSorted = [...rows].sort(compareDefaultAccountRows);
  if (!sort || sort.key === 'default') return defaultSorted;

  return defaultSorted.sort((left, right) => {
    const byColumn = compareAccountRowsBySort(left, right, sort);
    return byColumn === 0 ? compareDefaultAccountRows(left, right) : byColumn;
  });
};

export const getProviderOptions = (rows: AccountRow[]) =>
  Array.from(new Set(rows.map((row) => row.provider))).sort();

export const getPlanOptions = (rows: AccountRow[]) => {
  const plans = new Set<string>();
  let hasUnknownPlan = false;
  rows.forEach((row) => {
    const plan = getAccountPlanFilterValue(row.planType);
    if (plan === UNKNOWN_ACCOUNT_PLAN) {
      hasUnknownPlan = true;
      return;
    }
    plans.add(plan);
  });
  const sortedPlans = Array.from(plans).sort((left, right) =>
    compareAccountPlanTypes(left, right, 'asc')
  );
  if (hasUnknownPlan) {
    const withoutUnknown = sortedPlans.filter((plan) => plan !== UNKNOWN_ACCOUNT_PLAN);
    return [...withoutUnknown, UNKNOWN_ACCOUNT_PLAN];
  }
  return sortedPlans;
};

const matchesStatusFilter = (
  row: AccountRow,
  status: AccountStatusFilter,
  codexStatusBySelectionKey?: ReadonlyMap<string, AuthFileCodexStatusSummary>
) => {
  if (status === 'all') return true;
  if (isAccountCodexStatusFilter(status)) {
    const codexStatus = codexStatusBySelectionKey?.get(row.selectionKey);
    return codexStatus ? authFileMatchesCodexStatusFilter(codexStatus, status) : false;
  }
  if (status === 'available') return isAccountRowAvailable(row);
  if (status === 'disabled') return row.disabled;
  if (status === 'problem') {
    return (
      Boolean((row.statusMessage && !hasPartialGroupedQuota(row)) || row.quota.error) ||
      row.quota.status === 'error'
    );
  }
  if (status === 'low') return row.quota.status === 'low';
  if (status === 'exhausted') return row.quota.status === 'exhausted';
  if (status === 'inspection') return Boolean(row.inspection && row.inspection.action !== 'keep');
  return true;
};

const matchesQuotaBand = (row: AccountRow, band: AccountQuotaBand) => {
  if (band === 'all') return true;
  const remaining = row.quota.remainingPercent;
  if (band === 'spent') return remaining !== null && remaining <= 0;
  if (band === 'lt20')
    return remaining !== null && remaining > 0 && remaining < QUOTA_LOW_THRESHOLD;
  if (band === 'between20and50') {
    return remaining !== null && remaining >= QUOTA_LOW_THRESHOLD && remaining < QUOTA_OK_THRESHOLD;
  }
  if (band === 'ge50') return remaining !== null && remaining >= QUOTA_OK_THRESHOLD;
  return true;
};

const getRiskRank = (row: AccountRow) => {
  if (row.inspection && row.inspection.action !== 'keep') return 7;
  if (row.quota.status === 'exhausted') return 6;
  if (row.quota.status === 'low') return 5;
  if (row.quota.status === 'error' || row.quota.error) return 4;
  if (hasPartialGroupedQuota(row)) return 3;
  if (row.disabled) return 2;
  if (row.statusMessage) return 1;
  return 0;
};

const compareDefaultAccountRows = (left: AccountRow, right: AccountRow) => {
  const leftRisk = getRiskRank(left);
  const rightRisk = getRiskRank(right);
  if (leftRisk !== rightRisk) return rightRisk - leftRisk;
  if (left.provider !== right.provider) return left.provider.localeCompare(right.provider);
  return left.fileName.localeCompare(right.fileName, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};

const getAccountPlanSortRank = (planType: string | null): number | null => {
  const normalized = planType?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'pro') return 50;
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return 40;
  if (normalized === 'team') return 30;
  if (normalized === 'plus') return 20;
  if (normalized === 'free') return 10;
  return 0;
};

const compareAccountPlanTypes = (
  left: string | null,
  right: string | null,
  direction: AccountRowSortDirection
) => {
  const leftRank = getAccountPlanSortRank(left);
  const rightRank = getAccountPlanSortRank(right);
  const leftKnown = leftRank !== null;
  const rightKnown = rightRank !== null;
  if (!leftKnown && !rightKnown) return 0;
  if (!leftKnown) return 1;
  if (!rightKnown) return -1;
  const rankComparison = compareNumbers(leftRank, rightRank, direction);
  return rankComparison || compareText(left ?? '', right ?? '', direction);
};

const compareAccountRowsBySort = (left: AccountRow, right: AccountRow, sort: AccountRowSort) => {
  if (sort.key === 'name') {
    const accountComparison = compareText(left.accountLabel, right.accountLabel, sort.direction);
    return accountComparison || compareText(left.fileName, right.fileName, sort.direction);
  }
  if (sort.key === 'plan') {
    return compareAccountPlanTypes(left.planType, right.planType, sort.direction);
  }
  if (sort.key === 'note') {
    return compareText(left.note ?? '', right.note ?? '', sort.direction, true);
  }
  if (sort.key === 'priority') {
    return compareNumbers(left.priority ?? 0, right.priority ?? 0, sort.direction);
  }
  if (sort.key === 'recent') {
    const leftTotal = left.usage.success + left.usage.failure;
    const rightTotal = right.usage.success + right.usage.failure;
    return compareNumbers(leftTotal, rightTotal, sort.direction);
  }
  if (sort.key === 'quota') {
    return compareNullableNumbers(
      left.quota.remainingPercent,
      right.quota.remainingPercent,
      sort.direction
    );
  }
  if (sort.key === 'created') {
    return compareNullableNumbers(left.createdAtMs, right.createdAtMs, sort.direction);
  }
  if (sort.key === 'reset') {
    return compareQuotaResets(left.quota, right.quota, sort.direction);
  }
  return 0;
};

const compareText = (
  left: string,
  right: string,
  direction: AccountRowSortDirection,
  emptyLast = false
) => {
  const leftValue = left.trim();
  const rightValue = right.trim();
  if (emptyLast) {
    if (!leftValue && !rightValue) return 0;
    if (!leftValue) return 1;
    if (!rightValue) return -1;
  }
  const result = leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  return direction === 'asc' ? result : -result;
};

const compareNumbers = (left: number, right: number, direction: AccountRowSortDirection) => {
  const result = left - right;
  return direction === 'asc' ? result : -result;
};

const compareNullableNumbers = (
  left: number | null,
  right: number | null,
  direction: AccountRowSortDirection
) => {
  const leftKnown = typeof left === 'number' && Number.isFinite(left);
  const rightKnown = typeof right === 'number' && Number.isFinite(right);
  if (!leftKnown && !rightKnown) return 0;
  if (!leftKnown) return 1;
  if (!rightKnown) return -1;
  return compareNumbers(left, right, direction);
};
