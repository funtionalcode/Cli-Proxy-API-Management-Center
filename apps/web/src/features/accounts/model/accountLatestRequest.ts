import type { TFunction } from 'i18next';
import type { MonitoringAccountLatestRequest } from '@/services/api/usageService';
import { maskSensitiveText, truncateText } from '@/utils/format';

export interface AccountLatestRequestFailureDetails {
  ariaLabel: string;
  statusText: string;
  detailLines: string[];
  copyText: string;
}

const readSafeText = (value: string | null | undefined) => {
  const text = maskSensitiveText(String(value ?? '').trim());
  return text.trim();
};

export const buildAccountLatestRequestFailureDetails = (
  request: MonitoringAccountLatestRequest,
  t: TFunction
): AccountLatestRequestFailureDetails | null => {
  if (!request.failed) return null;

  const statusCode =
    typeof request.fail_status_code === 'number' && Number.isFinite(request.fail_status_code)
      ? Math.round(request.fail_status_code)
      : null;
  const statusText =
    statusCode !== null
      ? `${t('monitoring.fail_status_code_short', { defaultValue: 'HTTP' })} ${statusCode}`
      : t('monitoring.result_failed');
  const summary = readSafeText(request.fail_summary);
  const errorKind = readSafeText(request.header_error_kind);
  const errorCode = readSafeText(request.header_error_code);
  const traceId = readSafeText(request.header_trace_id);
  const detailLines = [
    summary,
    errorKind || errorCode
      ? `${t('monitoring.header_error')}: ${[errorKind, errorCode].filter(Boolean).join(' / ')}`
      : '',
    traceId ? `${t('monitoring.header_trace')}: ${traceId}` : '',
  ].filter(Boolean);

  if (detailLines.length === 0) return null;

  return {
    statusText,
    detailLines,
    copyText: [statusText, ...detailLines].join('\n'),
    ariaLabel: [
      t('monitoring.result_failed'),
      statusText,
      truncateText(summary, 96),
      truncateText(errorKind || errorCode, 48),
    ]
      .filter(Boolean)
      .join(' · '),
  };
};
