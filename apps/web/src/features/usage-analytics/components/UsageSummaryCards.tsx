import { useId, type CSSProperties, type ComponentType } from 'react';
import {
  IconArrowDownToLine,
  IconArrowUpFromLine,
  IconBinary,
  IconCheck,
  IconDatabaseZap,
  IconDollarSign,
  IconFileText,
  IconInbox,
  IconKey,
  IconModelCluster,
  IconShield,
  IconTimer,
  IconTrendingUp,
  IconX,
  type IconProps,
} from '@/components/ui/icons';
import type {
  UsageSummaryCard,
  UsageSummaryCardAccent,
  UsageSummaryCardIcon,
} from '../usageAnalyticsPresentation';
import styles from '../UsageAnalyticsPage.module.scss';

const summaryIconMap: Record<UsageSummaryCardIcon, ComponentType<IconProps>> = {
  anomaly: IconShield,
  cache: IconDatabaseZap,
  calls: IconInbox,
  cost: IconDollarSign,
  credential: IconFileText,
  failure: IconX,
  input: IconArrowDownToLine,
  key: IconKey,
  latency: IconTimer,
  model: IconModelCluster,
  output: IconArrowUpFromLine,
  success: IconCheck,
  tokens: IconBinary,
  trend: IconTrendingUp,
};

const summaryAccentClassMap: Record<UsageSummaryCardAccent, string> = {
  amber: styles.summaryAccentAmber,
  blue: styles.summaryAccentBlue,
  cyan: styles.summaryAccentCyan,
  green: styles.summaryAccentGreen,
  red: styles.summaryAccentRed,
  teal: styles.summaryAccentTeal,
};

function UsageSummaryCardView({
  accent = 'blue',
  fullLabel,
  icon,
  label,
  meta,
  tone,
  value,
  valueTitle,
  variant = 'primary',
}: UsageSummaryCard) {
  const Icon = icon ? summaryIconMap[icon] : null;
  const tooltipId = useId();
  const resolvedLabel = fullLabel ?? label;
  const tooltipValue = valueTitle ?? value;
  const hasValueTooltip = tooltipValue !== value;
  const cardClassName = [
    styles.usageSummaryCard,
    variant === 'secondary' ? styles.usageSummaryCardSecondary : styles.usageSummaryCardPrimary,
    summaryAccentClassMap[accent],
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClassName}>
      <div className={styles.usageSummaryCardHeader}>
        {Icon ? (
          <span className={styles.usageSummaryIcon}>
            <Icon size={20} />
          </span>
        ) : null}
        <span className={styles.usageSummaryLabel} title={resolvedLabel}>
          {label}
        </span>
      </div>
      <div className={styles.usageSummaryCardBody}>
        <span className={styles.usageSummaryValueWrap}>
          <strong
            className={`${styles.usageSummaryValue} ${tone ? styles[`tone${tone}`] : ''}`}
            tabIndex={hasValueTooltip ? 0 : undefined}
            aria-describedby={hasValueTooltip ? tooltipId : undefined}
          >
            {value}
          </strong>
          {hasValueTooltip ? (
            <span id={tooltipId} className={styles.usageSummaryValueTooltip} role="tooltip">
              <span className={styles.usageSummaryValueTooltipLabel}>{resolvedLabel}</span>
              <span className={styles.usageSummaryValueTooltipValue}>{tooltipValue}</span>
            </span>
          ) : null}
        </span>
        <span className={styles.usageSummaryMeta} title={meta}>
          {meta}
        </span>
      </div>
      <div className={styles.usageSummaryCardChart} aria-hidden="true">
        <svg viewBox="0 0 100 30" preserveAspectRatio="none">
          <path d="M0,25 Q15,5 30,20 T60,10 T100,25" />
        </svg>
      </div>
    </div>
  );
}

export function UsageSummarySection({ cards }: { cards: UsageSummaryCard[] }) {
  return (
    <section className={styles.usageSummarySection}>
      <div
        className={styles.usageSummaryGrid}
        style={{ '--usage-summary-columns': Math.min(cards.length, 8) } as CSSProperties}
      >
        {cards.map((card) => (
          <UsageSummaryCardView key={`${card.label}-${card.value}`} {...card} />
        ))}
      </div>
    </section>
  );
}
