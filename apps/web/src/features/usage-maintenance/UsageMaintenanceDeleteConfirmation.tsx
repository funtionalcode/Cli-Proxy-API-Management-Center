import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  IconCalendar,
  IconCheck,
  IconCopy,
  IconShieldCheck,
  IconTriangleAlert,
} from '@/components/ui/icons';
import type { UsageArchiveRunSummary } from '@/services/api/usageService';
import { formatDateTime } from '@/utils/format';
import styles from './UsageMaintenanceDeleteConfirmation.module.scss';

type Props = {
  run: UsageArchiveRunSummary;
  deletionEnabled: boolean;
  acknowledged?: boolean;
  onToggleAcknowledged?: (value: boolean) => void;
};

export function UsageMaintenanceDeleteConfirmation({
  run,
  deletionEnabled,
  acknowledged,
  onToggleAcknowledged,
}: Props) {
  const { t, i18n } = useTranslation();
  const [copiedId, setCopiedId] = useState(false);
  const remainingEventCount = Math.max(0, run.event_count - run.deleted_event_count);
  const verified =
    run.status === 'verified' ||
    run.status === 'deleting' ||
    run.status === 'completed' ||
    run.resume_status === 'deleting';

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(run.id).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  };

  return (
    <div className={styles.container}>
      <p className={styles.lead}>
        {t('usage_maintenance.delete_confirm_lead', {
          defaultValue:
            'The archive files and identity ledger remain, but deleting online raw data cannot be undone.',
        })}
      </p>

      {run.status === 'failed' ? (
        <div className={styles.retryNotice} role="alert">
          <div className={styles.retryNoticeIcon}>
            <IconTriangleAlert size={14} />
          </div>
          <span>
            {t('usage_maintenance.delete_confirm_retry_note', {
              defaultValue:
                'The previous cleanup was interrupted. Confirming will attempt to clean up the remaining unremoved data.',
            })}
          </span>
        </div>
      ) : null}

      {/* 1. 核心决策指标卡片 (Hero Metric Card) */}
      <div className={styles.heroCard}>
        <div className={styles.heroPrimary}>
          <div className={styles.metricItem}>
            <span className={styles.metricLabel}>
              {t('usage_maintenance.delete_remaining_count', {
                defaultValue: 'Remaining online raw events',
              })}
            </span>
            <div className={styles.metricValueRow}>
              <span className={styles.metricValueNumber}>
                {remainingEventCount.toLocaleString(i18n.language)}
              </span>
              <span className={styles.metricUnit}>
                {t('usage_maintenance.events_suffix', { defaultValue: 'events' })}
              </span>
              <span className={styles.scopeBadge}>
                {remainingEventCount === run.event_count
                  ? t('usage_maintenance.meta_cleaned_all', { defaultValue: 'Archived · Raw cleaned' })
                  : `${remainingEventCount.toLocaleString(i18n.language)} / ${run.event_count.toLocaleString(i18n.language)}`}
              </span>
            </div>
          </div>

          <div className={styles.cutoffItem}>
            <span className={styles.cutoffLabel}>
              <IconCalendar size={13} className={styles.cutoffIcon} />
              {t('usage_maintenance.delete_strict_cutoff', {
                defaultValue: 'Cutoff (strictly before)',
              })}
            </span>
            <span className={styles.cutoffValue}>
              {formatDateTime(new Date(run.cutoff_timestamp_ms), i18n.language)}
            </span>
          </div>
        </div>

        {/* 元信息条 */}
        <div className={styles.metaRow}>
          <div className={styles.metaTask}>
            <span className={styles.metaLabel}>
              {t('usage_maintenance.technical_run_id', { defaultValue: 'Task ID' })}:
            </span>
            <div
              className={styles.taskIdWrapper}
              onClick={handleCopyId}
              title={copiedId ? t('common.copied') : `${run.id} (${t('common.copy')})`}
              role="button"
              tabIndex={0}
            >
              <code className={styles.taskIdMono}>{run.id}</code>
              <span className={styles.copyIcon}>
                {copiedId ? <IconCheck size={11} /> : <IconCopy size={11} />}
              </span>
            </div>
          </div>

          <div className={styles.metaBadges}>
            <span
              className={`${styles.statusBadge} ${verified ? styles.statusSuccess : styles.statusWarning}`}
            >
              <IconShieldCheck size={13} />
              {verified
                ? t('usage_maintenance.run_status_verified', { defaultValue: 'Verified' })
                : t('usage_maintenance.run_status_verifying', { defaultValue: 'Verifying' })}
            </span>
            <span className={styles.archiveCountHint}>
              {t('usage_maintenance.delete_archived_count', {
                defaultValue: 'Total events protected by this archive',
              })}
              : <strong>{run.event_count.toLocaleString(i18n.language)}</strong>
            </span>
            <span
              className={`${styles.capabilityBadge} ${
                deletionEnabled ? styles.capEnabled : styles.capDisabled
              }`}
            >
              {t('usage_maintenance.delete_capability_state', {
                defaultValue: 'Deletion capability',
              })}
              : {deletionEnabled
                ? t('common.enabled', { defaultValue: 'Enabled' })
                : t('common.disabled', { defaultValue: 'Disabled' })}
            </span>
          </div>
        </div>
      </div>

      {/* 2. 结构化对比卡片：安全保障 vs 受限影响 */}
      <div className={styles.comparisonGrid}>
        {/* 安全与保障卡片 */}
        <div className={styles.guaranteeCard}>
          <div className={styles.cardHeader}>
            <div className={styles.headerIconSuccess}>
              <IconShieldCheck size={15} />
            </div>
            <span className={styles.cardTitleSuccess}>
              {t('usage_maintenance.delete_guarantees_title', {
                defaultValue: 'Safety Guarantees & Preserved Data',
              })}
            </span>
          </div>
          <ul className={styles.itemList}>
            <li className={styles.item}>
              <div className={styles.itemIconCheck}>
                <IconCheck size={13} />
              </div>
              <span className={styles.itemText}>
                {t('usage_maintenance.delete_raw_limitations_note', {
                  defaultValue:
                    'Core aggregates and long-term statistics remain available. Raw-dependent event details, failure diagnostics, latency distributions, and search may have coverage gaps; missing detail must not be interpreted as zero usage.',
                })}
              </span>
            </li>
            <li className={styles.item}>
              <div className={styles.itemIconCheck}>
                <IconCheck size={13} />
              </div>
              <span className={styles.itemText}>
                {t('usage_maintenance.delete_batch_recheck_note', {
                  defaultValue:
                    'The public API exposes summary readiness only. During deletion, the server rechecks exact coverage before every batch and can stop with a coverage-incomplete conflict.',
                })}
              </span>
            </li>
          </ul>
        </div>

        {/* 影响与受限说明卡片 */}
        <div className={styles.limitationCard}>
          <div className={styles.cardHeader}>
            <div className={styles.headerIconWarning}>
              <IconTriangleAlert size={15} />
            </div>
            <span className={styles.cardTitleWarning}>
              {t('usage_maintenance.delete_limitations_title', {
                defaultValue: 'Impact & Operational Limitations',
              })}
            </span>
          </div>
          <ul className={styles.itemList}>
            <li className={styles.item}>
              <div className={styles.itemIconWarning}>
                <IconTriangleAlert size={13} />
              </div>
              <span className={styles.itemText}>
                {t('usage_maintenance.delete_permanent_constraints_note', {
                  defaultValue:
                    'After historical raw events are deleted, the set of models with configured pricing and the context-tier thresholds are frozen. Rate changes, including service-tier rates, remain allowed. Keep a complete pre-deletion backup. A future upgrade that requires rebuilding derived history from complete raw events may require restoring that backup or using a dedicated migration path provided by that version.',
                })}
              </span>
            </li>
            <li className={styles.item}>
              <div className={styles.itemIconWarning}>
                <IconTriangleAlert size={13} />
              </div>
              <span className={styles.itemText}>
                {t('usage_maintenance.delete_storage_note', {
                  defaultValue:
                    'Storage note: deleting raw data frees SQLite pages for reuse, but the database file does not shrink immediately. Releasing that space back to the filesystem requires offline compaction with all Manager Server processes stopped.',
                })}
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* 3. 确认复选框卡片：直接使用 SelectionCheckbox 作为根交互容器，杜绝点击事件双触发 */}
      {onToggleAcknowledged ? (
        <SelectionCheckbox
          checked={Boolean(acknowledged)}
          onChange={onToggleAcknowledged}
          className={`${styles.checkboxCard} ${acknowledged ? styles.checkboxCardChecked : ''}`}
          label={
            <span className={styles.checkboxText}>
              <strong className={styles.checkboxStrong}>
                {t('usage_maintenance.delete_confirm_acknowledgement_strong', {
                  defaultValue: 'I understand this operation is irreversible:',
                })}
              </strong>
              {t('usage_maintenance.delete_confirm_acknowledgement_text', {
                defaultValue:
                  'Online raw events will no longer be queryable from the panel after deletion, and SQLite physical disk files will not shrink immediately (compaction must be run offline to release space).',
              })}
            </span>
          }
        />
      ) : null}
    </div>
  );
}
