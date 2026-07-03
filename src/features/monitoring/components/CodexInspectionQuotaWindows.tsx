import type { TFunction } from 'i18next';
import { formatPercent } from '@/features/monitoring/model/codexInspectionPresentation';
import styles from '../CodexInspectionPage.module.scss';

export type CodexInspectionQuotaWindowView = {
  id: string;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetLabel?: string;
};

type CodexInspectionQuotaWindowsProps = {
  windows?: readonly CodexInspectionQuotaWindowView[] | null;
  fallbackUsedPercent?: number | null;
  t: TFunction;
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const normalizePercent = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? clampPercent(value) : null;

const getQuotaFillClass = (remainingPercent: number | null) => {
  if (remainingPercent === null) return styles.quotaWindowBarFillMedium;
  if (remainingPercent >= 70) return styles.quotaWindowBarFillHigh;
  if (remainingPercent >= 30) return styles.quotaWindowBarFillMedium;
  return styles.quotaWindowBarFillLow;
};

const formatQuotaLabel = (window: CodexInspectionQuotaWindowView, t: TFunction) =>
  t(window.labelKey, window.labelParams ?? {});

export function CodexInspectionQuotaWindows({
  windows,
  fallbackUsedPercent,
  t,
}: CodexInspectionQuotaWindowsProps) {
  const rows =
    windows && windows.length > 0
      ? windows.map((window) => ({
          id: window.id,
          label: formatQuotaLabel(window, t),
          resetLabel: window.resetLabel,
          usedPercent: window.usedPercent ?? null,
        }))
      : [
          {
            id: 'overall',
            label: t('monitoring.codex_inspection_used_percent'),
            resetLabel: '',
            usedPercent: fallbackUsedPercent ?? null,
          },
        ];

  return (
    <div className={styles.quotaWindowList}>
      {rows.map((row) => {
        const usedPercent = normalizePercent(row.usedPercent);
        const remainingPercent =
          usedPercent === null ? null : clampPercent(100 - usedPercent);
        const resetLabel =
          row.resetLabel && row.resetLabel !== '-'
            ? t('monitoring.codex_inspection_quota_reset', { time: row.resetLabel })
            : '';

        return (
          <div key={row.id} className={styles.quotaWindowRow}>
            <div className={styles.quotaWindowHeader}>
              <span className={styles.quotaWindowLabel}>{row.label}</span>
              <span className={styles.quotaWindowValue}>
                {t('monitoring.codex_inspection_quota_used', {
                  percent: formatPercent(usedPercent),
                })}
              </span>
            </div>
            <div className={styles.quotaWindowBar} aria-hidden="true">
              <span
                className={`${styles.quotaWindowBarFill} ${getQuotaFillClass(remainingPercent)}`}
                style={{ width: `${Math.round(remainingPercent ?? 0)}%` }}
              />
            </div>
            {resetLabel ? <span className={styles.quotaWindowReset}>{resetLabel}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
