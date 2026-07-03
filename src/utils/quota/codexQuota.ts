import type {
  CodexAdditionalRateLimit,
  CodexRateLimitInfo,
  CodexUsagePayload,
  CodexUsageWindow,
} from '@/types';
import { formatCodexResetLabel } from './formatters';
import { normalizeNumberValue, normalizePlanType, normalizeStringValue } from './parsers';

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;
const MONTH_SECONDS = 2_592_000;
const MIN_MONTH_SECONDS = 28 * 24 * 60 * 60;
const MAX_MONTH_SECONDS = 31 * 24 * 60 * 60;

type CodexQuotaWindowMeta = {
  id: string;
  labelKey: string;
};

const CODEX_WINDOW_META = {
  codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
  codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
  codeMonthly: { id: 'monthly', labelKey: 'codex_quota.monthly_window' },
  codeReviewFiveHour: {
    id: 'code-review-five-hour',
    labelKey: 'codex_quota.code_review_primary_window',
  },
  codeReviewWeekly: {
    id: 'code-review-weekly',
    labelKey: 'codex_quota.code_review_secondary_window',
  },
  codeReviewMonthly: {
    id: 'code-review-monthly',
    labelKey: 'codex_quota.code_review_monthly_window',
  },
} as const satisfies Record<string, CodexQuotaWindowMeta>;

export type CodexQuotaWindowInfo = {
  id: string;
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

const formatWindowDuration = (seconds: number | null): string => {
  if (seconds === null || seconds <= 0) return 'unknown';
  const daySeconds = 86_400;
  const hourSeconds = 3_600;
  if (seconds % daySeconds === 0) {
    const days = seconds / daySeconds;
    return `${days}d`;
  }
  if (seconds % hourSeconds === 0) {
    const hours = seconds / hourSeconds;
    return `${hours}h`;
  }
  return `${seconds}s`;
};

const hasExplicitWindowSeconds = (window?: CodexUsageWindow | null): boolean =>
  getWindowSeconds(window) !== null;

const isMonthlyWindow = (window?: CodexUsageWindow | null): boolean => {
  const seconds = getWindowSeconds(window);
  return seconds !== null && seconds >= MIN_MONTH_SECONDS && seconds <= MAX_MONTH_SECONDS;
};

const pickClassifiedWindows = (
  limitInfo?: CodexRateLimitInfo | null,
  options?: { allowOrderFallback?: boolean; teamPlan?: boolean }
): {
  fiveHourWindow: CodexUsageWindow | null;
  weeklyWindow: CodexUsageWindow | null;
  monthlyWindow: CodexUsageWindow | null;
  longWindow: CodexUsageWindow | null;
  windows: CodexUsageWindow[];
} => {
  const allowOrderFallback = options?.allowOrderFallback ?? true;
  const teamPlan = options?.teamPlan ?? false;
  const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
  const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
  const rawWindows = [primaryWindow, secondaryWindow];

  let fiveHourWindow: CodexUsageWindow | null = null;
  let weeklyWindow: CodexUsageWindow | null = null;
  let monthlyWindow: CodexUsageWindow | null = null;
  let genericLongWindow: CodexUsageWindow | null = null;
  const windows: CodexUsageWindow[] = [];

  for (const window of rawWindows) {
    if (!window) continue;
    windows.push(window);
    const seconds = getWindowSeconds(window);
    if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window;
    } else if (seconds === WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window;
    } else if ((seconds === MONTH_SECONDS || isMonthlyWindow(window)) && !monthlyWindow) {
      monthlyWindow = window;
    } else if (seconds !== null && seconds > FIVE_HOUR_SECONDS && !genericLongWindow) {
      genericLongWindow = window;
    }
  }

  if (allowOrderFallback) {
    const shouldFallbackPrimary = primaryWindow && !hasExplicitWindowSeconds(primaryWindow);
    const shouldFallbackSecondary = secondaryWindow && !hasExplicitWindowSeconds(secondaryWindow);
    if (!fiveHourWindow) {
      fiveHourWindow =
        shouldFallbackPrimary && primaryWindow !== weeklyWindow ? primaryWindow : null;
    }
    if (!weeklyWindow) {
      if (teamPlan) {
        monthlyWindow =
          !monthlyWindow && shouldFallbackSecondary && secondaryWindow !== fiveHourWindow
            ? secondaryWindow
            : monthlyWindow;
      } else {
        weeklyWindow =
          shouldFallbackSecondary && secondaryWindow !== fiveHourWindow ? secondaryWindow : null;
      }
    }
  }

  return {
    fiveHourWindow,
    weeklyWindow,
    monthlyWindow,
    longWindow: weeklyWindow ?? monthlyWindow ?? genericLongWindow,
    windows,
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
    labelKey,
    labelParams,
    usedPercent,
    resetLabel,
    limitWindowSeconds: getWindowSeconds(window),
  });
};

