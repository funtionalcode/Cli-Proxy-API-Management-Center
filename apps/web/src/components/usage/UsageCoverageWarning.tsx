import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import type { MonitoringAnalyticsCoverage } from '@/services/api/usageService';
import styles from './UsageCoverageWarning.module.scss';

export const USAGE_COVERAGE_WARNING_DISMISSED_KEY = 'usage.coverage_warning_dismissed';

interface UsageCoverageWarningProps {
  coverage?: MonitoringAnalyticsCoverage;
  t: TFunction;
  dismissible?: boolean;
  storageKey?: string;
  onDismiss?: () => void;
}

export function UsageCoverageWarning({
  coverage,
  t,
  dismissible = true,
  storageKey = USAGE_COVERAGE_WARNING_DISMISSED_KEY,
  onDismiss,
}: UsageCoverageWarningProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissible || typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(storageKey, 'true');
      } catch (error) {
        console.error(`Error setting localStorage key "${storageKey}":`, error);
      }
    }
    onDismiss?.();
  }, [storageKey, onDismiss]);

  const currentDeleted = coverage?.raw_deleted_event_count ?? 0;
  const comparisonDeleted = coverage?.comparison_raw_deleted_event_count ?? 0;
  const auxiliaryRanges = (coverage?.auxiliary_ranges ?? []).filter(
    (range) => range.raw_deleted_event_count > 0
  );
  const auxiliaryDeleted = auxiliaryRanges.reduce(
    (total, range) => total + range.raw_deleted_event_count,
    0
  );
  if (dismissed || !coverage || currentDeleted + comparisonDeleted + auxiliaryDeleted <= 0) {
    return null;
  }

  const hasLimitations = coverage.fidelity_limitations.length > 0;
  return (
    <section
      className={styles.notice}
      role="status"
      aria-live="polite"
      data-coverage-mode={coverage.mode}
    >
      <div className={styles.body}>
        <strong>{t('monitoring.coverage_warning_title')}</strong>
        {currentDeleted > 0 ? (
          <span>{t('monitoring.coverage_warning_current', { deleted: currentDeleted })}</span>
        ) : null}
        {comparisonDeleted > 0 ? (
          <span>{t('monitoring.coverage_warning_comparison', { deleted: comparisonDeleted })}</span>
        ) : null}
        {auxiliaryRanges.map((range) => {
          const translationKey =
            range.scope === 'rolling_30m'
              ? 'monitoring.coverage_warning_rolling'
              : range.scope === 'drilldown_preview'
                ? 'monitoring.coverage_warning_drilldown'
                : 'monitoring.coverage_warning_auxiliary';
          return (
            <span key={`${range.scope}:${range.from_ms}:${range.to_ms}`}>
              {t(translationKey, { deleted: range.raw_deleted_event_count })}
            </span>
          );
        })}
        <span>
          {t(
            hasLimitations
              ? 'monitoring.coverage_warning_limited'
              : 'monitoring.coverage_warning_derived'
          )}
        </span>
      </div>
      {dismissible ? (
        <div className={styles.actions}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.dismissButton}
            onClick={handleDismiss}
          >
            {t('monitoring.coverage_warning_dismiss', {
              defaultValue: '我知道了，不再显示',
            })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
