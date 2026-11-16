import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ClaudeLimitResetStatus } from '@/types';
import { getClaudeResetUnavailableReason } from '@/utils/quota/claudeLimitReset';
import { formatQuotaResetTimestamp } from '../../model/accountsPagePresentation';
import styles from '../../AccountsPage.module.scss';

interface ClaudeLimitResetPanelProps {
  status: ClaudeLimitResetStatus | null;
  organizationId: string | null;
  nowMs: number;
  disabled: boolean;
  onReset?: (grantId: string) => void;
  onRefresh?: () => void;
}

export function ClaudeLimitResetPanel({
  status,
  organizationId,
  nowMs,
  disabled,
  onReset,
  onRefresh,
}: ClaudeLimitResetPanelProps) {
  const { t, i18n } = useTranslation();
  const available = status?.grants.reduce(
    (count, grant) =>
      count + (getClaudeResetUnavailableReason(status, grant, nowMs) ? 0 : grant.resetsLeft),
    0
  );
  const remaining = status?.grants.reduce(
    (count, grant) =>
      count + (grant.endsAtMs !== null && grant.endsAtMs <= nowMs ? 0 : grant.resetsLeft),
    0
  );
  return (
    <section className={styles.quotaSection} data-claude-limit-resets="true">
      <div className={styles.quotaResetCard}>
        <div className={styles.quotaResetHeader}>
          <div className={styles.quotaResetHeaderMain}>
            <span
              className={`${styles.quotaPanelIcon} ${styles.quotaResetIcon}`}
              aria-hidden="true"
            >
              <IconRefreshCw size={16} />
            </span>
            <div className={styles.quotaResetTitle}>
              <h3>{t('accounts.detail_quota_reset_records')}</h3>
              <span>{t('claude_quota.reset_card_subtitle')}</span>
            </div>
          </div>
          <div className={styles.quotaResetHeaderActions}>
            <div className={styles.quotaResetCount}>
              <span>{t('claude_quota.reset_banked')}</span>
              <strong data-claude-reset-banked="true">{remaining ?? '-'}</strong>
              <span className={styles.quotaResetCountUnit}>{t('claude_quota.reset_unit')}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className={styles.quotaResetAction}
              onClick={onRefresh}
              disabled={disabled || !onRefresh}
            >
              <IconRefreshCw size={14} />
              {t('claude_quota.refresh_button')}
            </Button>
          </div>
        </div>
        {available !== remaining ? (
          <span className={styles.quotaResetExpiryLabel}>
            {t('claude_quota.reset_usable_count', { count: available })}
          </span>
        ) : null}
        {!status ? (
          <p className={styles.quotaResetAvailabilityNote}>{t('claude_quota.reset_unknown')}</p>
        ) : null}
        {status && !organizationId ? (
          <p className={styles.quotaResetAvailabilityNote}>
            {t('claude_quota.reset_missing_organization')}
          </p>
        ) : null}
        {status?.grants.length === 0 ? (
          <p className={styles.quotaResetAvailabilityNote}>{t('claude_quota.reset_empty')}</p>
        ) : null}
        {status && status.grants.length > 0 ? (
          <div className={styles.quotaResetExpirySection}>
            <span className={styles.quotaResetExpiryLabel}>
              {t('claude_quota.reset_grants_label')}
            </span>
            <div className={styles.quotaResetExpiryList}>
              {status.grants.map((grant) => {
                const reason = getClaudeResetUnavailableReason(status, grant, nowMs);
                return (
                  <div
                    className={`${styles.quotaResetExpiryItem} ${styles.claudeResetGrant}`}
                    key={grant.id}
                    data-claude-reset-grant={grant.id}
                  >
                    <div className={styles.claudeResetGrantMain}>
                      <div className={styles.claudeResetGrantTitle} title={grant.label}>
                        <strong>
                          {grant.kind === 'unknown'
                            ? grant.label
                            : t(`claude_quota.reset_kind_${grant.kind}`)}
                        </strong>
                        <span>
                          {t('claude_quota.reset_remaining', { count: grant.resetsLeft })}
                        </span>
                      </div>
                      {grant.kind !== 'unknown' ? (
                        <p className={styles.claudeResetGrantLabel} title={grant.label}>
                          {grant.label}
                        </p>
                      ) : null}
                      {grant.kind !== 'unknown' ? (
                        <p>{t(`claude_quota.reset_kind_${grant.kind}_description`)}</p>
                      ) : null}
                      <p>
                        {t('claude_quota.reset_scopes', {
                          scopes:
                            grant.clears
                              .map((scope) => t(`claude_quota.${scope}`, { defaultValue: scope }))
                              .join(', ') || t('claude_quota.reset_scope_unknown'),
                        })}
                      </p>
                      {reason ? (
                        <p
                          role="status"
                          title={grant.unavailableReason ?? status.ineligibleReason ?? undefined}
                        >
                          {t(`claude_quota.reset_reason_${reason}`)}
                        </p>
                      ) : null}
                    </div>
                    <div className={styles.claudeResetGrantActions}>
                      {grant.endsAtMs !== null ? (
                        <strong data-claude-reset-expiry={grant.id}>
                          {t('claude_quota.reset_expires', {
                            time: formatQuotaResetTimestamp(grant.endsAtMs, i18n.language),
                          })}
                        </strong>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        className={styles.quotaResetAction}
                        onClick={() => onReset?.(grant.id)}
                        data-claude-reset-action={grant.id}
                        disabled={disabled || !organizationId || !onReset || reason !== null}
                      >
                        <IconRefreshCw size={14} />
                        {t('claude_quota.reset_action_button')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={styles.claudeResetScopeNote}>{t('claude_quota.reset_scope_note')}</p>
          </div>
        ) : null}
        {status?.cooldownUntilMs && status.cooldownUntilMs > nowMs ? (
          <p className={styles.quotaResetCooldown}>
            {t('claude_quota.reset_cooldown_until', {
              time: formatQuotaResetTimestamp(status.cooldownUntilMs, i18n.language),
            })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
