import type {
  CodexAdditionalRateLimit,
  CodexRateLimitInfo,
  CodexUsagePayload,
  CodexUsageWindow,
} from '@/types';
import { formatCodexResetLabel } from './formatters';
import { normalizeNumberValue, normalizeStringValue } from './parsers';

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;
const MONTH_SECONDS = 2_592_000;

type CodexQuotaWindowMeta = {
  idPrefix?: string;
  labelKeys: Record<CodexQuotaWindowKind, string>;
};

const CODEX_WINDOW_META = {
  code: {
    labelKeys: {
      'five-hour': 'codex_quota.primary_window',
      weekly: 'codex_quota.secondary_window',
      monthly: 'codex_quota.monthly_window',
      custom: 'codex_quota.custom_window',
    },
  },
  codeReview: {
    idPrefix: 'code-review',
    labelKeys: {
      'five-hour': 'codex_quota.code_review_primary_window',
      weekly: 'codex_quota.code_review_secondary_window',
      monthly: 'codex_quota.code_review_monthly_window',
      custom: 'codex_quota.code_review_custom_window',
    },
  },
  additional: {
    labelKeys: {
      'five-hour': 'codex_quota.additional_primary_window',
      weekly: 'codex_quota.additional_secondary_window',
      monthly: 'codex_quota.additional_monthly_window',
      custom: 'codex_quota.additional_custom_window',
    },
  },
} as const satisfies Record<string, CodexQuotaWindowMeta>;

export type CodexQuotaWindowKind = 'five-hour' | 'weekly' | 'monthly' | 'custom';

type CodexRateLimitWindowSlot = 'primary' | 'secondary';

export type CodexClassifiedRateLimitWindow = {
  window: CodexUsageWindow;
  kind: CodexQuotaWindowKind;
  slot: CodexRateLimitWindowSlot;
  sourceIndex: number;
  limitWindowSeconds: number | null;
};

export type CodexClassifiedRateLimitWindows = {
  windows: CodexClassifiedRateLimitWindow[];
  fiveHourWindow: CodexUsageWindow | null;
  weeklyWindow: CodexUsageWindow | null;
  monthlyWindow: CodexUsageWindow | null;
  shortTermWindow: CodexClassifiedRateLimitWindow | null;
  longTermWindow: CodexClassifiedRateLimitWindow | null;
};

export type CodexQuotaWindowInfo = {
  id: string;
  kind: CodexQuotaWindowKind;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetLabel: string;
  limitWindowSeconds: number | null;
};

const getWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
  if (!window) return null;
  return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
};

export const getCodexQuotaWindowUsedPercent = (window?: CodexUsageWindow | null): number | null =>
  normalizeNumberValue(window?.used_percent ?? window?.usedPercent);

const normalizeWindowId = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const formatDurationHours = (seconds: number | null): string => {
  if (seconds === null || seconds <= 0) return '?';
  const hours = seconds / 3600;
  return Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1);
};

const getWindowKind = (
  window: CodexUsageWindow,
  slot: CodexRateLimitWindowSlot,
  allowOrderFallback: boolean
): CodexQuotaWindowKind => {
  const seconds = getWindowSeconds(window);
  if (seconds === FIVE_HOUR_SECONDS) return 'five-hour';
  if (seconds === WEEK_SECONDS) return 'weekly';
  if (seconds === MONTH_SECONDS) return 'monthly';

  if (seconds === null && allowOrderFallback) {
    return slot === 'primary' ? 'five-hour' : 'weekly';
  }

  return 'custom';
};

const getWindowSortRank = (window: CodexClassifiedRateLimitWindow) => {
  if (window.kind === 'five-hour') return 10;
  if (window.kind === 'weekly') return 20;
  if (window.kind === 'monthly') return 30;
  return 40 + window.sourceIndex;
};

const compareClassifiedWindows = (
  left: CodexClassifiedRateLimitWindow,
  right: CodexClassifiedRateLimitWindow
) => getWindowSortRank(left) - getWindowSortRank(right);

const isLongTermWindow = (window: CodexClassifiedRateLimitWindow) => {
  if (window.kind === 'weekly' || window.kind === 'monthly') return true;
  return window.limitWindowSeconds !== null && window.limitWindowSeconds > FIVE_HOUR_SECONDS;
};

const compareLongTermWindows = (
  left: CodexClassifiedRateLimitWindow,
  right: CodexClassifiedRateLimitWindow
) => {
  const leftSeconds = left.limitWindowSeconds ?? 0;
  const rightSeconds = right.limitWindowSeconds ?? 0;
  return rightSeconds - leftSeconds || compareClassifiedWindows(left, right);
};

const pickClassifiedWindows = (
  limitInfo?: CodexRateLimitInfo | null,
  options?: { allowOrderFallback?: boolean }
): CodexClassifiedRateLimitWindows => {
  const allowOrderFallback = options?.allowOrderFallback ?? true;
  const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
  const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
  const rawWindows: Array<{
    window: CodexUsageWindow | null;
    slot: CodexRateLimitWindowSlot;
  }> = [
    { window: primaryWindow, slot: 'primary' },
    { window: secondaryWindow, slot: 'secondary' },
  ];
  const windows = rawWindows
    .map((entry, sourceIndex): CodexClassifiedRateLimitWindow | null => {
      if (!entry.window) return null;
      return {
        window: entry.window,
        kind: getWindowKind(entry.window, entry.slot, allowOrderFallback),
        slot: entry.slot,
        sourceIndex,
        limitWindowSeconds: getWindowSeconds(entry.window),
      };
    })
    .filter((entry): entry is CodexClassifiedRateLimitWindow => entry !== null)
    .sort(compareClassifiedWindows);

  const fiveHourWindow = windows.find((window) => window.kind === 'five-hour')?.window ?? null;
  const weeklyWindow = windows.find((window) => window.kind === 'weekly')?.window ?? null;
  const monthlyWindow = windows.find((window) => window.kind === 'monthly')?.window ?? null;
  const shortTermWindow = windows.find((window) => window.kind === 'five-hour') ?? null;
  const longTermWindow = windows.filter(isLongTermWindow).sort(compareLongTermWindows)[0] ?? null;

  return {
    windows,
    fiveHourWindow,
    weeklyWindow,
    monthlyWindow,
    shortTermWindow,
    longTermWindow,
  };
};

