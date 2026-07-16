import type { TFunction } from 'i18next';
import type { AxiosRequestConfig } from 'axios';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
  CodexRateLimitResetCredit,
  CodexQuotaWindow,
  CodexUsagePayload,
  KimiQuotaRow,
  XaiBillingConfig,
  XaiBillingDiagnostic,
  XaiBillingPeriod,
  XaiBillingPeriodType,
  XaiBillingSummary,
  XaiProductUsageSummary,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api/apiCall';
import { isRecord } from '@/utils/helpers';
import {
  antigravitySubscriptionApi,
  type AntigravitySubscriptionSummary,
} from '@/services/api/antigravitySubscription';
import { authFilesApi } from '@/services/api/authFiles';
import {
  ANTIGRAVITY_AVAILABLE_MODELS_URLS,
  ANTIGRAVITY_QUOTA_SUMMARY_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  CLAUDE_USAGE_WINDOW_KEYS,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_REQUEST_HEADERS,
} from './constants';
import { buildAntigravityQuotaGroups, buildKimiQuotaRows } from './builders';
import { createStatusError, formatQuotaResetTime, getStatusFromError } from './formatters';
import {
  normalizeAuthIndex,
  normalizeNumberValue,
  normalizePlanType,
  normalizeStringValue,
  parseAntigravityPayload,
  parseClaudeUsagePayload,
  parseCodexUsagePayload,
  parseKimiUsagePayload,
  parseXaiBillingPayload,
} from './parsers';
import { resolveCodexChatgptAccountId, resolveCodexPlanType } from './resolvers';
import { buildCodexQuotaWindowInfos } from './codexQuota';
import {
  buildCodexResetCreditsRequestHeaders,
  buildCodexUsageRequestHeaders,
} from './codexRequestHeaders';
import { normalizeCodexResetCreditsPayload } from './resetCredits';
import { classifyXaiProbe, parseXaiErrorEnvelope, XaiProbeError } from './xaiErrors';

const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'bamboo-precept-lgxtn';
const CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS = 8000;

export type CodexQuotaData = {
  planType: string | null;
  windows: CodexQuotaWindow[];
  subscriptionActiveUntil: string | null;
  rateLimitResetCreditsAvailableCount: number | null;
  rateLimitResetCredits: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError: string | null;
};

export type ClaudeQuotaData = {
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
};

export type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription?: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs: number | null;
};

const antigravitySubscriptionRequests = new Map<
  string,
  Promise<AntigravityQuotaSubscription | null>
>();

const toAntigravityQuotaSubscription = (
  summary: AntigravitySubscriptionSummary | null
): AntigravityQuotaSubscription | null => {
  if (!summary) return null;
  return {
    plan: summary.plan,
    tierName: summary.tierName,
    tierId: summary.tierId,
  };
};

const fetchAntigravityQuotaSubscription = (
  authIndex: string
): Promise<AntigravityQuotaSubscription | null> => {
  const existing = antigravitySubscriptionRequests.get(authIndex);
  if (existing) return existing;

  const request = antigravitySubscriptionApi
    .get(authIndex)
    .then(toAntigravityQuotaSubscription)
    .catch(() => null)
    .finally(() => {
      antigravitySubscriptionRequests.delete(authIndex);
    });
  antigravitySubscriptionRequests.set(authIndex, request);
  return request;
};

export const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  const directProjectId = normalizeStringValue(file.project_id ?? file.projectId);
  if (directProjectId) return directProjectId;

  const metadata =
    file.metadata && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const metadataProjectId = metadata
    ? normalizeStringValue(metadata.project_id ?? metadata.projectId)
    : null;
  if (metadataProjectId) return metadataProjectId;

  const attributes =
    file.attributes && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const attributesProjectId = attributes
    ? normalizeStringValue(
        attributes.project_id ?? attributes.projectId ?? attributes.gemini_virtual_project
      )
    : null;
  if (attributesProjectId) return attributesProjectId;

  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return DEFAULT_ANTIGRAVITY_PROJECT_ID;

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return DEFAULT_ANTIGRAVITY_PROJECT_ID;
  }

  return DEFAULT_ANTIGRAVITY_PROJECT_ID;
};

