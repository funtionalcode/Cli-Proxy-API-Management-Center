import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '@/features/aiProviders/AiProvidersPage.module.scss';

type OpenAIKeyTestStatus = 'idle' | 'loading' | 'success' | 'error';

interface OpenAIKeyTestStatusIndicatorProps {
  status: OpenAIKeyTestStatus;
  message?: string;
}

function StatusLoadingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.statusIconSpin}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M8 1A7 7 0 0 1 8 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusSuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="var(--success-color, #22c55e)" />
      <path
        d="M4.5 8L7 10.5L11.5 6"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="var(--danger-color, #f56c6c)" />
      <path
        d="M5 5L11 11M11 5L5 11"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIdleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--text-tertiary, #9ca3af)" strokeWidth="2" />
    </svg>
  );
}

function StatusIcon({ status }: { status: OpenAIKeyTestStatus }) {
  switch (status) {
    case 'loading':
      return <StatusLoadingIcon />;
    case 'success':
      return <StatusSuccessIcon />;
    case 'error':
      return <StatusErrorIcon />;
    default:
      return <StatusIdleIcon />;
  }
}

export function OpenAIKeyTestStatusIndicator({
  status,
  message,
}: OpenAIKeyTestStatusIndicatorProps) {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  const trimmedMessage = String(message ?? '').trim();
  const resolvedMessage = trimmedMessage || t('ai_providers.openai_test_failed');
  const hasTooltip = status === 'error' && Boolean(resolvedMessage);

  const ariaLabel =
    status === 'error'
      ? resolvedMessage
      : status === 'success'
        ? t('ai_providers.openai_test_success')
        : status === 'loading'
          ? t('ai_providers.openai_test_running')
          : 'Idle';

  return (
    <span
      className={`${styles.keyStatusTrigger} ${hasTooltip ? styles.keyStatusTriggerInteractive : ''}`}
      tabIndex={hasTooltip ? 0 : -1}
      aria-label={ariaLabel}
      aria-describedby={hasTooltip && open ? tooltipId : undefined}
      onMouseEnter={hasTooltip ? () => setOpen(true) : undefined}
      onMouseLeave={hasTooltip ? () => setOpen(false) : undefined}
      onFocus={hasTooltip ? () => setOpen(true) : undefined}
      onBlur={hasTooltip ? () => setOpen(false) : undefined}
    >
      <StatusIcon status={status} />
      {hasTooltip && open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={`${styles.statusTooltip} ${styles.keyStatusTooltip}`}
        >
          <span className={styles.keyStatusTooltipText}>{resolvedMessage}</span>
        </span>
      ) : null}
    </span>
  );
}
