import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconExternalLink,
  IconInfo,
  IconRefreshCw,
  IconSatellite,
  IconSettings,
  IconTimer,
} from '@/components/ui/icons';
import { useConfigStore, useNotificationStore } from '@/stores';
import { configApi, versionApi } from '@/services/api';
import type { UsageServiceStatus } from '@/services/api/usageService';
import type { ConnectionStatus } from '@/types';
import { compareVersions, type VersionComparison } from '@/utils/version';
import { readApiLatestVersion, readManagerLatestTag } from '@/features/system/versionChecks';
import styles from './VersionCard.module.scss';

interface VersionCardProps {
  appVersion: string;
  apiVersion: string;
  cpaBase: string;
  serverBuildDate?: string;
  connectionStatus: ConnectionStatus;
  refreshSignal?: number;
  usageEnabled: boolean;
  usageLoading: boolean;
  usageError?: string;
  collectorStatus: UsageServiceStatus | null;
  collectorLoading: boolean;
  collectorError?: string;
  errorLogCount: number;
  errorLogsLoading: boolean;
}

interface LatestVersions {
  latestApp: string;
  latestApi: string;
}

type HealthTone = 'ok' | 'warn' | 'error' | 'muted';

interface HealthItem {
  label: string;
  value: string;
  tone: HealthTone;
  icon: ReactNode;
  to?: string;
}

const renderBadge = (
  comparison: VersionComparison,
  latest: string,
  t: TFunction
): { label: string; className: string } | null => {
  if (comparison === null) return null;
  if (comparison > 0) {
    const display = latest.trim().replace(/^[vV]+/, '');
    return {
      label: t('dashboard.version_update_available', { version: `v${display}` }),
      className: styles.badgeUpdate,
    };
  }
  if (comparison === 0) {
    return { label: t('dashboard.version_is_latest'), className: styles.badgeLatest };
  }
  return null;
};

