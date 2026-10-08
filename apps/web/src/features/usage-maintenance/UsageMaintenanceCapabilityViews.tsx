import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconCheck, IconInfo, IconCopy } from '@/components/ui/icons';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import type { UsageMaintenanceStatus } from '@/services/api/usageService';
import { useNotificationStore } from '@/stores';
import { formatDateTime, formatFileSize } from '@/utils/format';
import { resolveProgressPercent } from './usageMaintenanceModel';
import styles from './UsageMaintenanceCapabilityViews.module.scss';

export const COMPACT_BINARY_COMMAND =
  'cpa-manager-plus compact-usage --db-path /path/to/usage.sqlite';

export const COMPACT_USAGE_COMMAND = COMPACT_BINARY_COMMAND;

export const COMPACT_DOCKER_COMPOSE_COMMAND =
  'docker compose stop cpa-manager-plus && \\\n  docker compose run --rm --no-deps cpa-manager-plus compact-usage --db-path /data/usage.sqlite && \\\n  docker compose start cpa-manager-plus';

export const COMPACT_DOCKER_RUN_COMMAND =
  'docker stop cpa-manager-plus && \\\n  docker run --rm -v cpa-manager-plus-data:/data seakee/cpa-manager-plus:latest compact-usage --db-path /data/usage.sqlite && \\\n  docker start cpa-manager-plus';

export const BACKUP_FILES = [
  'usage.sqlite',
  'usage.sqlite-wal',
  'usage.sqlite-shm',
  'data.key',
  'usage-archives/',
] as const;

export type CompactDeploymentType = 'docker-compose' | 'docker-run' | 'binary';

type SharedProps = { maintenance: UsageMaintenanceStatus };

function StatusPill({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <span className={`${styles.pill} ${ready ? styles.success : styles.warning}`}>{children}</span>
  );
}