const resolveResponseServerTimeOffsetMs = (
  header: Record<string, string[]> | undefined
): number | null => {
  if (!header) return null;
  const dateEntry = Object.entries(header).find(([key]) => key.toLowerCase() === 'date');
  const rawDate = dateEntry?.[1]?.[0];
  if (!rawDate) return null;
  const serverTime = new Date(rawDate).getTime();
  if (Number.isNaN(serverTime)) return null;
  return serverTime - Date.now();
};

export const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  const requestBody = JSON.stringify({ project: projectId });
  const subscriptionPromise = fetchAntigravityQuotaSubscription(authIndex);

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of [...ANTIGRAVITY_QUOTA_SUMMARY_URLS, ...ANTIGRAVITY_AVAILABLE_MODELS_URLS]) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(
        result.body ?? result.bodyText
      ) as AntigravityQuotaSummaryPayload | null;
      if (!payload) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(payload);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return {
        groups,
        subscription: await subscriptionPromise,
        serverTimeOffsetMs: resolveResponseServerTimeOffsetMs(result.header),
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      if (status) {
        lastStatus = status;
        if (status === 403 || status === 404) {
          priorityStatus ??= status;
        }
      }
    }
  }

  if (hadSuccess) {
    return {
      groups: [],
      subscription: await subscriptionPromise,
      serverTimeOffsetMs: null,
    };
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

export const buildCodexQuotaWindows = (
  payload: CodexUsagePayload,
  t: TFunction,
  planType?: string | null
): CodexQuotaWindow[] =>
  buildCodexQuotaWindowInfos(payload, { planType }).map((window) => ({
    id: window.id,
    label: t(window.labelKey, window.labelParams),
    labelKey: window.labelKey,
    labelParams: window.labelParams,
    usedPercent: window.usedPercent,
    resetLabel: window.resetLabel,
    limitWindowSeconds: window.limitWindowSeconds,
  }));

const resolveCodexRateLimitResetCreditsAvailableCount = (
  payload: CodexUsagePayload
): number | null => {
  const credits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits;
  return normalizeNumberValue(credits?.available_count ?? credits?.availableCount);
};

const resolveCodexSubscriptionActiveUntil = (payload: CodexUsagePayload): string | null =>
  normalizeStringValue(payload.subscription_active_until ?? payload.subscriptionActiveUntil);

type CodexResetCreditsData = {
  availableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  error: string | null;
};

const resolveCodexResetCreditsAvailableCount = (
  resetCredits: CodexResetCreditsData,
  usageAvailableCount: number | null
): number | null => {
  if (resetCredits.availableCount !== null) return resetCredits.availableCount;
  if (resetCredits.credits.length > 0) return resetCredits.credits.length;
  return usageAvailableCount;
};

const fetchCodexResetCredits = async (
  authIndex: string,
  accountId: string | null | undefined,
  t: TFunction
): Promise<CodexResetCreditsData> => {
  try {
    const result = await apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
        header: buildCodexResetCreditsRequestHeaders(accountId),
      },
      { timeout: CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS }
    );

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return {
        availableCount: null,
        credits: [],
        error: getApiCallErrorMessage(result),
      };
    }

    const payload = normalizeCodexResetCreditsPayload(result.body ?? result.bodyText);
    if (payload.invalidPayload) {
      return {
        availableCount: null,
        credits: [],
        error: t('codex_quota.reset_credits_invalid_payload'),
      };
    }

    return {
      availableCount: payload.availableCount,
      credits: payload.credits,
      error: null,
    };
  } catch (err: unknown) {
    return {
      availableCount: null,
      credits: [],
      error: err instanceof Error ? err.message : 'Failed to fetch Codex reset credits',
    };
  }
};

