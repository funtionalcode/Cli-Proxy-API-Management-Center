import { type JSX, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureDetailsTooltip } from '@/features/monitoring/components/FailureDetailsTooltip';
import { buildAccountLatestRequestFailureDetails } from '@/features/accounts/model/accountLatestRequest';
import type { MonitoringAccountLatestRequest } from '@/services/api/usageService';
import { AccountRequestTimeTooltip } from './AccountRequestTimeTooltip';
import styles from './AccountLatestRequest.module.scss';

type AccountLatestRequestProps = {
  latestRequest?: MonitoringAccountLatestRequest | null;
  recentRequests?: MonitoringAccountLatestRequest[];
  loading?: boolean;
  unavailable?: boolean;
  locale?: string;
  className?: string;
  onCopy: (text: string) => void;
};

const STATUS_SLOT_MIN = 5;
const STATUS_SLOT_MAX = 10;
const STATUS_BAR_WIDTH = 5;
const STATUS_BAR_GAP = 4;

const resolveStatusSlotCount = (timeWidth: number): number => {
  if (!Number.isFinite(timeWidth) || timeWidth <= 0) return STATUS_SLOT_MIN;
  const availableSlots = Math.floor(
    (timeWidth + STATUS_BAR_GAP) / (STATUS_BAR_WIDTH + STATUS_BAR_GAP)
  );
  return Math.min(STATUS_SLOT_MAX, Math.max(STATUS_SLOT_MIN, availableSlots));
};

const padTimePart = (value: number) => String(value).padStart(2, '0');

const formatRequestTime = (timestamp: number, format: 'short' | 'full'): string | null => {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const datePart = `${date.getFullYear()}/${padTimePart(date.getMonth() + 1)}/${padTimePart(date.getDate())}`;
  const timePart = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}:${padTimePart(date.getSeconds())}`;
  return format === 'full' ? `${datePart} ${timePart}` : `${datePart.slice(5)} ${timePart}`;
};

export function AccountLatestRequest({
  latestRequest,
  recentRequests,
  loading = false,
  unavailable = false,
  className,
  onCopy,
}: AccountLatestRequestProps): JSX.Element {
  const { t } = useTranslation();
  const timeRef = useRef<HTMLTimeElement | null>(null);
  const [statusSlotCount, setStatusSlotCount] = useState(STATUS_SLOT_MIN);
  const requestHistory =
    recentRequests && recentRequests.length > 0
      ? recentRequests
      : latestRequest
        ? [latestRequest]
        : [];
  const newestRequest = requestHistory[0] ?? latestRequest ?? null;
  const visibleRequests =
    loading || unavailable ? [] : requestHistory.slice(0, statusSlotCount).reverse();
  const statusSlots: Array<MonitoringAccountLatestRequest | null> = [
    ...Array.from({ length: statusSlotCount - visibleRequests.length }, () => null),
    ...visibleRequests,
  ];
  const statusSummary = unavailable
    ? t('accounts.latest_request_unavailable')
    : loading
      ? t('accounts.latest_request_loading')
      : visibleRequests.length === 0
        ? t('accounts.latest_request_empty')
        : visibleRequests
            .map((request) =>
              t(request.failed ? 'monitoring.result_failed' : 'monitoring.result_success')
            )
            .join(' · ');
  const timestamp = newestRequest?.timestamp_ms;
  const shortTimestamp =
    typeof timestamp === 'number' ? formatRequestTime(timestamp, 'short') : null;
  const fullTimestamp = typeof timestamp === 'number' ? formatRequestTime(timestamp, 'full') : null;
  const timestampISO =
    fullTimestamp && typeof timestamp === 'number' ? new Date(timestamp).toISOString() : undefined;
  const timeFallbackLabel = t('accounts.latest_request_time_title');
  const timeTooltipValue = fullTimestamp ?? '-';
  const timeAriaLabel = `${timeFallbackLabel}: ${timeTooltipValue}`;

  useLayoutEffect(() => {
    const timeElement = timeRef.current;
    if (!timeElement) return undefined;

    const updateStatusSlotCount = () => {
      const nextCount = resolveStatusSlotCount(timeElement.getBoundingClientRect().width);
      setStatusSlotCount((currentCount) => (currentCount === nextCount ? currentCount : nextCount));
    };

    updateStatusSlotCount();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateStatusSlotCount);
      observer.observe(timeElement);
      return () => observer.disconnect();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateStatusSlotCount);
      return () => window.removeEventListener('resize', updateStatusSlotCount);
    }

    return undefined;
  }, [shortTimestamp]);

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <AccountRequestTimeTooltip
        label={timeFallbackLabel}
        value={timeTooltipValue}
        ariaLabel={timeAriaLabel}
      >
        <time
          ref={timeRef}
          className={styles.time}
          dateTime={timestampISO}
          data-account-request-time="true"
        >
          <span className={styles.timeValue}>{shortTimestamp ?? '-'}</span>
        </time>
      </AccountRequestTimeTooltip>
      <span
        className={styles.statusTrack}
        style={{ gridTemplateColumns: `repeat(${statusSlotCount}, minmax(0, 1fr))` }}
        aria-label={statusSummary}
        data-account-request-status-track="true"
        data-account-request-status-slot-count={statusSlotCount}
      >
        {statusSlots.map((request, index) => {
          if (!request) {
            return (
              <span key={`empty-${index}`} className={styles.statusSlot}>
                <span
                  className={`${styles.statusBar} ${styles.statusBarEmpty}`}
                  data-request-status="empty"
                  aria-hidden="true"
                />
              </span>
            );
          }

          if (!request.failed) {
            return (
              <span key={`${request.timestamp_ms}-${index}`} className={styles.statusSlot}>
                <span
                  className={`${styles.statusBar} ${styles.statusBarSuccess}`}
                  data-request-status="success"
                  role="img"
                  aria-label={t('monitoring.result_success')}
                  title={t('monitoring.result_success')}
                />
              </span>
            );
          }

          const failureDetails = buildAccountLatestRequestFailureDetails(request, t);
          if (!failureDetails) {
            return (
              <span key={`${request.timestamp_ms}-${index}`} className={styles.statusSlot}>
                <span
                  className={`${styles.statusBar} ${styles.statusBarFailed}`}
                  data-request-status="failed"
                  role="img"
                  aria-label={t('monitoring.result_failed')}
                  title={t('monitoring.result_failed')}
                />
              </span>
            );
          }
          return (
            <span key={`${request.timestamp_ms}-${index}`} className={styles.statusSlot}>
              <FailureDetailsTooltip
                ariaLabel={failureDetails.ariaLabel}
                statusText={failureDetails.statusText}
                detailLines={failureDetails.detailLines}
                copyText={failureDetails.copyText}
                copyLabel={t('accounts.latest_request_copy_details')}
                onCopy={onCopy}
              >
                <span
                  className={`${styles.statusBar} ${styles.statusBarFailed}`}
                  data-request-status="failed"
                  aria-hidden="true"
                />
              </FailureDetailsTooltip>
            </span>
          );
        })}
      </span>
    </div>
  );
}