export const classifyCodexRateLimitWindows = pickClassifiedWindows;

export const getCodexRateLimitWindows = (rateLimit?: CodexRateLimitInfo | null) => [
  rateLimit?.primary_window ?? rateLimit?.primaryWindow ?? null,
  rateLimit?.secondary_window ?? rateLimit?.secondaryWindow ?? null,
];

export const deriveCodexRateLimitUsedPercent = (
  rateLimit?: CodexRateLimitInfo | null
): number | null => {
  const values = getCodexRateLimitWindows(rateLimit)
    .map((window) => getCodexQuotaWindowUsedPercent(window))
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return Math.max(...values);
};

export const isCodexRateLimitReached = (rateLimit?: CodexRateLimitInfo | null): boolean => {
  if (!rateLimit) return false;
  if (rateLimit.allowed === false) return true;
  if (rateLimit.limit_reached === true || rateLimit.limitReached === true) return true;
  return getCodexRateLimitWindows(rateLimit).some((window) => {
    const value = getCodexQuotaWindowUsedPercent(window);
    return value !== null && value >= 100;
  });
};

const addCodexWindowInfo = (
  windows: CodexQuotaWindowInfo[],
  id: string,
  kind: CodexQuotaWindowKind,
  labelKey: string,
  labelParams: Record<string, string | number> | undefined,
  window?: CodexUsageWindow | null,
  limitReached?: boolean,
  allowed?: boolean
) => {
  if (!window) return;

  const resetLabel = formatCodexResetLabel(window);
  const usedPercentRaw = getCodexQuotaWindowUsedPercent(window);
  const isLimitReached = Boolean(limitReached) || allowed === false;
  const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);

  windows.push({
    id,
    kind,
    labelKey,
    labelParams,
    usedPercent,
    resetLabel,
    limitWindowSeconds: getWindowSeconds(window),
  });
};

const buildWindowId = (
  meta: CodexQuotaWindowMeta,
  classified: CodexClassifiedRateLimitWindow,
  additional?: { idPrefix: string; index: number }
) => {
  const kindId =
    classified.kind === 'custom' ? `custom-${classified.sourceIndex + 1}` : classified.kind;
  if (additional) return `${additional.idPrefix}-${kindId}-${additional.index}`;
  return meta.idPrefix ? `${meta.idPrefix}-${kindId}` : kindId;
};

const buildWindowLabelParams = (
  classified: CodexClassifiedRateLimitWindow,
  base?: Record<string, string | number>
): Record<string, string | number> | undefined => {
  const params = { ...(base ?? {}) };
  if (classified.kind === 'custom') {
    params.duration = formatDurationHours(classified.limitWindowSeconds);
  }
  return Object.keys(params).length > 0 ? params : undefined;
};

const addCodexRateLimitWindows = (
  windows: CodexQuotaWindowInfo[],
  limitInfo: CodexRateLimitInfo | null | undefined,
  meta: CodexQuotaWindowMeta,
  options?: {
    additional?: { idPrefix: string; index: number; name: string };
  }
) => {
  const limitReached = limitInfo?.limit_reached ?? limitInfo?.limitReached;
  const allowed = limitInfo?.allowed;
  const classified = pickClassifiedWindows(limitInfo);

  classified.windows.forEach((entry) => {
    addCodexWindowInfo(
      windows,
      buildWindowId(meta, entry, options?.additional),
      entry.kind,
      meta.labelKeys[entry.kind],
      buildWindowLabelParams(
        entry,
        options?.additional ? { name: options.additional.name } : undefined
      ),
      entry.window,
      limitReached,
      allowed
    );
  });
};

const addAdditionalRateLimitWindows = (
  windows: CodexQuotaWindowInfo[],
  additionalRateLimits: CodexAdditionalRateLimit[] | null | undefined
) => {
  if (!Array.isArray(additionalRateLimits)) return;

  additionalRateLimits.forEach((limitItem, index) => {
    const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
    if (!rateInfo) return;

    const limitName =
      normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
      normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
      `additional-${index + 1}`;
    const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;

    addCodexRateLimitWindows(windows, rateInfo, CODEX_WINDOW_META.additional, {
      additional: { idPrefix, index, name: limitName },
    });
  });
};

export const buildCodexQuotaWindowInfos = (payload: CodexUsagePayload): CodexQuotaWindowInfo[] => {
  const windows: CodexQuotaWindowInfo[] = [];
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits;

  addCodexRateLimitWindows(windows, rateLimit, CODEX_WINDOW_META.code);
  addCodexRateLimitWindows(windows, codeReviewLimit, CODEX_WINDOW_META.codeReview);
  addAdditionalRateLimitWindows(windows, additionalRateLimits);

  return windows;
};