export const fetchCodexQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<CodexQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const planTypeFromFile = resolveCodexPlanType(file);
  const accountId = resolveCodexChatgptAccountId(file);
  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: buildCodexUsageRequestHeaders(accountId),
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const planType = planTypeFromUsage ?? planTypeFromFile;
  const windows = buildCodexQuotaWindows(payload, t, planType);
  const usageResetCreditsAvailableCount = resolveCodexRateLimitResetCreditsAvailableCount(payload);
  const resetCredits = await fetchCodexResetCredits(authIndex, accountId, t);
  return {
    planType,
    windows,
    subscriptionActiveUntil: resolveCodexSubscriptionActiveUntil(payload),
    rateLimitResetCreditsAvailableCount: resolveCodexResetCreditsAvailableCount(
      resetCredits,
      usageResetCreditsAvailableCount
    ),
    rateLimitResetCredits: resetCredits.credits,
    rateLimitResetCreditsError: resetCredits.error,
  };
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const normalizeClaudeLimitToken = (value: unknown): string | null => {
  const normalized = normalizeStringValue(value);
  if (!normalized) return null;
  return normalized
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const isClaudeWeeklyScopedLimit = (limit: Record<string, unknown>): boolean => {
  const kind = normalizeClaudeLimitToken(limit.kind);
  const group = normalizeClaudeLimitToken(limit.group);
  if (group && group !== 'weekly') return false;
  if (kind === 'weekly_scoped' || kind === 'weekly_model_scoped') return true;
  return kind === 'model_scoped' && group === 'weekly';
};

type ClaudeBaseLimitWindowId = 'five-hour' | 'seven-day';

const resolveClaudeBaseLimitWindowId = (
  limit: Record<string, unknown>
): ClaudeBaseLimitWindowId | null => {
  const kind = normalizeClaudeLimitToken(limit.kind);
  const group = normalizeClaudeLimitToken(limit.group);

  if (kind === 'session' && (!group || group === 'session')) return 'five-hour';
  if (
    (kind === 'weekly' || kind === 'weekly_all') &&
    (!group || group === 'weekly' || group === 'weekly_all')
  ) {
    return 'seven-day';
  }
  return null;
};

type ClaudeLimitWindowValues = Pick<ClaudeQuotaWindow, 'usedPercent' | 'resetLabel'>;

const resolveClaudeLimitResetAt = (limit: Record<string, unknown>): string => {
  const rawResetAt = limit.resets_at ?? limit.resetsAt ?? limit.reset_at ?? limit.resetAt;
  return typeof rawResetAt === 'string' ? rawResetAt.trim() : '';
};

const resolveClaudeLimitResetRank = (limit: Record<string, unknown>): number => {
  const resetTimestamp = Date.parse(resolveClaudeLimitResetAt(limit));
  return Number.isFinite(resetTimestamp) ? resetTimestamp : -1;
};

const parseClaudeLimitWindowValues = (
  limit: Record<string, unknown>
): ClaudeLimitWindowValues | null => {
  const rawPercent = normalizeNumberValue(limit.percent);
  const usedPercent = rawPercent !== null && rawPercent >= 0 ? rawPercent : null;
  const resetAt = resolveClaudeLimitResetAt(limit);
  const resetLabel = formatQuotaResetTime(resetAt || undefined);
  if (usedPercent === null && resetLabel === '-') return null;
  return { usedPercent, resetLabel };
};

const findClaudeModelDisplayName = (value: unknown): string | null => {
  if (!isRecord(value)) return null;

  const readDisplayName = (candidate: Record<string, unknown>): string | null => {
    const rawDisplayName = candidate.display_name ?? candidate.displayName;
    if (typeof rawDisplayName !== 'string') return null;
    const normalized = rawDisplayName.trim().replace(/\s+/g, ' ');
    return normalized || null;
  };

  const direct = readDisplayName(value);
  if (direct) return direct;

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    return readDisplayName(details);
  }
  return null;
};

const normalizeClaudeIdentityText = (value: string): string => {
  try {
    return value.normalize('NFKC');
  } catch {
    return value;
  }
};

const encodeClaudeWindowIdPart = (value: string): string => {
  try {
    return encodeURIComponent(value);
  } catch {
    const codeUnits = Array.from({ length: value.length }, (_, index) =>
      value.charCodeAt(index).toString(16).padStart(4, '0')
    );
    return `utf16-${codeUnits.join('-')}`;
  }
};

type ClaudeScopedWeeklyWindowEntry = {
  activityRank: number;
  identityKey: string;
  modelId: string | null;
  resetAtRank: number;
  sortLabel: string;
  usedPercentRank: number;
  window: ClaudeQuotaWindow;
};

const hasValidClaudeReset = (entry: ClaudeScopedWeeklyWindowEntry): boolean =>
  entry.resetAtRank >= 0;

