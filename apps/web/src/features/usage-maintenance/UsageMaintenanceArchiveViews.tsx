import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconInfo,
  IconArchive,
  IconDatabaseZap,
  IconHardDrive,
  IconSparkles,
  IconSearch,
  IconX,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleHelp,
  IconTriangleAlert,
} from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import type {
  UsageArchiveList,
  UsageArchiveRunSummary,
  UsageArchiveStatus,
  UsageMaintenanceStatus,
} from '@/services/api/usageService';
import { formatDateTime, formatFileSize } from '@/utils/format';
import {
  getArchiveRunAction,
  isArchiveRunCancellable,
  resolveArchiveProgressPresentation,
  type ArchiveHistoryFilter,
  type ArchiveHistorySource,
  type ArchiveRunAction,
  type UsageMaintenanceView,
} from './usageMaintenanceModel';
import type { MaintenanceIntent } from './usageMaintenanceNavigation';
import styles from './UsageMaintenanceArchiveViews.module.scss';

const archiveStatuses = [
  'previewed',
  'archiving',
  'archived',
  'verifying',
  'verified',
  'deleting',
  'completed',
  'failed',
  'cancelled',
] as const;
type Navigate = (view: UsageMaintenanceView) => void;
type Actions = {
  working: boolean;
  onAction: (run: UsageArchiveRunSummary, action: ArchiveRunAction) => void;
  actionDisabled: (run: UsageArchiveRunSummary, action: ArchiveRunAction) => boolean;
  actionTitle: (run: UsageArchiveRunSummary, action: ArchiveRunAction) => string | undefined;
  actionLabel: (run: UsageArchiveRunSummary, action: ArchiveRunAction) => string;
  actionError?: string | null;
};

export function UsageArchiveRunActions({
  run,
  working,
  onAction,
  actionDisabled,
  actionTitle,
  actionLabel,
  compact = false,
  intent = 'archive',
}: Actions & { run: UsageArchiveRunSummary; compact?: boolean; intent?: MaintenanceIntent }) {
  const { t } = useTranslation();
  const action = getArchiveRunAction(run.status);
  return (
    <>
      {!compact && isArchiveRunCancellable(run) ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={working || actionDisabled(run, 'cancel')}
          title={actionTitle(run, 'cancel')}
          onClick={() => onAction(run, 'cancel')}
        >
          {actionLabel(run, 'cancel')}
        </Button>
      ) : null}
      {action ? (
        <Button
          size="sm"
          variant={
            compact || (run.status === 'verified' && intent === 'archive') ? 'ghost' : 'primary'
          }
          disabled={working || actionDisabled(run, action)}
          title={actionTitle(run, action)}
          onClick={() => onAction(run, action)}
        >
          {run.status === 'verified'
            ? t(
                intent === 'cleanup' && !compact
                  ? 'usage_maintenance.continue_cleanup'
                  : 'usage_maintenance.review_cleanup'
              )
            : actionLabel(run, action)}
        </Button>
      ) : null}
    </>
  );
}