export function UsageMaintenanceAdvancedView({
  maintenance,
  stale = false,
  onCopyCommand,
}: SharedProps & {
  stale?: boolean;
  onCopyCommand: (command?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [deploymentType, setDeploymentType] = useState<CompactDeploymentType>('docker-compose');
  const [copiedFiles, setCopiedFiles] = useState(false);
  const storage = maintenance.storage;
  const size = (bytes: number) => (stale ? '—' : formatFileSize(bytes));

  const reclaimPercent =
    !stale && storage.total_bytes > 0 && storage.reclaimable_bytes > 0
      ? Math.min(100, Math.round((storage.reclaimable_bytes / storage.total_bytes) * 100))
      : 0;

  const currentCommand =
    deploymentType === 'docker-compose'
      ? COMPACT_DOCKER_COMPOSE_COMMAND
      : deploymentType === 'docker-run'
        ? COMPACT_DOCKER_RUN_COMMAND
        : COMPACT_BINARY_COMMAND;

  const handleCopyFiles = async () => {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(BACKUP_FILES.join(' '));
      setCopiedFiles(true);
      showNotification(
        t('usage_maintenance.advanced_copied_file_list', {
          defaultValue: 'Backup file names copied.',
        }),
        'success'
      );
      setTimeout(() => setCopiedFiles(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className={styles.view}>
      {stale ? (
        <p className={styles.warningNote}>
          {t('usage_maintenance.workspace_cleanup_refresh_failed')}
        </p>
      ) : null}
      <section className={styles.section}>
        <div className={styles.storageTotal}>
          <span>{t('usage_maintenance.sqlite_total')}</span>
          <strong>{size(storage.total_bytes)}</strong>
          <small>{t('usage_maintenance.sqlite_total_hint')}</small>
        </div>
        {!stale && storage.total_bytes > 0 ? (
          <div className={styles.storageBar} aria-hidden="true">
            <div
              className={styles.barDatabase}
              style={{
                width: `${Math.max(2, Math.min(100, (storage.database_bytes / storage.total_bytes) * 100))}%`,
              }}
              title={`${t('usage_maintenance.database')}: ${formatFileSize(storage.database_bytes)}`}
            />
            {storage.wal_bytes > 0 ? (
              <div
                className={styles.barWal}
                style={{
                  width: `${Math.max(1, Math.min(100, (storage.wal_bytes / storage.total_bytes) * 100))}%`,
                }}
                title={`WAL: ${formatFileSize(storage.wal_bytes)}`}
              />
            ) : null}
            {storage.shm_bytes > 0 ? (
              <div
                className={styles.barShm}
                style={{
                  width: `${Math.max(1, Math.min(100, (storage.shm_bytes / storage.total_bytes) * 100))}%`,
                }}
                title={`SHM: ${formatFileSize(storage.shm_bytes)}`}
              />
            ) : null}
          </div>
        ) : null}
        <dl className={styles.storageGrid}>
          <div className={styles.storageGridItem}>
            <dt>
              <span className={`${styles.legendDot} ${styles.dotDatabase}`} />
              {t('usage_maintenance.database')}
            </dt>
            <dd>{size(storage.database_bytes)}</dd>
          </div>
          <div className={styles.storageGridItem}>
            <dt>
              <span className={`${styles.legendDot} ${styles.dotWal}`} />
              WAL
            </dt>
            <dd>{size(storage.wal_bytes)}</dd>
          </div>
          <div className={styles.storageGridItem}>
            <dt>
              <span className={`${styles.legendDot} ${styles.dotShm}`} />
              SHM
            </dt>
            <dd>{size(storage.shm_bytes)}</dd>
          </div>
        </dl>
        <div className={styles.reclaimable}>
          <div className={styles.reclaimableInfo}>
            <span className={styles.reclaimableTitle}>{t('usage_maintenance.reclaimable')}</span>
            {reclaimPercent > 0 ? (
              <span className={styles.reclaimableBadge}>
                {t('usage_maintenance.advanced_reclaim_potential', {
                  percent: reclaimPercent,
                  defaultValue: `~${reclaimPercent}% reclaimable`,
                })}
              </span>
            ) : null}
          </div>
          <strong className={styles.reclaimableSize}>{size(storage.reclaimable_bytes)}</strong>
        </div>
        <div className={styles.sqliteNoteCallout}>
          <IconInfo size={14} className={styles.calloutIcon} />
          <span>{t('usage_maintenance.advanced_sqlite_note')}</span>
        </div>
      </section>

      <section className={styles.section}>
        <h2>{t('usage_maintenance.advanced_compact_title')}</h2>
        <p className={styles.sectionSubtitle}>
          {t('usage_maintenance.advanced_compact_subtitle', {
            defaultValue:
              'Stop the service and run offline compaction to release physical disk space from deleted events.',
          })}
        </p>

        <SegmentedTabs
          idBase="compact-deployment"
          items={[
            {
              id: 'docker-compose',
              label: t('usage_maintenance.advanced_tab_docker_compose', {
                defaultValue: 'Docker Compose',
              }),
            },
            {
              id: 'docker-run',
              label: t('usage_maintenance.advanced_tab_docker_run', {
                defaultValue: 'Docker Run',
              }),
            },
            {
              id: 'binary',
              label: t('usage_maintenance.advanced_tab_binary', {
                defaultValue: 'Native Binary',
              }),
            },
          ]}
          activeTab={deploymentType}
          onChange={setDeploymentType}
          ariaLabel={t('usage_maintenance.advanced_deployment_type', {
            defaultValue: 'Deployment method',
          })}
          className={styles.compactTabs}
        />

        <div className={styles.stepFlow}>
          <div className={styles.stepCard}>
            <div className={styles.stepHeader}>
              <div className={styles.stepTitleWrapper}>
                <span className={styles.stepIndex}>1</span>
                <div className={styles.stepTitleMeta}>
                  <h3 className={styles.stepTitle}>
                    {t('usage_maintenance.advanced_step_backup_title', {
                      defaultValue: 'Step 1: Back up database key files (Recommended)',
                    })}
                  </h3>
                  <span className={styles.stepDesc}>
                    {t('usage_maintenance.advanced_step_backup_desc', {
                      defaultValue:
                        'Compaction is an exclusive write operation. Back up your volume or the following key files before proceeding.',
                    })}
                  </span>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className={styles.copyFileListBtn}
                onClick={handleCopyFiles}
                title={t('usage_maintenance.advanced_copy_file_list', {
                  defaultValue: 'Copy file names',
                })}
              >
                {copiedFiles ? <IconCheck size={13} /> : <IconCopy size={13} />}
                <span>
                  {copiedFiles
                    ? t('common.copied', { defaultValue: 'Copied' })
                    : t('usage_maintenance.advanced_copy_file_list', {
                        defaultValue: 'Copy file names',
                      })}
                </span>
              </Button>
            </div>
            <div className={styles.backupFiles}>
              {BACKUP_FILES.map((item) => (
                <code key={item} className={styles.fileBadge}>
                  {item}
                </code>
              ))}
            </div>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepHeader}>
              <div className={styles.stepTitleWrapper}>
                <span className={styles.stepIndex}>2</span>
                <div className={styles.stepTitleMeta}>
                  <h3 className={styles.stepTitle}>
                    {t('usage_maintenance.advanced_step_compact_title', {
                      defaultValue: 'Step 2: Run offline compaction & restart',
                    })}
                  </h3>
                  <span className={styles.stepDesc}>
                    {deploymentType === 'binary'
                      ? t('usage_maintenance.advanced_stop_binary_hint', {
                          defaultValue:
                            'Ensure all cpa-manager-plus processes are stopped to release the exclusive database lock.',
                        })
                      : t('usage_maintenance.advanced_stop_docker_hint', {
                          defaultValue:
                            'The command automatically stops the container, runs one-off compaction, and restarts it.',
                        })}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.terminalCard}>
              <div className={styles.terminalHeader}>
                <div className={styles.terminalWindowControls}>
                  <span className={`${styles.windowDot} ${styles.dotRed}`} />
                  <span className={`${styles.windowDot} ${styles.dotYellow}`} />
                  <span className={`${styles.windowDot} ${styles.dotGreen}`} />
                  <span className={styles.terminalBadge}>bash</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.copyCommandBtn}
                  onClick={() => onCopyCommand(currentCommand)}
                >
                  <IconCopy size={14} />
                  {t('usage_maintenance.advanced_copy_command', {
                    defaultValue: 'Copy command',
                  })}
                </Button>
              </div>

              <pre className={styles.codeBox}>
                <code>{currentCommand}</code>
              </pre>

              <div className={styles.terminalFooter}>
                <div className={styles.envHint}>
                  <IconInfo size={14} className={styles.envHintIcon} />
                  <span>
                    {deploymentType === 'docker-compose'
                      ? t('usage_maintenance.advanced_note_docker_compose', {
                          defaultValue:
                            'Run in the directory containing your docker-compose.manager.yml or compose file.',
                        })
                      : deploymentType === 'docker-run'
                        ? t('usage_maintenance.advanced_note_docker_run', {
                            defaultValue:
                              'Uses default volume cpa-manager-plus-data; replace -v with your host data path if customized.',
                          })
                        : t('usage_maintenance.advanced_note_binary', {
                            defaultValue:
                              'Replace --db-path with the actual usage.sqlite absolute path; ensure all processes are stopped.',
                          })}
                  </span>
                </div>
                <p className={styles.terminalDisclaimer}>
                  {t('usage_maintenance.advanced_command_note', {
                    defaultValue:
                      'The command is copied for an operator to run offline; the browser never executes it.',
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.retentionCard}`}>
        <h2>{t('usage_maintenance.advanced_retention_title')}</h2>
        <p className={styles.retentionNote}>{t('usage_maintenance.advanced_retention_note')}</p>
      </section>

      <details className={`${styles.technical} ${styles.capabilitiesCard}`}>
        <summary className={styles.capabilitiesSummary}>
          {t('usage_maintenance.advanced_capabilities_title')}
        </summary>
        <dl className={styles.keyValues}>
          <div>
            <dt>{t('usage_maintenance.advanced_service')}</dt>
            <dd>{t('usage_maintenance.advanced_available')}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.advanced_delete_config')}</dt>
            <dd>
              {t(
                maintenance.readiness.archive_delete_enabled ? 'common.enabled' : 'common.disabled'
              )}
            </dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.advanced_offline_compact')}</dt>
            <dd>{t('usage_maintenance.advanced_stop_required')}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.advanced_maintenance_api')}</dt>
            <dd>{t('usage_maintenance.advanced_manager_authorization')}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.advanced_data_exposure')}</dt>
            <dd>{t('usage_maintenance.advanced_sanitized_only')}</dd>
          </div>
        </dl>
        <p className={styles.muted}>{t('usage_maintenance.advanced_auth_note')}</p>
        <h3>{t('usage_maintenance.advanced_unavailable_title')}</h3>
        <ul>
          {['advanced_archive_browse', 'advanced_online_vacuum', 'advanced_failure_detail'].map(
            (key) => (
              <li key={key}>{t(`usage_maintenance.${key}`)}</li>
            )
          )}
        </ul>
        <h3>{t('usage_maintenance.workspace_technical')}</h3>
        <dl className={styles.keyValues}>
          {(['page_size', 'page_count', 'freelist_count'] as const).map((key) => (
            <div key={key}>
              <dt>{t(`usage_maintenance.storage_${key}`, { defaultValue: key })}</dt>
              <dd>{stale ? '—' : storage[key].toLocaleString(i18n.language)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function UsageMaintenanceDiagnosticsView({
  maintenance,
  onOpenActive,
}: SharedProps & { onOpenActive: () => void }) {
  const { t, i18n } = useTranslation();
  const formatTime = (time: number) =>
    time > 0 ? formatDateTime(new Date(time), i18n.language) : '—';
  const migrationComplete =
    maintenance.migration_coverage?.complete ?? maintenance.readiness.migration_ready;
  const aggregateComplete =
    maintenance.hourly_aggregate_coverage?.complete ?? maintenance.readiness.hourly_aggregate_ready;
  const coverageReady = migrationComplete && aggregateComplete;
  const coverages = [
    {
      label: t('usage_maintenance.migration'),
      coverage: maintenance.migration_coverage,
      ready: maintenance.readiness.migration_ready,
      status: t(`usage_maintenance.migration_status_${maintenance.migration.status}`, {
        defaultValue: maintenance.migration.status,
      }),
      updated: maintenance.migration.updated_at_ms,
    },
    {
      label: t('usage_maintenance.hourly_aggregate'),
      coverage: maintenance.hourly_aggregate_coverage,
      ready: maintenance.readiness.hourly_aggregate_ready,
      status: t(`usage_maintenance.aggregate_status_${maintenance.hourly_aggregate.status}`, {
        defaultValue: maintenance.hourly_aggregate.status,
      }),
      updated: maintenance.hourly_aggregate.updated_at_ms,
    },
  ];
  return (
    <div className={styles.view}>
      <div
        className={`${styles.banner} ${coverageReady ? styles.success : styles.warning}`}
        role="status"
      >
        {coverageReady ? <IconCheck size={18} /> : <IconInfo size={18} />}
        <p>
          {t(
            coverageReady
              ? 'usage_maintenance.diagnostics_ready_banner'
              : 'usage_maintenance.diagnostics_pending_banner'
          )}
        </p>
      </div>
      {!maintenance.readiness.archive_delete_enabled ? (
        <p className={styles.warningNote}>{t('usage_maintenance.delete_disabled')}</p>
      ) : null}
      <section className={styles.section}>
        <h2>{t('usage_maintenance.diagnostics_coverage_title')}</h2>
        {coverages.map(({ label, coverage, ready, status, updated }) => {
          const percent = coverage
            ? coverage.complete
              ? 100
              : resolveProgressPercent(coverage.watermark_event_id, coverage.target_event_id)
            : null;
          return (
            <div className={styles.coverage} key={label}>
              <div className={styles.line}>
                <strong>{label}</strong>
                <StatusPill ready={ready}>
                  {t(ready ? 'usage_maintenance.ready' : 'usage_maintenance.pending')}
                </StatusPill>
              </div>
              <div className={styles.line}>
                <span>{status}</span>
                {percent !== null ? <span>{Math.round(percent)}%</span> : null}
              </div>
              {percent !== null ? (
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                >
                  <i style={{ width: `${percent}%` }} />
                </div>
              ) : null}
              <small>
                {t('usage_maintenance.updated_at')} · {formatTime(updated)}
              </small>
            </div>
          );
        })}
        <p className={styles.muted}>{t('usage_maintenance.diagnostics_coverage_note')}</p>
      </section>
      <section className={styles.section}>
        <h2>{t('usage_maintenance.diagnostics_lock_title')}</h2>
        <dl className={styles.keyValues}>
          <div>
            <dt>{t('usage_maintenance.active_task')}</dt>
            <dd>
              {maintenance.active_run
                ? t(`usage_maintenance.run_status_${maintenance.active_run.status}`, {
                    defaultValue: maintenance.active_run.status,
                  })
                : t('usage_maintenance.none')}
            </dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.maintenance_lock')}</dt>
            <dd>
              {maintenance.active_lock
                ? t(`usage_maintenance.operation_${maintenance.active_lock.operation}`, {
                    defaultValue: maintenance.active_lock.operation,
                  })
                : t('usage_maintenance.lock_idle')}
            </dd>
          </div>
          {maintenance.active_lock ? (
            <div>
              <dt>{t('usage_maintenance.diagnostics_lock_updated')}</dt>
              <dd>{formatTime(maintenance.active_lock.updated_at_ms)}</dd>
            </div>
          ) : null}
        </dl>
        {maintenance.active_run ? (
          <Button variant="secondary" size="sm" onClick={onOpenActive}>
            {t('usage_maintenance.open_active_run')}
          </Button>
        ) : null}
      </section>
      <section className={styles.section}>
        <h2>{t('usage_maintenance.diagnostics_readiness_title')}</h2>
        <dl className={styles.keyValues}>
          <div>
            <dt>{t('usage_maintenance.archive_delete_capability')}</dt>
            <dd>
              {t(
                maintenance.readiness.archive_delete_enabled ? 'common.enabled' : 'common.disabled'
              )}
            </dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.advanced_offline_compact')}</dt>
            <dd>{t('usage_maintenance.advanced_stop_required')}</dd>
          </div>
        </dl>
        <p className={styles.muted}>{t('usage_maintenance.delete_batch_recheck_note')}</p>
      </section>
      <details className={styles.technical}>
        <summary>{t('usage_maintenance.workspace_technical')}</summary>
        <dl className={styles.keyValues}>
          <div>
            <dt>{t('usage_maintenance.active_task')}</dt>
            <dd>{maintenance.active_run?.id ?? '—'}</dd>
          </div>
          {maintenance.active_lock ? (
            <div>
              <dt>{t('usage_maintenance.lock_title')}</dt>
              <dd>{maintenance.active_lock.run_id}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('usage_maintenance.raw_events')}</dt>
            <dd>{maintenance.raw_event_count.toLocaleString(i18n.language)}</dd>
          </div>
          <div>
            <dt>{t('usage_maintenance.archived_online')}</dt>
            <dd>{maintenance.raw_archived_event_count?.toLocaleString(i18n.language) ?? '—'}</dd>
          </div>
          {Object.entries(maintenance.migration).map(([key, value]) => (
            <div key={key}>
              <dt>migration.{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
          {Object.entries(maintenance.hourly_aggregate).map(([key, value]) => (
            <div key={key}>
              <dt>hourly_aggregate.{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
          {maintenance.migration_coverage
            ? Object.entries(maintenance.migration_coverage).map(([key, value]) => (
                <div key={key}>
                  <dt>migration_coverage.{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))
            : null}
          {maintenance.hourly_aggregate_coverage
            ? Object.entries(maintenance.hourly_aggregate_coverage).map(([key, value]) => (
                <div key={key}>
                  <dt>hourly_aggregate_coverage.{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))
            : null}
        </dl>
      </details>
      <details className={styles.technical}>
        <summary>{t('usage_maintenance.diagnostics_capabilities_title')}</summary>
        <dl className={styles.keyValues}>
          {['401', '404', '503', '409'].map((code) => (
            <div key={code}>
              <dt>{code}</dt>
              <dd>{t(`usage_maintenance.diagnostics_${code}`)}</dd>
            </div>
          ))}
        </dl>
        <h3>{t('usage_maintenance.diagnostics_empty_title')}</h3>
        <p>
          {t(
            maintenance.raw_event_count === 0
              ? 'usage_maintenance.diagnostics_no_raw'
              : 'usage_maintenance.diagnostics_raw_present'
          )}
        </p>
        <p>{t('usage_maintenance.diagnostics_zero_preview')}</p>
      </details>
    </div>
  );
}