const getClaudeScopedCompletenessRank = (entry: ClaudeScopedWeeklyWindowEntry): number =>
  (entry.usedPercentRank >= 0 ? 1 : 0) + (hasValidClaudeReset(entry) ? 1 : 0);

const shouldReplaceClaudeScopedWindow = (
  existing: ClaudeScopedWeeklyWindowEntry,
  candidate: ClaudeScopedWeeklyWindowEntry
): boolean => {
  if (
    hasValidClaudeReset(existing) &&
    hasValidClaudeReset(candidate) &&
    candidate.resetAtRank !== existing.resetAtRank
  ) {
    return candidate.resetAtRank > existing.resetAtRank;
  }
  if (candidate.activityRank !== existing.activityRank) {
    return candidate.activityRank > existing.activityRank;
  }
  const candidateCompleteness = getClaudeScopedCompletenessRank(candidate);
  const existingCompleteness = getClaudeScopedCompletenessRank(existing);
  if (candidateCompleteness !== existingCompleteness) {
    return candidateCompleteness > existingCompleteness;
  }
  if (hasValidClaudeReset(existing) !== hasValidClaudeReset(candidate)) {
    return hasValidClaudeReset(candidate);
  }
  if (candidate.resetAtRank !== existing.resetAtRank) {
    return candidate.resetAtRank > existing.resetAtRank;
  }
  return candidate.usedPercentRank > existing.usedPercentRank;
};

const areEquivalentClaudeScopedWindows = (
  left: ClaudeScopedWeeklyWindowEntry,
  right: ClaudeScopedWeeklyWindowEntry
): boolean =>
  left.activityRank === right.activityRank &&
  left.resetAtRank === right.resetAtRank &&
  left.usedPercentRank === right.usedPercentRank;

type ClaudeBaseLimitCandidate = {
  completenessRank: number;
  kindRank: number;
  resetAtRank: number;
  usedPercentRank: number;
  values: ClaudeLimitWindowValues;
};

const shouldReplaceClaudeBaseLimit = (
  existing: ClaudeBaseLimitCandidate,
  candidate: ClaudeBaseLimitCandidate
): boolean => {
  if (candidate.resetAtRank !== existing.resetAtRank) {
    return candidate.resetAtRank > existing.resetAtRank;
  }
  if (candidate.completenessRank !== existing.completenessRank) {
    return candidate.completenessRank > existing.completenessRank;
  }
  if (candidate.kindRank !== existing.kindRank) {
    return candidate.kindRank > existing.kindRank;
  }
  return candidate.usedPercentRank > existing.usedPercentRank;
};

const buildClaudeBaseLimitFallbacks = (
  payload: ClaudeUsagePayload
): Map<ClaudeBaseLimitWindowId, ClaudeLimitWindowValues> => {
  const candidates = new Map<ClaudeBaseLimitWindowId, ClaudeBaseLimitCandidate>();
  if (!Array.isArray(payload.limits)) return new Map();

  for (const rawLimit of payload.limits) {
    try {
      if (!isRecord(rawLimit)) continue;
      if (normalizeFlagValue(rawLimit.is_active ?? rawLimit.isActive) === false) continue;
      if (rawLimit.scope !== undefined && rawLimit.scope !== null) continue;

      const windowId = resolveClaudeBaseLimitWindowId(rawLimit);
      if (!windowId) continue;
      const values = parseClaudeLimitWindowValues(rawLimit);
      if (!values) continue;
      const kind = normalizeClaudeLimitToken(rawLimit.kind);
      const candidate: ClaudeBaseLimitCandidate = {
        completenessRank:
          (values.usedPercent !== null ? 1 : 0) + (values.resetLabel !== '-' ? 1 : 0),
        kindRank: windowId === 'seven-day' && kind === 'weekly_all' ? 1 : 0,
        resetAtRank: resolveClaudeLimitResetRank(rawLimit),
        usedPercentRank: values.usedPercent ?? -1,
        values,
      };
      const existing = candidates.get(windowId);
      if (existing && !shouldReplaceClaudeBaseLimit(existing, candidate)) continue;
      candidates.set(windowId, candidate);
    } catch {
      continue;
    }
  }

  return new Map(
    [...candidates.entries()].map(([windowId, candidate]) => [windowId, candidate.values])
  );
};