export function UsageMaintenanceOverviewView({
  maintenance,
  archives,
  stale = false,
  onNavigate,
  onOpenRun,
}: {
  maintenance: UsageMaintenanceStatus;
  archives: UsageArchiveRunSummary[];
  stale?: boolean;
  onNavigate: Navigate;
  onOpenRun: (run: UsageArchiveRunSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const pending = [maintenance.active_run, ...archives].filter(
    (run, index, all): run is UsageArchiveRunSummary =>
      Boolean(
        run &&
        run.status !== 'verified' &&
        getArchiveRunAction(run.status) &&
        all.findIndex((item) => item?.id === run.id) === index
      )
  );
  const active = pending[0];
  return (
    <div className={styles.view}>
      <dl className={styles.summary}>
        <div className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.iconWrap} ${styles.iconBlue}`} aria-hidden="true">
              <IconDatabaseZap size={18} />
            </div>
            <dt className={styles.cardTitle}>{t('usage_maintenance.raw_events')}</dt>
            <button
              type="button"
              className={styles.infoButton}
              onClick={() => onNavigate('overview')}
              aria-label={t('usage_maintenance.online_range_title')}
              title={t('usage_maintenance.online_range_title')}
            >
              <IconInfo size={14} />
            </button>
          </div>
          <div className={styles.cardBody}>
            <dd className={styles.cardValue}>
              {stale ? '—' : maintenance.raw_event_count.toLocaleString(i18n.language)}
            </dd>
            <small className={styles.cardSub}>
              {t('usage_maintenance.workspace_archived_subset', {
                count: stale
                  ? '—'
                  : (maintenance.raw_archived_event_count?.toLocaleString(i18n.language) ?? '—'),
              })}
            </small>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.iconWrap} ${styles.iconPurple}`} aria-hidden="true">
              <IconArchive size={18} />
            </div>
            <dt className={styles.cardTitle}>{t('usage_maintenance.deleted_events')}</dt>
          </div>
          <div className={styles.cardBody}>
            <dd className={styles.cardValue}>
              {stale ? '—' : maintenance.raw_deleted_event_count.toLocaleString(i18n.language)}
            </dd>
            <small className={styles.cardSub}>
              {t('usage_maintenance.workspace_deleted_hint')}
            </small>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.iconWrap} ${styles.iconCyan}`} aria-hidden="true">
              <IconHardDrive size={18} />
            </div>
            <dt className={styles.cardTitle}>{t('usage_maintenance.sqlite_total')}</dt>
          </div>
          <div className={styles.cardBody}>
            <dd className={styles.cardValue}>
              {stale ? '—' : formatFileSize(maintenance.storage.total_bytes)}
            </dd>
            <small className={styles.cardSub}>{t('usage_maintenance.sqlite_total_hint')}</small>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <div className={`${styles.iconWrap} ${styles.iconGreen}`} aria-hidden="true">
              <IconSparkles size={18} />
            </div>
            <dt className={styles.cardTitle}>{t('usage_maintenance.reclaimable')}</dt>
            <button
              type="button"
              className={styles.actionChip}
              onClick={() => onNavigate('advanced')}
            >
              {t('usage_maintenance.offline_reclaim')}
            </button>
          </div>
          <div className={styles.cardBody}>
            <dd className={styles.cardValue}>
              {stale ? '—' : formatFileSize(maintenance.storage.reclaimable_bytes)}
            </dd>
            <small className={styles.cardSub}>
              {t('usage_maintenance.advanced_sqlite_note_short', {
                defaultValue: '离线收缩可释放磁盘空间',
              })}
            </small>
            {!stale &&
            maintenance.storage.reclaimable_bytes > 50 * 1024 * 1024 &&
            maintenance.storage.total_bytes > 0 ? (
              <div className={styles.reclaimHighlight}>
                <span>
                  {t('usage_maintenance.reclaim_estimated_benefit', {
                    defaultValue:
                      'Compaction recommended: expected to shrink from {{total}} to ~{{compacted}}',
                    total: formatFileSize(maintenance.storage.total_bytes),
                    compacted: formatFileSize(
                      Math.max(
                        0,
                        maintenance.storage.total_bytes - maintenance.storage.reclaimable_bytes
                      )
                    ),
                  })}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </dl>
      {active ? (
        <section
          className={styles.continuation}
          data-failed={active.status === 'failed' || active.has_error}
          aria-label={t('usage_maintenance.workspace_continue')}
        >
          {active.status === 'failed' || active.has_error ? (
            <IconTriangleAlert size={18} />
          ) : (
            <IconClock size={18} />
          )}
          <div>
            <strong>
              {active.status === 'failed' || active.has_error
                ? t('usage_maintenance.run_failed_title', { defaultValue: 'Task Interrupted' })
                : t('usage_maintenance.pending_records', { count: pending.length })}
            </strong>
            <p>
              {t(`usage_maintenance.run_status_${active.status}`, { defaultValue: active.status })}
              {' · '}
              {formatDateTime(new Date(active.created_at_ms), i18n.language)}
            </p>
          </div>
          <Button
            variant={active.status === 'failed' || active.has_error ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => onOpenRun(active)}
          >
            {t('usage_maintenance.workspace_continue_record')}
          </Button>
        </section>
      ) : maintenance.active_lock ? (
        <section className={styles.continuation}>
          <IconClock size={18} />
          <p>{t('usage_maintenance.create_blocked_active')}</p>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('diagnostics')}>
            {t('usage_maintenance.diagnostics_title')}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

type HistoryProps = Actions & {
  archiveList: UsageArchiveList;
  filter: ArchiveHistoryFilter;
  source: ArchiveHistorySource;
  loading: boolean;
  canGoBack: boolean;
  onFilter: (filter: ArchiveHistoryFilter) => void;
  onSource: (source: ArchiveHistorySource) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onOpenRun: (run: UsageArchiveRunSummary) => void;
};

const useCopyId = () => {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  return useCallback(
    async (id: string) => {
      const copied = await copyToClipboard(id);
      showNotification(
        copied
          ? t('usage_maintenance.run_id_copied', { defaultValue: 'Task ID copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );
};

export function UsageArchiveHistoryView({
  archiveList,
  filter,
  source,
  loading,
  canGoBack,
  onFilter,
  onSource,
  onNextPage,
  onPreviousPage,
  onOpenRun,
  ...actions
}: HistoryProps) {
  const { t, i18n } = useTranslation();
  const formatTime = (value?: number) =>
    value ? formatDateTime(new Date(value), i18n.language) : '—';
  const counts = archiveList.status_counts;
  const handleCopyId = useCopyId();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRuns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return archiveList.runs;
    return archiveList.runs.filter((run) => {
      return (
        run.id.toLowerCase().includes(q) ||
        run.mode.toLowerCase().includes(q) ||
        run.status.toLowerCase().includes(q)
      );
    });
  }, [archiveList.runs, searchQuery]);

  return (
    <section className={styles.history} aria-busy={loading}>
      <div className={styles.sectionHeader}>
        <h2>
          <IconArchive size={18} aria-hidden="true" />
          <span>{t('usage_maintenance.archive_records')}</span>
        </h2>
        <div className={styles.filters}>
          <Select
            value={filter}
            ariaLabel={t('usage_maintenance.history_filters')}
            onChange={(value) => onFilter(value as ArchiveHistoryFilter)}
            options={(['all', ...archiveStatuses] as const).map((value) => ({
              value,
              label:
                (value === 'all'
                  ? t('usage_maintenance.history_filter_all')
                  : t(`usage_maintenance.run_status_${value}`)) +
                (counts
                  ? ` (${value === 'all' ? Object.values(counts).reduce((sum, count) => sum + count, 0) : (counts[value] ?? 0)})`
                  : ''),
            }))}
          />
          <Select
            value={source}
            ariaLabel={t('usage_maintenance.source_filter')}
            onChange={(value) => onSource(value as ArchiveHistorySource)}
            options={(['all', 'manual', 'retention'] as const).map((value) => ({
              value,
              label: t(
                value === 'all'
                  ? 'usage_maintenance.source_all'
                  : `usage_maintenance.run_mode_${value}`
              ),
            }))}
          />
          <div className={styles.searchWrap}>
            <IconSearch size={14} className={styles.searchIcon} aria-hidden="true" />
            <input
              type="search"
              className={styles.searchInput}
              placeholder={t('usage_maintenance.search_runs_placeholder', {
                defaultValue: '搜索任务 ID / 状态…',
              })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t('usage_maintenance.search_runs_placeholder', {
                defaultValue: '搜索任务 ID / 状态…',
              })}
            />
            {searchQuery ? (
              <button
                type="button"
                className={styles.searchClearBtn}
                onClick={() => setSearchQuery('')}
                title={t('common.clear', { defaultValue: '清空' })}
                aria-label={t('common.clear', { defaultValue: '清空' })}
              >
                <IconX size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className={styles.tableScroller}>
        <table className={styles.recordTable}>
          <thead>
            <tr>
              <th>{t('usage_maintenance.created_at')}</th>
              <th>{t('usage_maintenance.technical_mode')}</th>
              <th>
                <span className={styles.thWithHelp}>
                  {t('usage_maintenance.cutoff_short', { defaultValue: '归档截止点' })}
                  <span
                    className={styles.helpIcon}
                    title={t('usage_maintenance.resolved_cutoff_hint', {
                      defaultValue: '更早事件进入归档，更新事件继续在线保留。',
                    })}
                    aria-label={t('usage_maintenance.resolved_cutoff_hint', {
                      defaultValue: '更早事件进入归档，更新事件继续在线保留。',
                    })}
                  >
                    <IconCircleHelp size={13} />
                  </span>
                </span>
              </th>
              <th>{t('usage_maintenance.workspace_record_count')}</th>
              <th>{t('usage_maintenance.technical_status')}</th>
              <th>
                <span className={styles.srOnly}>{t('usage_maintenance.record_actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.emptyTable}>
                  {archiveList.runs.length > 0
                    ? t('usage_maintenance.no_matching_runs', {
                        defaultValue: '未找到匹配的任务记录',
                      })
                    : t('usage_maintenance.no_archive_records', {
                        defaultValue: '暂无归档记录',
                      })}
                </td>
              </tr>
            ) : (
              filteredRuns.map((run) => (
                <tr
                  key={run.id}
                  data-run-id={run.id}
                  className={styles.clickableRow}
                  onClick={(e) => {
                    const target = e.target as HTMLElement | null;
                    if (typeof target?.closest === 'function' && target.closest('button, a, input'))
                      return;
                    onOpenRun(run);
                  }}
                >
                  <td data-label={t('usage_maintenance.created_at')}>
                    <div className={styles.identityMeta}>
                      <button
                        className={styles.recordTitle}
                        type="button"
                        onClick={() => onOpenRun(run)}
                      >
                        {formatTime(run.created_at_ms)}
                      </button>
                      <span className={styles.identityHash} title={run.id}>
                        #{run.id.slice(0, 8)}
                        <button
                          type="button"
                          className={styles.copyIdBtn}
                          title={`${t('common.copy')} ID`}
                          aria-label={`${t('common.copy')} ${run.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyId(run.id);
                          }}
                        >
                          <IconCopy size={11} />
                        </button>
                      </span>
                    </div>
                  </td>
                  <td data-label={t('usage_maintenance.technical_mode')}>
                    <span
                      className={`${styles.modeChip} ${run.mode === 'retention' ? styles.modeRetention : styles.modeManual}`}
                    >
                      {t(`usage_maintenance.run_mode_${run.mode}`, { defaultValue: run.mode })}
                    </span>
                  </td>
                  <td data-label={t('usage_maintenance.cutoff')}>
                    <span className={styles.cutoffText}>{formatTime(run.cutoff_timestamp_ms)}</span>
                  </td>
                  <td data-label={t('usage_maintenance.workspace_record_count')}>
                    <div className={styles.metricsStack}>
                      <strong className={styles.numeric}>
                        {run.event_count.toLocaleString(i18n.language)}
                        <span className={styles.numericUnit}>
                          {' '}
                          {t('usage_maintenance.events_suffix', { defaultValue: '条' })}
                        </span>
                      </strong>
                      <div className={styles.metricTags}>
                        {run.deleted_event_count >= run.event_count && run.event_count > 0 ? (
                          <span className={`${styles.metaTag} ${styles.metaTagCleaned}`}>
                            <IconCheck size={11} aria-hidden="true" />
                            {t('usage_maintenance.meta_cleaned_all')}
                          </span>
                        ) : run.deleted_event_count === 0 ? (
                          <span className={`${styles.metaTag} ${styles.metaTagRetained}`}>
                            {t('usage_maintenance.meta_archived_only')}
                          </span>
                        ) : (
                          <span className={`${styles.metaTag} ${styles.metaTagPartial}`}>
                            {t('usage_maintenance.meta_partially_cleaned', {
                              defaultValue: `已清理 ${run.deleted_event_count.toLocaleString(i18n.language)} / ${run.event_count.toLocaleString(i18n.language)}`,
                              deleted: run.deleted_event_count.toLocaleString(i18n.language),
                              total: run.event_count.toLocaleString(i18n.language),
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td data-label={t('usage_maintenance.technical_status')}>
                    <div className={styles.statusStack}>
                      <span className={styles.pill} data-status={run.status}>
                        {t(`usage_maintenance.run_status_${run.status}`, {
                          defaultValue: run.status,
                        })}
                      </span>
                      {run.status === 'verified' || run.status === 'completed' ? (
                        <span className={styles.statusSub}>
                          {t(
                            run.status === 'verified'
                              ? 'usage_maintenance.online_retained'
                              : 'usage_maintenance.archive_retained'
                          )}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={styles.recordActions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpenRun(run)}
                      className={styles.detailBtn}
                    >
                      <span>{t('usage_maintenance.details')}</span>
                      <IconChevronRight size={13} aria-hidden="true" />
                    </Button>
                    <UsageArchiveRunActions run={run} compact {...actions} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {archiveList.runs.length === 0 ? (
        <p className={styles.empty}>
          {loading ? t('common.loading') : t('usage_maintenance.no_runs')}
        </p>
      ) : null}
      <div className={styles.pagination}>
        <div className={styles.paginationInfo}>
          <span>
            {counts
              ? t('usage_maintenance.records_page_summary', {
                  defaultValue: `共 ${Object.values(counts).reduce((s, c) => s + c, 0)} 条记录 · 本页 ${archiveList.runs.length} 条`,
                  total: Object.values(counts).reduce((s, c) => s + c, 0),
                  count: archiveList.runs.length,
                })
              : t('usage_maintenance.records_on_page', { count: archiveList.runs.length })}
          </span>
        </div>
        <div className={styles.paginationControls}>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canGoBack || loading}
            onClick={onPreviousPage}
          >
            <IconChevronLeft size={14} aria-hidden="true" />
            <span>{t('usage_maintenance.pagination_prev')}</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!archiveList.next_cursor || loading}
            onClick={onNextPage}
          >
            <span>{t('usage_maintenance.pagination_next')}</span>
            <IconChevronRight size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}

export function UsageArchiveRunView({
  archive,
  active,
  maintenance,
  intent = 'archive',
  ...actions
}: Actions & {
  archive: UsageArchiveStatus;
  active: boolean;
  maintenance: UsageMaintenanceStatus;
  intent?: MaintenanceIntent;
}) {
  const { t, i18n } = useTranslation();
  const handleCopyId = useCopyId();
  const run = archive.run;
  const formatTime = (value?: number) =>
    value ? formatDateTime(new Date(value), i18n.language) : '—';
  const statusLabel = (value: string) =>
    t(`usage_maintenance.run_status_${value}`, { defaultValue: value });
  const deleting =
    run.status === 'deleting' || run.resume_status === 'deleting' || run.status === 'completed';
  const progress = resolveArchiveProgressPresentation(run);
  const milestones = [
    ['created_at_ms', 'created'],
    ['started_at_ms', 'started'],
    ['archived_at_ms', 'archived'],
    ['verified_at_ms', 'verified'],
    ['delete_started_at_ms', 'delete_started'],
    ['completed_at_ms', 'completed'],
  ] as const;
  const action = getArchiveRunAction(run.status);
  const disabledReason = action ? actions.actionTitle(run, action) : undefined;
  const steps =
    deleting || intent === 'cleanup' ? ['archive', 'verify', 'delete'] : ['archive', 'verify'];
  const stepOrder = deleting
    ? run.status === 'completed'
      ? 4
      : 3
    : run.status === 'verified'
      ? 3
      : run.status === 'verifying' || run.status === 'archived' || run.resume_status === 'verifying'
        ? 2
        : 1;
  return (
    <div className={styles.view}>
      <ol className={styles.stepper} aria-label={t('usage_maintenance.run_steps_label')}>
        {steps.map((step, index) => {
          const isCurrent = stepOrder === index + 1;
          const isFailed = isCurrent && (run.status === 'failed' || run.has_error);
          const isRunning =
            !isFailed &&
            run.status !== 'cancelled' &&
            run.status !== 'completed' &&
            ((step === 'archive' &&
              (run.status === 'archiving' ||
                (Boolean(actions.working) && isCurrent && run.status === 'previewed'))) ||
              (step === 'verify' &&
                (run.status === 'verifying' ||
                  (Boolean(actions.working) && isCurrent && run.status === 'archived'))) ||
              (step === 'delete' &&
                (run.status === 'deleting' ||
                  (Boolean(actions.working) && isCurrent && run.status === 'verified'))));
          return (
            <li
              key={step}
              data-complete={stepOrder > index + 1}
              data-failed={isFailed}
              data-running={isRunning}
              aria-current={
                isCurrent && !isFailed && run.status !== 'cancelled' ? 'step' : undefined
              }
              aria-busy={isRunning ? 'true' : undefined}
            >
              <span>
                {stepOrder > index + 1 ? (
                  <IconCheck size={14} />
                ) : isFailed ? (
                  <IconTriangleAlert size={14} />
                ) : (
                  index + 1
                )}
              </span>
              {t(`usage_maintenance.guided_step_${step}`)}
            </li>
          );
        })}
      </ol>
      {run.status === 'failed' || run.has_error || actions.actionError ? (
        <div className={styles.failedAlert} role="alert">
          <div className={styles.failedAlertHeader}>
            <div className={styles.failedAlertIcon}>
              <IconTriangleAlert size={16} />
            </div>
            <strong className={styles.failedAlertTitle}>
              {t('usage_maintenance.run_failed_alert_title', {
                defaultValue: 'Task Stopped Due to Error',
              })}
            </strong>
          </div>
          <p className={styles.failedAlertDesc}>
            {actions.actionError ||
              t('usage_maintenance.run_failed_alert_desc', {
                defaultValue:
                  'The task encountered an error and was interrupted. You can click "Continue processing" to retry. If it repeatedly fails, the underlying database or storage may have issues. Check technical details below or abandon the task.',
              })}
          </p>
        </div>
      ) : null}
      <dl className={styles.runCounts}>
        <div>
          <dt>{t('usage_maintenance.workspace_record_count')}</dt>
          <dd>{run.event_count.toLocaleString(i18n.language)}</dd>
        </div>
        <div>
          <dt>{t('usage_maintenance.archived_count')}</dt>
          <dd>{run.archived_event_count.toLocaleString(i18n.language)}</dd>
        </div>
        <div>
          <dt>{t('usage_maintenance.deleted_events')}</dt>
          <dd>{run.deleted_event_count.toLocaleString(i18n.language)}</dd>
        </div>
      </dl>
      <p className={styles.scope}>
        <strong>{t('usage_maintenance.cutoff')}</strong>
        <br />
        {formatTime(run.cutoff_timestamp_ms)}
      </p>
      {run.status === 'verified' ? (
        <p className={styles.hint}>{t('usage_maintenance.workspace_existing_scope')}</p>
      ) : null}
      {run.status === 'completed' ? (
        <p className={styles.hint}>{t('usage_maintenance.delete_storage_note')}</p>
      ) : null}
      {run.status === 'failed' ? (
        <p className={styles.warning}>{t('usage_maintenance.resume_detail_note')}</p>
      ) : null}
      {disabledReason ? <p className={styles.warning}>{disabledReason}</p> : null}
      {active || actions.working ? (
        <p className={styles.hint}>{t('usage_maintenance.stop_waiting_note')}</p>
      ) : null}
      <details
        className={styles.executionDetailsCard}
        open={
          active ||
          actions.working ||
          run.status === 'archiving' ||
          run.status === 'verifying' ||
          run.status === 'deleting' ||
          run.status === 'failed' ||
          run.has_error ||
          Boolean(progress)
        }
      >
        <summary className={styles.executionDetailsSummary}>
          <span>{t('usage_maintenance.execution_details')}</span>
          <IconChevronDown size={16} className={styles.chevron} aria-hidden="true" />
        </summary>
        <div className={styles.timeline}>
          {milestones.map(([field, label]) =>
            run[field] ? (
              <div key={field} className={styles.timelineItem} data-status="complete">
                <div className={styles.timelineTrack}>
                  <span className={styles.timelineNode}>
                    <IconCheck size={11} />
                  </span>
                  <div className={styles.timelineLine} />
                </div>
                <div className={styles.timelineContent}>
                  <time>{formatTime(run[field])}</time>
                  <span>{t(`usage_maintenance.milestone_${label}`)}</span>
                </div>
              </div>
            ) : null
          )}
          {progress ? (
            <div
              className={styles.timelineItem}
              data-status={run.status === 'failed' || run.has_error ? 'failed' : 'active'}
            >
              <div className={styles.timelineTrack}>
                <span className={styles.timelineNode}>
                  {run.status === 'failed' || run.has_error ? (
                    <IconTriangleAlert size={12} />
                  ) : (
                    <i className={styles.activeSpinner} aria-hidden="true" />
                  )}
                </span>
                <div className={styles.timelineLine} />
              </div>
              <div className={styles.timelineContent}>
                <div className={styles.timelineSubphaseHeader}>
                  <strong className={styles.subphaseTitle}>
                    {run.status === 'failed' || run.has_error
                      ? `${t('usage_maintenance.progress_interrupted_at')}: `
                      : ''}
                    {t(progress.labelKey)}
                  </strong>
                  {progress.percent !== null ? (
                    <span className={styles.subphasePercent}>
                      {progress.percent.toFixed(1)}%
                    </span>
                  ) : null}
                </div>
                {progress.total > 0 ? (
                  <p className={styles.subphaseCount}>
                    {progress.current.toLocaleString(i18n.language)} /{' '}
                    {progress.total.toLocaleString(i18n.language)}{' '}
                    {t(`usage_maintenance.progress_unit_${progress.unit ?? 'events'}`)}
                  </p>
                ) : null}
                <div
                  className={`${styles.progressTrack} ${progress.percent === null ? styles.progressIndeterminate : ''}`}
                  role="progressbar"
                  aria-label={t(progress.labelKey)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    progress.percent === null ? undefined : Math.round(progress.percent)
                  }
                  aria-busy={progress.percent === null ? true : undefined}
                >
                  <i
                    style={
                      progress.percent === null ? undefined : { width: `${progress.percent}%` }
                    }
                  />
                </div>
                {progress.updatedAtMS ? (
                  <small className={styles.subphaseRecent}>
                    <IconClock size={11} aria-hidden="true" />
                    <span>
                      {t('usage_maintenance.progress_recent')}: {formatTime(progress.updatedAtMS)}
                    </span>
                  </small>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {archive.segments.length > 0 ? (
          <div className={styles.segmentSummarySection}>
            <div className={styles.segmentSummaryHeader}>
              <h3>{t('usage_maintenance.segment_summary')}</h3>
              <span className={styles.segmentTotal}>
                {t('usage_maintenance.segment_total', { count: archive.segments.length })}
              </span>
            </div>
            <div className={styles.segmentList}>
              {archive.segments
                .slice(-20)
                .reverse()
                .map((segment) => (
                  <div key={segment.sequence} className={styles.segmentRow}>
                    <span className={styles.segmentSeq}>#{segment.sequence}</span>
                    <span className={styles.segmentMeta}>
                      {segment.event_count.toLocaleString(i18n.language)}{' '}
                      {t('usage_maintenance.progress_unit_events')} ·{' '}
                      {formatFileSize(segment.compressed_bytes)}
                    </span>
                    <span className={styles.segmentBadge} data-status={segment.status}>
                      {statusLabel(segment.status)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </details>
      <details className={styles.technical}>
        <summary className={styles.technicalSummary}>
          <span>{t('usage_maintenance.workspace_technical')}</span>
          <IconChevronDown size={14} className={styles.chevron} aria-hidden="true" />
        </summary>
        <dl className={styles.keyValues}>
          <div>
            <dt>{t('usage_maintenance.technical_run_id')}</dt>
            <dd className={styles.mono}>
              <span>{run.id}</span>
              <button
                type="button"
                className={styles.copyIdBtn}
                title={`${t('common.copy')} ID`}
                aria-label={`${t('common.copy')} ${run.id}`}
                onClick={() => void handleCopyId(run.id)}
              >
                <IconCopy size={12} />
              </button>
            </dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.technical_mode')}</dt>
            <dd>{t(`usage_maintenance.run_mode_${run.mode}`, { defaultValue: run.mode })}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.technical_resume_status')}</dt>
            <dd>{run.resume_status ? statusLabel(run.resume_status) : '—'}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.preview_target_event')}</dt>
            <dd>{run.target_event_id.toLocaleString(i18n.language)}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.uncompressed_size')}</dt>
            <dd>{formatFileSize(run.archived_uncompressed_bytes)}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.compressed_size')}</dt>
            <dd>{formatFileSize(run.archived_compressed_bytes)}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.verified_at')}</dt>
            <dd>{formatTime(run.verified_at_ms)}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.updated_at')}</dt>
            <dd>{formatTime(run.updated_at_ms)}</dd>
          </div>
          {maintenance.active_lock ? (
            <div>
              <dt>{t('usage_maintenance.lock_title')}</dt>
              <dd>
                {t(`usage_maintenance.operation_${maintenance.active_lock.operation}`, {
                  defaultValue: maintenance.active_lock.operation,
                })}{' '}
                · {maintenance.active_lock.run_id}
              </dd>
            </div>
          ) : null}
        </dl>
        <h3>{t('usage_maintenance.segment_summary')}</h3>
        {archive.segments
          .slice(-20)
          .reverse()
          .map((segment) => (
            <details className={styles.segment} key={segment.sequence}>
              <summary>
                #{segment.sequence} · {statusLabel(segment.status)} ·{' '}
                {segment.event_count.toLocaleString(i18n.language)}
              </summary>
              <dl className={styles.keyValues}>
                <div>
                  <dt>{t('usage_maintenance.technical_event_ids')}</dt>
                  <dd>
                    {segment.first_event_id.toLocaleString(i18n.language)} –{' '}
                    {segment.last_event_id.toLocaleString(i18n.language)}
                  </dd>
                </div>
                <div>
                  <dt>{t('usage_maintenance.preview_range')}</dt>
                  <dd>
                    {formatTime(segment.min_timestamp_ms)} – {formatTime(segment.max_timestamp_ms)}
                  </dd>
                </div>
                <div>
                  <dt>{t('usage_maintenance.uncompressed_size')}</dt>
                  <dd>{formatFileSize(segment.uncompressed_bytes)}</dd>
                </div>
                <div>
                  <dt>{t('usage_maintenance.compressed_size')}</dt>
                  <dd>{formatFileSize(segment.compressed_bytes)}</dd>
                </div>
                <div>
                  <dt>{t('usage_maintenance.verified_at')}</dt>
                  <dd>{formatTime(segment.verified_at_ms)}</dd>
                </div>
              </dl>
            </details>
          ))}
        {archive.segments.length === 0 ? (
          <p className={styles.hint}>{t('usage_maintenance.no_segments')}</p>
        ) : null}
      </details>
    </div>
  );
}
