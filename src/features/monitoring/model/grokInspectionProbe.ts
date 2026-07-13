import type { TFunction } from 'i18next';
import type { AuthFileItem, XaiBillingSummary } from '@/types';
import {
  fetchXaiQuota,
  formatQuotaResetTime,
  getStatusFromError,
  isDisabledAuthFile,
  resolveAuthProvider,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';
import {
  type CodexInspectionAccount,
  type CodexInspectionLogLevel,
  type CodexInspectionQuotaWindow,
  type CodexInspectionResultItem,
  type CodexInspectionSettings,
} from '@/features/monitoring/codexInspection';
import { readString } from './codexInspectionSettings';

type LogHandler = (level: CodexInspectionLogLevel, message: string) => void;

const MAX_INSPECTION_ERROR_DETAIL_LENGTH = 2048;

const fallbackT = ((key: string, params?: Record<string, unknown>) => {
  if (!params) return key;
  return Object.entries(params).reduce(
    (message, [name, value]) => message.replace(`{{${name}}}`, String(value)),
    key
  );
}) as TFunction;

const truncateInspectionDetail = (value: unknown) => {
  const text = readString(value);
  if (!text) return '';
  if (text.length <= MAX_INSPECTION_ERROR_DETAIL_LENGTH) return text;
  return `${text.slice(0, MAX_INSPECTION_ERROR_DETAIL_LENGTH - 3)}...`;
};

const readAuthFileName = (file: AuthFileItem) => {
  const name = readString(file.name);
  if (name) return name;
  const id = readString(file.id);
  if (id) return id;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return authIndex || 'unknown-grok-auth-file';
};

const readDisplayAccount = (file: AuthFileItem) =>
  readString(file.account) ||
  readString(file.email) ||
  readString(file.label) ||
  readString(file.name) ||
  readString(file.id) ||
  normalizeAuthIndex(file['auth_index'] ?? file.authIndex) ||
  '-';

export const toGrokInspectionAccount = (file: AuthFileItem): CodexInspectionAccount => ({
  key: `${readAuthFileName(file)}::${normalizeAuthIndex(file['auth_index'] ?? file.authIndex) || '-'}`,
  fileName: readAuthFileName(file),
  displayAccount: readDisplayAccount(file),
  authIndex: normalizeAuthIndex(file['auth_index'] ?? file.authIndex),
  accountId: null,
  provider: resolveAuthProvider(file),
  disabled: isDisabledAuthFile(file),
  status: readString(file.status),
  state: readString(file.state),
  raw: file,
});

const withRetry = async <T>(retries: number, task: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const normalizePercent = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const buildGrokQuotaWindows = (billing: XaiBillingSummary): CodexInspectionQuotaWindow[] => {
  const windows: CodexInspectionQuotaWindow[] = [];

  if (billing.periodType === 'weekly' || billing.usagePercent !== null || billing.periodEnd) {
    windows.push({
      id: 'weekly',
      labelKey: 'xai_quota.weekly_limit',
      usedPercent: normalizePercent(billing.usagePercent),
      resetLabel: formatQuotaResetTime(billing.periodEnd),
      limitWindowSeconds: null,
    });
  }

  billing.productUsage.forEach((item, index) => {
    windows.push({
      id: `product-${index}`,
      labelKey: 'xai_quota.product_usage',
      labelParams: { product: item.product },
      usedPercent: normalizePercent(item.usagePercent),
      resetLabel: '',
      limitWindowSeconds: null,
    });
  });

  if (
    billing.monthlyLimitCents !== null ||
    billing.usedCents !== null ||
    billing.billingPeriodEnd
  ) {
    windows.push({
      id: 'monthly',
      labelKey: 'xai_quota.monthly_credits',
      usedPercent: normalizePercent(billing.usedPercent),
      resetLabel: formatQuotaResetTime(billing.billingPeriodEnd),
      limitWindowSeconds: null,
    });
  }

  if (billing.onDemandCapCents !== null && billing.onDemandCapCents > 0) {
    windows.push({
      id: 'pay-as-you-go',
      labelKey: 'xai_quota.pay_as_you_go_label',
      usedPercent: normalizePercent(billing.onDemandUsedPercent),
      resetLabel: '',
      limitWindowSeconds: null,
    });
  }

  return windows;
};

const resolveHighestUsedPercent = (billing: XaiBillingSummary): number | null => {
  const values = [
    billing.usagePercent,
    billing.usedPercent,
    billing.onDemandUsedPercent,
    ...billing.productUsage.map((item) => item.usagePercent),
  ]
    .map(normalizePercent)
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  return Math.max(...values);
};

const inspectGrokError = (
  account: CodexInspectionAccount,
  error: unknown
): CodexInspectionResultItem => {
  const statusCode = getStatusFromError(error) ?? null;
  const errorMessage = error instanceof Error ? error.message : String(error || '探测失败');
  const errorDetail = truncateInspectionDetail(errorMessage) || '探测失败';

  if (statusCode === 401 || statusCode === 403) {
    return {
      ...account,
      action: 'reauth',
      actionReason: `Grok 账单接口返回 ${statusCode}，认证可能已失效，建议重新登录或删除认证文件`,
      statusCode,
      usedPercent: null,
      isQuota: false,
      error: errorMessage,
      quotaWindows: [],
      errorKind: 'auth_failed',
      errorDetail,
    };
  }

  if (statusCode === 404 || statusCode === 410) {
    return {
      ...account,
      action: 'delete',
      actionReason: `Grok 账单接口返回 ${statusCode}，认证文件不可用，建议删除`,
      statusCode,
      usedPercent: null,
      isQuota: false,
      error: errorMessage,
      quotaWindows: [],
      errorKind: 'auth_unavailable',
      errorDetail,
    };
  }

  return {
    ...account,
    action: 'keep',
    actionReason: statusCode === 429 ? 'Grok 账单接口限流，保留账号' : '探测异常，保留账号',
    statusCode,
    usedPercent: null,
    isQuota: false,
    error: errorMessage,
    quotaWindows: [],
    errorKind: statusCode ? 'http_status' : 'request_error',
    errorDetail,
  };
};

export const inspectSingleGrokAccount = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  onLog?: LogHandler
): Promise<CodexInspectionResultItem> => {
  if (!account.authIndex) {
    onLog?.('warning', `${account.displayAccount} 缺少 auth_index，跳过 Grok 探测`);
    return {
      ...account,
      action: 'keep',
      actionReason: '缺少 auth_index，保留账号',
      statusCode: null,
      usedPercent: null,
      isQuota: false,
      error: '缺少 auth_index',
      quotaWindows: [],
      errorKind: 'missing_auth_index',
      errorDetail: '缺少 auth_index',
    };
  }

  try {
    const billing = await withRetry(settings.retries, () => fetchXaiQuota(account.raw, fallbackT));
    const quotaWindows = buildGrokQuotaWindows(billing);
    const usedPercent = resolveHighestUsedPercent(billing);
    const overThreshold = usedPercent !== null && usedPercent >= settings.usedPercentThreshold;

    const action = overThreshold
      ? account.disabled
        ? 'keep'
        : 'disable'
      : account.disabled
        ? 'enable'
        : 'keep';
    const actionReason = overThreshold
      ? account.disabled
        ? 'Grok 额度达到阈值，但认证文件已禁用'
        : 'Grok 额度达到阈值，建议禁用认证文件'
      : account.disabled
        ? 'Grok 额度仍可用，建议重新启用认证文件'
        : 'Grok 额度仍可用，无需处理';
    const level = action === 'disable' ? 'warning' : action === 'enable' ? 'success' : 'info';
    const percentText = usedPercent === null ? '--' : `${usedPercent.toFixed(1)}%`;

    onLog?.(level, `${account.displayAccount} -> ${action} (Grok 已用 ${percentText})`);

    return {
      ...account,
      action,
      actionReason,
      statusCode: 200,
      usedPercent,
      isQuota: overThreshold,
      error: '',
      quotaWindows,
      errorKind: '',
      errorDetail: '',
    };
  } catch (error) {
    const result = inspectGrokError(account, error);
    const level =
      result.action === 'delete'
        ? 'error'
        : result.action === 'reauth' || result.action === 'disable'
          ? 'warning'
          : 'info';
    onLog?.(level, `${account.displayAccount} -> ${result.action}：${result.actionReason}`);
    return result;
  }
};