const buildClaudeScopedWeeklyWindows = (payload: ClaudeUsagePayload): ClaudeQuotaWindow[] => {
  if (!Array.isArray(payload.limits)) return [];

  const idWindowsByModel = new Map<string, ClaudeScopedWeeklyWindowEntry>();
  const labelOnlyWindowsByModel = new Map<string, ClaudeScopedWeeklyWindowEntry>();
  const idKeysByLabel = new Map<string, Set<string>>();
  for (const rawLimit of payload.limits) {
    try {
      if (!isRecord(rawLimit) || !isClaudeWeeklyScopedLimit(rawLimit)) continue;

      const scope = isRecord(rawLimit.scope) ? rawLimit.scope : null;
      const model = isRecord(scope?.model) ? scope.model : null;
      if (!model) continue;
      const label = findClaudeModelDisplayName(model);
      if (!label) continue;

      const values = parseClaudeLimitWindowValues(rawLimit);
      if (!values) continue;

      const rawModelId = model.id ?? model.model_id ?? model.modelId;
      const modelId =
        typeof rawModelId === 'string' && rawModelId.trim()
          ? normalizeClaudeIdentityText(rawModelId.trim())
          : null;
      const labelKey = normalizeClaudeIdentityText(label).toLowerCase();
      const identityKey = modelId ? `id:${modelId}` : `label:${labelKey}`;
      const activeFlag = normalizeFlagValue(rawLimit.is_active ?? rawLimit.isActive);
      const activityRank = activeFlag === true ? 2 : activeFlag === undefined ? 1 : 0;

      const idPart = modelId
        ? `id-${encodeClaudeWindowIdPart(modelId)}`
        : encodeClaudeWindowIdPart(labelKey);
      const candidate: ClaudeScopedWeeklyWindowEntry = {
        activityRank,
        identityKey,
        modelId,
        resetAtRank: resolveClaudeLimitResetRank(rawLimit),
        sortLabel: labelKey,
        usedPercentRank: values.usedPercent ?? -1,
        window: {
          id: `weekly-scoped-${idPart}`,
          label,
          ...values,
        },
      };
      const targetMap = modelId ? idWindowsByModel : labelOnlyWindowsByModel;
      if (modelId) {
        const idKeys = idKeysByLabel.get(labelKey) ?? new Set<string>();
        idKeys.add(identityKey);
        idKeysByLabel.set(labelKey, idKeys);
      }
      const existing = targetMap.get(identityKey);
      if (existing && !shouldReplaceClaudeScopedWindow(existing, candidate)) continue;
      targetMap.set(identityKey, candidate);
    } catch {
      continue;
    }
  }

  for (const labelEntry of labelOnlyWindowsByModel.values()) {
    const matchingIdKeys = idKeysByLabel.get(labelEntry.sortLabel);
    if (matchingIdKeys?.size !== 1) continue;
    const identityKey = matchingIdKeys.values().next().value;
    if (!identityKey) continue;
    const idEntry = idWindowsByModel.get(identityKey);
    if (!idEntry) continue;
    if (areEquivalentClaudeScopedWindows(idEntry, labelEntry)) {
      labelOnlyWindowsByModel.delete(labelEntry.identityKey);
    }
  }

  const entries = [...idWindowsByModel.values(), ...labelOnlyWindowsByModel.values()];
  const labelCounts = new Map<string, number>();
  for (const entry of entries) {
    labelCounts.set(entry.sortLabel, (labelCounts.get(entry.sortLabel) ?? 0) + 1);
  }

  return entries
    .sort((left, right) => {
      if (left.sortLabel !== right.sortLabel) {
        return left.sortLabel < right.sortLabel ? -1 : 1;
      }
      return left.identityKey < right.identityKey
        ? -1
        : left.identityKey > right.identityKey
          ? 1
          : 0;
    })
    .map(({ sortLabel, modelId, window }) => {
      if (!modelId || (labelCounts.get(sortLabel) ?? 0) < 2) return window;
      return { ...window, label: `${window.label} (${modelId})` };
    });
};