const addCodexRateLimitWindows = (
  windows: CodexQuotaWindowInfo[],
  limitInfo: CodexRateLimitInfo | null | undefined,
  fiveHourMeta: CodexQuotaWindowMeta,
  weeklyMeta: CodexQuotaWindowMeta,
  monthlyMeta: CodexQuotaWindowMeta,
  genericLabelKey: string,
  genericLabelParams?: Record<string, string | number>,
  options?: { teamPlan?: boolean }
) => {
  const limitReached = limitInfo?.limit_reached ?? limitInfo?.limitReached;
  const allowed = limitInfo?.allowed;
  const classified = pickClassifiedWindows(limitInfo, { teamPlan: options?.teamPlan });
  const added = new Set<CodexUsageWindow>();

  addCodexWindowInfo(
    windows,
    fiveHourMeta.id,
    fiveHourMeta.labelKey,
    genericLabelParams,
    classified.fiveHourWindow,
    limitReached,
    allowed
  );
  if (classified.fiveHourWindow) added.add(classified.fiveHourWindow);
  addCodexWindowInfo(
    windows,
    weeklyMeta.id,
    weeklyMeta.labelKey,
    genericLabelParams,
    classified.weeklyWindow,
    limitReached,
    allowed
  );
  if (classified.weeklyWindow) added.add(classified.weeklyWindow);
  addCodexWindowInfo(
    windows,
    monthlyMeta.id,
    monthlyMeta.labelKey,
    genericLabelParams,
    classified.monthlyWindow,
    limitReached,
    allowed
  );
  if (classified.monthlyWindow) added.add(classified.monthlyWindow);

  classified.windows.forEach((window, index) => {
    if (added.has(window)) return;
    const seconds = getWindowSeconds(window);
    const duration = formatWindowDuration(seconds);
    addCodexWindowInfo(
      windows,
      `${genericLabelParams?.name ? `${normalizeWindowId(String(genericLabelParams.name))}-` : ''}window-${duration}-${index}`,
      genericLabelKey,
      { ...genericLabelParams, duration },
      window,
      limitReached,
      allowed
    );
  });
};

const addAdditionalRateLimitWindows = (
  windows: CodexQuotaWindowInfo[],
  additionalRateLimits: CodexAdditionalRateLimit[] | null | undefined,
  options?: { teamPlan?: boolean }
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

    addCodexRateLimitWindows(
      windows,
      rateInfo,
      {
        id: `${idPrefix}-five-hour-${index}`,
        labelKey: 'codex_quota.additional_primary_window',
      },
      {
        id: `${idPrefix}-weekly-${index}`,
        labelKey: 'codex_quota.additional_secondary_window',
      },
      {
        id: `${idPrefix}-monthly-${index}`,
        labelKey: 'codex_quota.additional_monthly_window',
      },
      'codex_quota.additional_generic_window',
      { name: limitName },
      options
    );
  });
};

export const buildCodexQuotaWindowInfos = (
  payload: CodexUsagePayload,
  options?: { planType?: string | null }
): CodexQuotaWindowInfo[] => {
  const windows: CodexQuotaWindowInfo[] = [];
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits;
  const planType = normalizePlanType(options?.planType ?? payload.plan_type ?? payload.planType);
  const teamPlan = planType === 'team';

  addCodexRateLimitWindows(
    windows,
    rateLimit,
    CODEX_WINDOW_META.codeFiveHour,
    CODEX_WINDOW_META.codeWeekly,
    CODEX_WINDOW_META.codeMonthly,
    'codex_quota.generic_window',
    undefined,
    { teamPlan }
  );
  addCodexRateLimitWindows(
    windows,
    codeReviewLimit,
    CODEX_WINDOW_META.codeReviewFiveHour,
    CODEX_WINDOW_META.codeReviewWeekly,
    CODEX_WINDOW_META.codeReviewMonthly,
    'codex_quota.code_review_generic_window',
    undefined,
    { teamPlan }
  );
  addAdditionalRateLimitWindows(windows, additionalRateLimits, { teamPlan });

  return windows;
};
