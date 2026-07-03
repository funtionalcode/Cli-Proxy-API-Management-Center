import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  IconChartLine,
  IconCheck,
  IconExternalLink,
  IconInbox,
  IconRefreshCw,
  IconShield,
  IconTrash2,
  type IconProps,
} from '@/components/ui/icons';
import { type CodexInspectionProgressSnapshot } from '@/features/monitoring/codexInspection';
import { CodexInspectionConfigOverview } from '@/features/monitoring/components/CodexInspectionConfigOverview';
import {
  type ConfigOverviewItem,
  type RunStatus,
  type StatusTone,
  type SummaryCard,
} from '@/features/monitoring/model/codexInspectionPresentation';
import styles from '../CodexInspectionPage.module.scss';

const summaryIconMap: Record<NonNullable<SummaryCard['icon']>, ComponentType<IconProps>> = {
  probe: IconInbox,
  sampled: IconChartLine,
  delete: IconTrash2,
  disable: IconShield,
  enable: IconCheck,
  reauth: IconRefreshCw,
};

const summaryAccentClassMap: Record<NonNullable<SummaryCard['accent']>, string> = {
  blue: styles.summaryAccentBlue,
  cyan: styles.summaryAccentCyan,
  red: styles.summaryAccentRed,
  amber: styles.summaryAccentAmber,
  green: styles.summaryAccentGreen,
  violet: styles.summaryAccentViolet,
};

type CodexInspectionStatusPanelProps = {
  statusTone: StatusTone;
  statusLabel: string;
  lastFinishedLabel: string | null;
  pendingActionCount: number;
  summaryCards: SummaryCard[];
  progress: CodexInspectionProgressSnapshot;
  progressLabel: string;
  showProgressBar: boolean;
  runStatus: RunStatus;
  runButtonLabel: string;
  executing: boolean;
  isInspectionInFlight: boolean;
  runDisabled: boolean;
  configOverviewItems: ConfigOverviewItem[];
  configOverviewTitle: string;
  configOverviewEditLabel: string;
  t: TFunction;
  onEditConfig: (field?: string) => void;
  onRunInspection: () => void;
  onPauseInspection: () => void;
  onStopInspection: () => void;
};

export function CodexInspectionStatusPanel({
  statusTone,
  statusLabel,
  lastFinishedLabel,
  pendingActionCount,
  summaryCards,
  progress,
  progressLabel,
  showProgressBar,
  runStatus,
  runButtonLabel,
  executing,
  isInspectionInFlight,
  runDisabled,
  configOverviewItems,
  configOverviewTitle,
  configOverviewEditLabel,
  t,
  onEditConfig,
  onRunInspection,
  onPauseInspection,
  onStopInspection,
}: CodexInspectionStatusPanelProps) {
  return (
    <>
      <Card className={`${styles.panel} ${styles.statusPanel}`}>
        <div className={styles.statusBar}>
          <div className={styles.statusInfo}>
            <span className={`${styles.statusBadge} ${styles[`tone-${statusTone}`]}`}>
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLabel}
            </span>
            <div className={styles.statusMeta}>
              {lastFinishedLabel ? <span>{lastFinishedLabel}</span> : null}
              {pendingActionCount > 0 ? (
                <span
                  className={styles.statusMetaWarn}
                >{`${t('monitoring.codex_inspection_pending_total')} ${pendingActionCount}`}</span>
              ) : null}
            </div>
          </div>

          <div className={styles.statusActions}>
            <Link to="/auth-files" className={styles.quickLink}>
              <IconExternalLink size={14} />
              <span>{t('monitoring.codex_inspection_back')}</span>
            </Link>
            <Button
              variant="primary"
              onClick={onRunInspection}
              loading={runStatus === 'running'}
              disabled={runDisabled}
            >
              {runButtonLabel}
            </Button>
            {isInspectionInFlight ? (
              <>
                <Button
                  variant="secondary"
                  onClick={onPauseInspection}
                  disabled={runStatus !== 'running' || executing}
                >
                  {t('monitoring.codex_inspection_pause')}
                </Button>
                <Button variant="danger" onClick={onStopInspection} disabled={executing}>
                  {t('monitoring.codex_inspection_stop')}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {showProgressBar ? (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <strong>{t('monitoring.codex_inspection_progress_title')}</strong>
              <span>{`${progress.percent}%`}</span>
            </div>
            <div className={styles.progressTrack}>
              <span
                className={styles.progressBar}
                style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>{progressLabel}</span>
              {runStatus === 'paused' ? <strong>{t('monitoring.codex_inspection_paused')}</strong> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <CodexInspectionConfigOverview
        title={configOverviewTitle}
        editLabel={configOverviewEditLabel}
        items={configOverviewItems}
        onEdit={onEditConfig}
      />

      <div className={styles.summaryShell}>
        <section className={styles.summaryGrid}>
          {summaryCards.map((card) => {
            const SummaryIcon = card.icon ? summaryIconMap[card.icon] : null;
            return (
              <div
                key={card.key}
                className={[
                  styles.summaryCard,
                  card.accent ? summaryAccentClassMap[card.accent] : '',
                  card.tone ? styles[`tone-${card.tone}`] : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.summaryHeader}>
                  {SummaryIcon ? (
                    <span className={styles.summaryIcon}>
                      <SummaryIcon size={18} />
                    </span>
                  ) : null}
                  <span className={styles.summaryLabel} title={card.label}>
                    {card.label}
                  </span>
                </div>
                <div className={styles.summaryBody}>
                  <strong className={styles.summaryValue}>{card.value}</strong>
                  <span className={styles.summaryMeta} title={card.meta}>
                    {card.meta}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