const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];
  const baseLimitFallbacks = buildClaudeBaseLimitFallbacks(payload);
  const scopedWeeklyWindows = buildClaudeScopedWeeklyWindows(payload);

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    let renderedTopLevelWindow = false;
    if (window && typeof window === 'object' && 'utilization' in window) {
      const typedWindow = window as { utilization: number; resets_at: string };
      const usedPercent = normalizeNumberValue(typedWindow.utilization);
      const resetLabel = formatQuotaResetTime(typedWindow.resets_at);
      if (usedPercent !== null || resetLabel !== '-') {
        windows.push({
          id,
          label: t(labelKey),
          labelKey,
          usedPercent,
          resetLabel,
        });
        renderedTopLevelWindow = true;
      }
    }
    if (!renderedTopLevelWindow && (id === 'five-hour' || id === 'seven-day')) {
      const fallback = baseLimitFallbacks.get(id);
      if (fallback) {
        windows.push({
          id,
          label: t(labelKey),
          labelKey,
          ...fallback,
        });
      }
    }
    if (key === 'seven_day') {
      windows.push(...scopedWeeklyWindows);
    }
  }

  return windows;
};

export const fetchClaudeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<ClaudeQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return { windows, extraUsage: payload.extra_usage, planType };
};

export const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

const normalizeXaiCentValue = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeNumberValue((value as { val?: unknown }).val);
  }
  return normalizeNumberValue(value);
};

const resolveXaiPeriodType = (period?: XaiBillingPeriod | null): XaiBillingPeriodType => {
  const rawType = normalizeStringValue(period?.type)?.toLowerCase() ?? '';
  if (rawType.includes('weekly')) return 'weekly';
  if (rawType.includes('monthly')) return 'monthly';
  return 'unknown';
};

const normalizeXaiProductUsage = (
  productUsage: XaiBillingConfig['productUsage'],
  fallbackPrefix: string
): XaiProductUsageSummary[] => {
  if (!Array.isArray(productUsage)) return [];

  return productUsage
    .map((item, index): XaiProductUsageSummary | null => {
      if (!item || typeof item !== 'object') return null;
      const product = normalizeStringValue(item.product) ?? `${fallbackPrefix} ${index + 1}`;
      const usagePercent = normalizeNumberValue(item.usagePercent ?? item.usage_percent);
      return { product, usagePercent };
    })
    .filter((item): item is XaiProductUsageSummary => item !== null);
};

const emptyXaiBillingSummary = (): XaiBillingSummary => ({
  periodType: 'unknown',
  usagePercent: null,
  productUsage: [],
  monthlyLimitCents: null,
  usedCents: null,
  includedUsedCents: null,
  onDemandCapCents: null,
  onDemandUsedCents: null,
  onDemandUsedPercent: null,
  usedPercent: null,
});