export function VersionCard({
  appVersion,
  apiVersion,
  cpaBase,
  serverBuildDate,
  connectionStatus,
  refreshSignal,
  usageEnabled,
  usageLoading,
  usageError,
  collectorStatus,
  collectorLoading,
  collectorError,
  errorLogCount,
  errorLogsLoading,
}: VersionCardProps) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const [latest, setLatest] = useState<LatestVersions>({ latestApp: '', latestApi: '' });
  const [checkingAppVersion, setCheckingAppVersion] = useState(false);
  const [checkingApiVersion, setCheckingApiVersion] = useState(false);
  const [requestLogModalOpen, setRequestLogModalOpen] = useState(false);
  const [requestLogDraft, setRequestLogDraft] = useState(false);
  const [requestLogTouched, setRequestLogTouched] = useState(false);
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestLogEnabled = config?.requestLog ?? false;
  const requestLogDirty = requestLogDraft !== requestLogEnabled;
  const canEditRequestLog = connectionStatus === 'connected' && Boolean(config);

  useEffect(() => {
    let cancelled = false;

    const tasks: Array<Promise<Partial<LatestVersions>>> = [
      versionApi
        .checkManagerLatest()
        .then((data) => ({ latestApp: readManagerLatestTag(data) }))
        .catch(() => ({})),
    ];

    if (connectionStatus === 'connected') {
      tasks.push(
        versionApi
          .checkLatest()
          .then((data) => ({ latestApi: readApiLatestVersion(data) }))
          .catch(() => ({}))
      );
    }

    Promise.all(tasks).then((results) => {
      if (cancelled) return;
      const merged = results.reduce<LatestVersions>(
        (acc, partial) => ({
          latestApp: partial.latestApp ?? acc.latestApp,
          latestApi: partial.latestApi ?? acc.latestApi,
        }),
        { latestApp: '', latestApi: '' }
      );
      setLatest(merged);
    });

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, refreshSignal]);

  const openRequestLogModal = useCallback(() => {
    setRequestLogTouched(false);
    setRequestLogDraft(requestLogEnabled);
    setRequestLogModalOpen(true);

    if (!config && connectionStatus === 'connected') {
      fetchConfig().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        showNotification(
          `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      });
    }
  }, [config, connectionStatus, fetchConfig, requestLogEnabled, showNotification, t]);

  const handleInfoVersionTap = useCallback(() => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) {
      clearTimeout(versionTapTimer.current);
    }

    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
      openRequestLogModal();
      return;
    }

    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
    }, 1500);
  }, [openRequestLogModal]);

  const handleRequestLogClose = useCallback(() => {
    setRequestLogModalOpen(false);
    setRequestLogTouched(false);
  }, []);

  const handleRequestLogSave = async () => {
    if (!canEditRequestLog) return;
    if (!requestLogDirty) {
      setRequestLogModalOpen(false);
      return;
    }

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', requestLogDraft);

    try {
      await configApi.updateRequestLog(requestLogDraft);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
      setRequestLogModalOpen(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const handleAppVersionCheck = useCallback(async () => {
    setCheckingAppVersion(true);
    try {
      const data = await versionApi.checkManagerLatest();
      const latestApp = readManagerLatestTag(data);
      const comparison = compareVersions(latestApp, appVersion);
      setLatest((prev) => ({ ...prev, latestApp }));

      if (!latestApp) {
        showNotification(t('system_info.manager_version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.manager_version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(
          t('system_info.manager_version_update_available', { version: latestApp }),
          'warning'
        );
      } else {
        showNotification(t('system_info.manager_version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.manager_version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingAppVersion(false);
    }
  }, [appVersion, showNotification, t]);

  const handleApiVersionCheck = useCallback(async () => {
    setCheckingApiVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const latestApi = readApiLatestVersion(data);
      const comparison = compareVersions(latestApi, apiVersion);
      setLatest((prev) => ({ ...prev, latestApi }));

      if (!latestApi) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latestApi }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingApiVersion(false);
    }
  }, [apiVersion, showNotification, t]);

  useEffect(() => {
    if (requestLogModalOpen && !requestLogTouched) {
      setRequestLogDraft(requestLogEnabled);
    }
  }, [requestLogModalOpen, requestLogTouched, requestLogEnabled]);

  useEffect(() => {
    return () => {
      if (versionTapTimer.current) {
        clearTimeout(versionTapTimer.current);
      }
    };
  }, []);

  const appBadge = useMemo(
    () => renderBadge(compareVersions(latest.latestApp, appVersion), latest.latestApp, t),
    [appVersion, latest.latestApp, t]
  );
  const apiBadge = useMemo(
    () => renderBadge(compareVersions(latest.latestApi, apiVersion), latest.latestApi, t),
    [apiVersion, latest.latestApi, t]
  );

  const buildTimeDisplay = serverBuildDate
    ? new Date(serverBuildDate).toLocaleString(i18n.language)
    : t('dashboard.version_unknown');

  const collector = collectorStatus?.collector;
  const collectorLastError = collector?.lastError?.trim() || '';
  const usageState: HealthItem = usageEnabled
    ? usageError
      ? {
          label: t('dashboard.health_usage_monitor'),
          value: t('dashboard.health_status_problem'),
          tone: 'error',
          icon: <IconInfo size={16} />,
        }
      : {
          label: t('dashboard.health_usage_monitor'),
          value: usageLoading ? '...' : t('dashboard.health_status_normal'),
          tone: usageLoading ? 'muted' : 'ok',
          icon: <IconCheck size={16} />,
        }
    : {
        label: t('dashboard.health_usage_monitor'),
        value: t('dashboard.health_status_disabled'),
        tone: 'muted',
        icon: <IconInfo size={16} />,
      };

  const collectorState: HealthItem = !usageEnabled
    ? {
        label: t('dashboard.collector_status_title'),
        value: t('dashboard.health_status_disabled'),
        tone: 'muted',
        icon: <IconInfo size={16} />,
      }
    : collectorError
      ? {
          label: t('dashboard.collector_status_title'),
          value: t('dashboard.collector_unavailable'),
          tone: 'error',
          icon: <IconInfo size={16} />,
        }
      : collectorLastError
        ? {
            label: t('dashboard.collector_status_title'),
            value: t('dashboard.health_status_warning'),
            tone: 'warn',
            icon: <IconInfo size={16} />,
          }
        : {
            label: t('dashboard.collector_status_title'),
            value: collectorLoading && !collectorStatus ? '...' : t('dashboard.health_status_normal'),
            tone: collectorLoading && !collectorStatus ? 'muted' : 'ok',
            icon: <IconCheck size={16} />,
          };

  const queueState: HealthItem = !usageEnabled
    ? {
        label: t('dashboard.health_queue_status'),
        value: t('dashboard.health_status_disabled'),
        tone: 'muted',
        icon: <IconInfo size={16} />,
      }
    : collectorError
      ? {
          label: t('dashboard.health_queue_status'),
          value: t('dashboard.collector_unavailable'),
          tone: 'error',
          icon: <IconInfo size={16} />,
        }
      : {
          label: t('dashboard.health_queue_status'),
          value: collector?.queue || (collectorLoading && !collectorStatus ? '...' : t('dashboard.health_status_normal')),
          tone: collectorLoading && !collectorStatus ? 'muted' : 'ok',
          icon: <IconCheck size={16} />,
        };

  const errorLogState: HealthItem = {
    label: t('dashboard.health_error_logs'),
    value: errorLogsLoading
      ? '...'
      : errorLogCount > 0
        ? t('dashboard.health_error_log_count', { count: errorLogCount })
        : t('dashboard.health_status_normal'),
    tone: errorLogsLoading ? 'muted' : errorLogCount > 0 ? 'warn' : 'ok',
    icon: errorLogCount > 0 ? <IconInfo size={16} /> : <IconCheck size={16} />,
    to: '/logs?tab=errors',
  };

  const healthItems = [usageState, collectorState, queueState, errorLogState];

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dashboard.system_overview')}</h2>
        <div className={`${styles.grid} ${styles.systemGrid}`}>
          <div
            className={`${styles.item} ${styles.tapItem}`}
            role="button"
            tabIndex={0}
            onClick={handleInfoVersionTap}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleInfoVersionTap();
              }
            }}
          >
            <div className={styles.icon}><IconSettings size={18} /></div>
            <div className={styles.content}>
              <div className={styles.versionHeader}>
                <div className={styles.label}>{t('dashboard.app_version')}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  iconOnly
                  className={styles.versionAction}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleAppVersionCheck();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  loading={checkingAppVersion}
                  title={t('system_info.version_check_button')}
                  aria-label={t('system_info.version_check_button')}
                >
                  {!checkingAppVersion && <IconRefreshCw size={14} />}
                </Button>
              </div>
              <div className={styles.valueWrap}>
                <span className={styles.value}>{appVersion || t('dashboard.version_unknown')}</span>
                {appBadge && <span className={`${styles.badge} ${appBadge.className}`}>{appBadge.label}</span>}
              </div>
            </div>
          </div>

          <div className={styles.item}>
            <div className={styles.icon}><IconSatellite size={18} /></div>
            <div className={styles.content}>
              <div className={styles.versionHeader}>
                <div className={styles.label}>{t('dashboard.api_version')}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  iconOnly
                  className={styles.versionAction}
                  onClick={() => void handleApiVersionCheck()}
                  loading={checkingApiVersion}
                  title={t('system_info.version_check_button')}
                  aria-label={t('system_info.version_check_button')}
                >
                  {!checkingApiVersion && <IconRefreshCw size={14} />}
                </Button>
              </div>
              <div className={styles.valueWrap}>
                <span className={styles.value}>{apiVersion || t('dashboard.version_unknown')}</span>
                {apiBadge && <span className={`${styles.badge} ${apiBadge.className}`}>{apiBadge.label}</span>}
              </div>
            </div>
          </div>

          <div className={styles.item}>
            <div className={styles.icon}><IconTimer size={18} /></div>
            <div className={styles.content}>
              <div className={styles.label}>{t('dashboard.build_time')}</div>
              <div className={styles.value}>{buildTimeDisplay}</div>
            </div>
          </div>

          <div className={styles.item}>
            <div className={styles.icon}><IconExternalLink size={18} /></div>
            <div className={styles.content}>
              <div className={styles.label}>{t('dashboard.cpa_base')}</div>
              <div className={styles.value}>{cpaBase || '-'}</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dashboard.health_status')}</h2>
        <div className={`${styles.grid} ${styles.healthGrid}`}>
          {healthItems.map((item) => {
            const content = (
              <>
                <div className={`${styles.healthIcon} ${styles[item.tone]}`}>{item.icon}</div>
                <div className={styles.content}>
                  <div className={styles.label}>{item.label}</div>
                  <div className={`${styles.value} ${styles[`${item.tone}Text`]}`}>{item.value}</div>
                </div>
              </>
            );

            return item.to ? (
              <Link key={item.label} to={item.to} className={`${styles.healthItem} ${styles.healthLink}`}>
                {content}
              </Link>
            ) : (
              <div key={item.label} className={styles.healthItem}>
                {content}
              </div>
            );
          })}
        </div>
      </section>

      <Modal
        open={requestLogModalOpen}
        onClose={handleRequestLogClose}
        title={t('basic_settings.request_log_title')}
        footer={
          <>
            <Button variant="secondary" onClick={handleRequestLogClose} disabled={requestLogSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRequestLogSave}
              loading={requestLogSaving}
              disabled={!canEditRequestLog || !requestLogDirty}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="request-log-modal">
          <div className="status-badge warning">{t('basic_settings.request_log_warning')}</div>
          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            labelPosition="left"
            checked={requestLogDraft}
            disabled={!canEditRequestLog || requestLogSaving}
            onChange={(value) => {
              setRequestLogDraft(value);
              setRequestLogTouched(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
