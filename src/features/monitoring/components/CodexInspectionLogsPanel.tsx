import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import {
  IconChevronDown,
  IconChevronUp,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import { Panel } from '@/features/monitoring/components/CodexInspectionPanels';
import {
  formatTimestamp,
  type InspectionLogEntry,
} from '@/features/monitoring/model/codexInspectionPresentation';
import styles from '../CodexInspectionPage.module.scss';

type CodexInspectionLogsPanelProps = {
  logs: InspectionLogEntry[];
  logsCollapsed: boolean;
  logListRef: RefObject<HTMLDivElement | null>;
  locale: string;
  t: TFunction;
  onJumpToLatest: () => void;
  onClearLogs: () => void;
  onToggleCollapsed: () => void;
};

const levelClassMap: Record<InspectionLogEntry['level'], string> = {
  info: styles.logInfo,
  success: styles.logSuccess,
  warning: styles.logWarning,
  error: styles.logError,
};

export function CodexInspectionLogsPanel({
  logs,
  logsCollapsed,
  logListRef,
  locale,
  t,
  onJumpToLatest,
  onClearLogs,
  onToggleCollapsed,
}: CodexInspectionLogsPanelProps) {
  return (
    <Panel
      title={t('monitoring.codex_inspection_logs_title')}
      subtitle={t('monitoring.codex_inspection_logs_desc')}
      extra={
        <div className={styles.logActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onJumpToLatest}
            disabled={logs.length === 0}
            aria-label={t('monitoring.codex_inspection_logs_jump_latest')}
            title={t('monitoring.codex_inspection_logs_jump_latest')}
          >
            <IconRefreshCw size={14} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClearLogs}
            disabled={logs.length === 0}
            aria-label={t('monitoring.codex_inspection_logs_clear')}
            title={t('monitoring.codex_inspection_logs_clear')}
          >
            <IconTrash2 size={14} />
          </button>
          <button
            type="button"
            className={styles.foldButton}
            onClick={onToggleCollapsed}
            disabled={logs.length === 0}
          >
            {logsCollapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
            <span>
              {logsCollapsed
                ? t('monitoring.codex_inspection_expand_logs')
                : t('monitoring.codex_inspection_fold_logs')}
            </span>
          </button>
        </div>
      }
    >
      {!logsCollapsed ? (
        <div ref={logListRef} className={styles.logList}>
          {logs.length > 0 ? (
            logs.map((entry) => (
              <div key={entry.id} className={`${styles.logRow} ${levelClassMap[entry.level]}`}>
                <span className={styles.logTime}>{formatTimestamp(entry.timestamp, locale)}</span>
                <span className={styles.logMessage}>{entry.message}</span>
              </div>
            ))
          ) : (
            <div className={styles.emptyBlockSmall}>{t('monitoring.codex_inspection_logs_empty')}</div>
          )}
        </div>
      ) : (
        <div className={styles.logCollapsedBar}>
          <span>{t('monitoring.codex_inspection_logs_collapsed', { count: logs.length })}</span>
        </div>
      )}
    </Panel>
  );
}