export const buildXaiBillingSummary = (
  config: XaiBillingConfig | null | undefined
): XaiBillingSummary | null => {
  if (!config || typeof config !== 'object') return null;

  const summary = emptyXaiBillingSummary();
  const currentPeriod = config.currentPeriod ?? config.current_period ?? null;
  const periodType = resolveXaiPeriodType(currentPeriod);
  const creditUsagePercent = normalizeNumberValue(
    config.creditUsagePercent ?? config.credit_usage_percent
  );
  const periodStart =
    normalizeStringValue(currentPeriod?.start) ??
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start) ??
    undefined;
  const periodEnd =
    normalizeStringValue(currentPeriod?.end) ??
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end) ??
    undefined;
  const productUsage = normalizeXaiProductUsage(
    config.productUsage ?? config.product_usage,
    'Product'
  );

  const monthlyLimitCents = normalizeXaiCentValue(config.monthlyLimit ?? config.monthly_limit);
  const usedCents = normalizeXaiCentValue(config.used);
  const onDemandCapCents = normalizeXaiCentValue(config.onDemandCap ?? config.on_demand_cap);
  const explicitOnDemandUsedCents = normalizeXaiCentValue(
    config.onDemandUsed ?? config.on_demand_used
  );
  const billingPeriodStart =
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start) ?? undefined;
  const billingPeriodEnd =
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end) ?? undefined;

  const includedUsedCents =
    usedCents === null
      ? null
      : monthlyLimitCents !== null && monthlyLimitCents > 0
        ? Math.min(usedCents, monthlyLimitCents)
        : usedCents;
  const derivedOnDemandUsedCents =
    usedCents !== null && monthlyLimitCents !== null
      ? Math.max(0, usedCents - monthlyLimitCents)
      : null;
  const onDemandUsedCents = explicitOnDemandUsedCents ?? derivedOnDemandUsedCents;
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : null;
  const onDemandUsedPercent =
    onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : null;

  const hasWeeklyData =
    creditUsagePercent !== null || periodType === 'weekly' || productUsage.length > 0;
  const hasMonthlyData =
    monthlyLimitCents !== null ||
    usedCents !== null ||
    (!hasWeeklyData && (onDemandCapCents !== null || !!billingPeriodEnd));

  if (!hasWeeklyData && !hasMonthlyData) return null;

  summary.periodType = hasWeeklyData
    ? periodType === 'unknown'
      ? 'weekly'
      : periodType
    : 'monthly';
  summary.usagePercent = hasWeeklyData ? creditUsagePercent : usedPercent;
  summary.periodStart = hasWeeklyData ? periodStart : billingPeriodStart;
  summary.periodEnd = hasWeeklyData ? periodEnd : billingPeriodEnd;
  summary.productUsage = productUsage;
  summary.monthlyLimitCents = monthlyLimitCents;
  summary.usedCents = usedCents;
  summary.includedUsedCents = includedUsedCents;
  summary.onDemandCapCents = onDemandCapCents;
  summary.onDemandUsedCents = onDemandUsedCents;
  summary.onDemandUsedPercent = onDemandUsedPercent;
  summary.billingPeriodStart = hasMonthlyData ? billingPeriodStart : undefined;
  summary.billingPeriodEnd = hasMonthlyData ? billingPeriodEnd : undefined;
  summary.usedPercent = usedPercent;

  return summary;
};

export const mergeXaiBillingSummaries = (
  primary: XaiBillingSummary | null,
  fallback: XaiBillingSummary | null
): XaiBillingSummary | null => {
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    periodType: primary.periodType !== 'unknown' ? primary.periodType : fallback.periodType,
    usagePercent: primary.usagePercent ?? fallback.usagePercent,
    periodStart: primary.periodStart ?? fallback.periodStart,
    periodEnd: primary.periodEnd ?? fallback.periodEnd,
    productUsage: primary.productUsage.length > 0 ? primary.productUsage : fallback.productUsage,
    monthlyLimitCents: primary.monthlyLimitCents ?? fallback.monthlyLimitCents,
    usedCents: primary.usedCents ?? fallback.usedCents,
    includedUsedCents: primary.includedUsedCents ?? fallback.includedUsedCents,
    onDemandCapCents: primary.onDemandCapCents ?? fallback.onDemandCapCents,
    onDemandUsedCents: primary.onDemandUsedCents ?? fallback.onDemandUsedCents,
    onDemandUsedPercent: primary.onDemandUsedPercent ?? fallback.onDemandUsedPercent,
    billingPeriodStart: primary.billingPeriodStart ?? fallback.billingPeriodStart,
    billingPeriodEnd: primary.billingPeriodEnd ?? fallback.billingPeriodEnd,
    usedPercent: primary.usedPercent ?? fallback.usedPercent,
  };
};

const toXaiRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveXaiUserId = (file: AuthFileItem): string | null => {
  const metadata = toXaiRecord(file.metadata);
  const attributes = toXaiRecord(file.attributes);
  const oauth = toXaiRecord(file.oauth ?? metadata?.oauth ?? attributes?.oauth);
  const user = toXaiRecord(file.user ?? metadata?.user ?? attributes?.user);

  const candidates = [
    file.sub,
    file.subject,
    file.user_id,
    file.userId,
    metadata?.sub,
    metadata?.subject,
    metadata?.user_id,
    metadata?.userId,
    attributes?.sub,
    attributes?.subject,
    attributes?.user_id,
    attributes?.userId,
    oauth?.sub,
    oauth?.subject,
    user?.sub,
    user?.id,
  ];

  for (const candidate of candidates) {
    const userId = normalizeStringValue(candidate);
    if (userId) return userId;
  }

  return null;
};

const buildXaiRequestHeaders = (file: AuthFileItem): Record<string, string> => {
  const headers: Record<string, string> = { ...XAI_REQUEST_HEADERS };
  const userId = resolveXaiUserId(file);
  if (userId) {
    headers['x-userid'] = userId;
  }
  return headers;
};

const requestXaiBilling = async (
  authIndex: string,
  url: string,
  header: Record<string, string>,
  requestConfig?: AxiosRequestConfig
): Promise<XaiBillingSummary | null> => {
  const result = await apiCallApi.request(
    {
      authIndex,
      method: 'GET',
      url,
      header,
    },
    requestConfig
  );

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const envelope = parseXaiErrorEnvelope({
      statusCode: result.hasStatusCode ? result.statusCode : null,
      body: result.body,
      bodyText: result.bodyText,
      headers: result.header,
    });
    const decision = classifyXaiProbe({ surface: 'billing', envelope });
    throw new XaiProbeError(getApiCallErrorMessage(result), envelope, decision);
  }

	const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
	const summary = buildXaiBillingSummary(payload?.config);
	if (!summary) {
		const envelope = parseXaiErrorEnvelope({
			statusCode: result.hasStatusCode ? result.statusCode : null,
			body: result.body,
			bodyText: result.bodyText,
			headers: result.header,
		});
		const decision = classifyXaiProbe({ surface: 'billing', envelope, hasPayload: false });
		throw new XaiProbeError('xAI billing response schema changed', envelope, decision);
	}
	return summary;
};

export interface XaiBillingProbeResult {
  summary: XaiBillingSummary;
  failures: unknown[];
  partial: boolean;
}

const xaiFailurePriority = (failure: unknown) => {
  if (!(failure instanceof XaiProbeError)) return 0;
  switch (failure.decision.classification) {
    case 'auth_invalid':
      return 100;
    case 'free_quota_exhausted':
    case 'spending_limit':
      return 90;
    case 'client_outdated':
      return 80;
    case 'entitlement_denied':
    case 'permission_unknown':
    case 'quota_or_entitlement_unknown':
      return 70;
    case 'policy_denied':
      return 60;
    case 'rate_limited':
      return 40;
    case 'probe_invalid':
      return 30;
    case 'upstream_error':
      return 10;
    default:
      return 1;
  }
};

const selectXaiBillingFailure = (failures: unknown[]) =>
  failures.reduce<unknown>(
    (selected, failure) =>
      xaiFailurePriority(failure) > xaiFailurePriority(selected) ? failure : selected,
    failures[0]
  );

export const probeXaiBilling = async (
  file: AuthFileItem,
  t: TFunction,
  requestConfig?: AxiosRequestConfig
): Promise<XaiBillingProbeResult> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  const requestHeader = buildXaiRequestHeaders(file);
  const [weeklyResult, monthlyResult] = await Promise.allSettled([
    requestXaiBilling(authIndex, XAI_BILLING_WEEKLY_URL, requestHeader, requestConfig),
    requestXaiBilling(authIndex, XAI_BILLING_MONTHLY_URL, requestHeader, requestConfig),
  ]);
  const weeklySummary = weeklyResult.status === 'fulfilled' ? weeklyResult.value : null;
  const monthlySummary = monthlyResult.status === 'fulfilled' ? monthlyResult.value : null;
  const failures = [weeklyResult, monthlyResult].flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );
  const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);
  if (!summary) {
    if (failures.length > 0) throw selectXaiBillingFailure(failures);
    throw new Error(t('xai_quota.empty_data'));
  }

  return {
    summary,
    failures,
    partial: failures.length > 0 || weeklySummary === null || monthlySummary === null,
  };
};

export const fetchXaiQuota = async (file: AuthFileItem, t: TFunction): Promise<XaiBillingSummary> =>
  probeXaiBilling(file, t).then(({ summary, partial, failures }) => ({
    ...summary,
    partial,
    diagnostics: failures.map((failure): XaiBillingDiagnostic => {
      if (failure instanceof XaiProbeError) {
        return {
          classification: failure.decision.classification,
          statusCode: failure.envelope.statusCode,
          message: failure.message,
        };
      }
      return {
        classification: 'unknown',
        statusCode: null,
        message: failure instanceof Error ? failure.message : String(failure),
      };
    }),
  }));
