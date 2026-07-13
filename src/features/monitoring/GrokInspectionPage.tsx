import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconShield, IconTrash2 } from '@/components/ui/icons';
import {
  applyCodexInspectionExecutionResult,
  buildCodexInspectionError,
  buildExecutionFailureMessage,
  createCodexInspectionConnectionFingerprint,
  executeCodexInspectionActions,
  isCodexInspectionStoppedError,
  isExecutableAction,
  isReauthAction,
  isSuggestedAction,
  resolveCodexInspectionAutoActionItems,
  toReauthDeleteExecutionItem,
  type CodexInspectionAutoActionMode,
  type CodexInspectionConfigurableSettings,
  type CodexInspectionLogLevel,
  type CodexInspectionProgressSnapshot,
  type CodexInspectionResultItem,
  type CodexInspectionRunResult,
  type CodexInspectionSession,
} from '@/features/monitoring/codexInspection';
import {
  clearGrokInspectionConfigurableSettings,
  createGrokInspectionSession,
  DEFAULT_GROK_INSPECTION_SETTINGS,
  loadGrokInspectionConfigurableSettings,
  loadGrokInspectionLastRun,
  saveGrokInspectionConfigurableSettings,
  saveGrokInspectionLastRun,
} from '@/features/monitoring/grokInspection';
import { CodexInspectionLogsPanel } from '@/features/monitoring/components/CodexInspectionLogsPanel';
import { CodexInspectionResultsPanel } from '@/features/monitoring/components/CodexInspectionResultsPanel';
import { CodexInspectionStatusPanel } from '@/features/monitoring/components/CodexInspectionStatusPanel';
import { InspectionConfigDrawer } from '@/features/monitoring/components/InspectionConfigDrawer';
import { InspectionConfigFields } from '@/features/monitoring/components/InspectionConfigFields';
import { Panel } from '@/features/monitoring/components/CodexInspectionPanels';
import {
  CODEX_INSPECTION_RESULT_PAGE_SIZE_OPTIONS,
  buildCodexInspectionPaginationState,
  buildConfigOverviewItems,
  countActions,
  countHandlingStates,
  createCompletedProgressSnapshot,
  createIdleProgressSnapshot,
  filterInspectionResults,
  formatActionLabel,
  formatAutoActionModeLabel,
  formatTime,
  getActionFilterCounts,
  normalizeActionFilter,
  toSettingsDraft,
  validateInspectionConfigDraft,
  validateInspectionConfigFields,
  type ActionFilter,
  type ExecutionTriggerSource,
  type HandlingFilter,
  type InspectionLogEntry,
  type InspectionSettingsDraft,
  type InspectionSettingsDraftField,
  type RunStatus,
  type StatusTone,
  type SummaryCard,
} from '@/features/monitoring/model/codexInspectionPresentation';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import styles from './CodexInspectionPage.module.scss';

const toBulkExecutionItem = (
  item: CodexInspectionResultItem,
  action: 'delete' | 'disable'
): CodexInspectionResultItem => ({
  ...item,
  action,
  actionReason:
    action === 'delete' ? '用户选择一键删除 Grok 认证文件' : '用户选择一键禁用 Grok 认证文件',
});

export function GrokInspectionPage() {
  const { t, i18n } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionFingerprint = useMemo(
    () => createCodexInspectionConnectionFingerprint(apiBase, managementKey),
    [apiBase, managementKey]
  );
  const [initialLastRun] = useState(() =>
    connectionFingerprint ? loadGrokInspectionLastRun(connectionFingerprint) : null
  );

  const [inspectionSettings, setInspectionSettings] = useState<CodexInspectionConfigurableSettings>(
    () => loadGrokInspectionConfigurableSettings(config)
  );
  const [settingsDraft, setSettingsDraft] = useState<InspectionSettingsDraft>(() =>
    toSettingsDraft(loadGrokInspectionConfigurableSettings(config))
  );
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [configFocusField, setConfigFocusField] = useState<string | null>(null);
  const [logs, setLogs] = useState<InspectionLogEntry[]>(() => initialLastRun?.logs ?? []);
  const [logsCollapsed, setLogsCollapsed] = useState(() => initialLastRun?.logsCollapsed ?? true);
  const [runStatus, setRunStatus] = useState<RunStatus>(() =>
    initialLastRun?.result ? 'success' : 'idle'
  );
  const [progress, setProgress] = useState<CodexInspectionProgressSnapshot>(() =>
    initialLastRun?.result
      ? createCompletedProgressSnapshot(initialLastRun.result)
      : createIdleProgressSnapshot()
  );
  const [result, setResult] = useState<CodexInspectionRunResult | null>(
    () => initialLastRun?.result ?? null
  );
  const [resultConnectionFingerprint, setResultConnectionFingerprint] = useState<string | null>(
    () => initialLastRun?.connectionFingerprint ?? null
  );
  const [executing, setExecuting] = useState(false);
  const [actionFilter, setActionFilter] = useState<ActionFilter>(() =>
    normalizeActionFilter(initialLastRun?.actionFilter ?? 'all')
  );
  const [handlingFilter, setHandlingFilter] = useState<HandlingFilter>('all');
  const [resultPage, setResultPage] = useState(1);
  const [resultPageSize, setResultPageSize] = useState<number>(
    CODEX_INSPECTION_RESULT_PAGE_SIZE_OPTIONS[0]
  );
  const logCounterRef = useRef(initialLastRun?.logs.length ?? 0);
  const sessionRef = useRef<CodexInspectionSession | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const restoredConnectionFingerprintRef = useRef<string | null>(connectionFingerprint);
  const logListRef = useRef<HTMLDivElement | null>(null);
  const executeItemsRef = useRef<
    | ((
        items: CodexInspectionResultItem[],
        options?: {
          resultOverride?: CodexInspectionRunResult | null;
          source?: ExecutionTriggerSource;
          connectionFingerprint?: string | null;
        }
      ) => Promise<void>)
    | null
  >(null);

  useEffect(() => {
    if (restoredConnectionFingerprintRef.current === connectionFingerprint) return;
    restoredConnectionFingerprintRef.current = connectionFingerprint;

    activeSessionIdRef.current = null;
    sessionRef.current?.stop();
    sessionRef.current = null;
    setExecuting(false);

    const restored = connectionFingerprint
      ? loadGrokInspectionLastRun(connectionFingerprint)
      : null;

    setLogs(restored?.logs ?? []);
    setLogsCollapsed(restored?.logsCollapsed ?? true);
    setRunStatus(restored?.result ? 'success' : 'idle');
    setProgress(
      restored?.result
        ? createCompletedProgressSnapshot(restored.result)
        : createIdleProgressSnapshot()
    );
    setResult(restored?.result ?? null);
    setResultConnectionFingerprint(restored?.connectionFingerprint ?? null);
    setActionFilter(normalizeActionFilter(restored?.actionFilter ?? 'all'));
    setHandlingFilter('all');
    logCounterRef.current = restored?.logs.length ?? 0;
  }, [connectionFingerprint]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSettings = loadGrokInspectionConfigurableSettings(config);
      setInspectionSettings(nextSettings);
      if (!isSettingsModalOpen) {
        setSettingsDraft(toSettingsDraft(nextSettings));
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [config, isSettingsModalOpen]);

  useEffect(() => {
    if (!result || result.finishedAt <= 0) return;
    if (runStatus === 'running' || runStatus === 'paused') return;
    if (!connectionFingerprint || resultConnectionFingerprint !== connectionFingerprint) return;
    saveGrokInspectionLastRun({
      result,
      logs,
      logsCollapsed,
      actionFilter,
      connectionFingerprint,
    });
  }, [
    actionFilter,
    connectionFingerprint,
    logs,
    logsCollapsed,
    result,
    resultConnectionFingerprint,
    runStatus,
  ]);

  const appendLog = useCallback((level: CodexInspectionLogLevel, message: string) => {
    logCounterRef.current += 1;
    setLogs((previous) => [
      ...previous,
      {
        id: `${Date.now()}-${logCounterRef.current}`,
        level,
        message,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const scrollLogsToBottom = useCallback(() => {
    const element = logListRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    if (logsCollapsed) return;
    scrollLogsToBottom();
  }, [logs, logsCollapsed, scrollLogsToBottom]);

  useEffect(() => {
    return () => {
      activeSessionIdRef.current = null;
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const executeItems = useCallback(
    async (
      items: CodexInspectionResultItem[],
      options?: {
        resultOverride?: CodexInspectionRunResult | null;
        source?: ExecutionTriggerSource;
        connectionFingerprint?: string | null;
      }
    ) => {
      const currentResult = options?.resultOverride ?? result;
      const source = options?.source ?? 'manual';
      if (!currentResult) return;
      const currentResultFingerprint =
        options?.connectionFingerprint ?? resultConnectionFingerprint;
      if (!connectionFingerprint || currentResultFingerprint !== connectionFingerprint) {
        showNotification(t('notification.connection_required'), 'warning');
        return;
      }
      const targets = items.filter(isExecutableAction);
      if (targets.length === 0) {
        showNotification(t('monitoring.codex_inspection_no_pending_actions'), 'info');
        return;
      }

      setExecuting(true);
      setLogsCollapsed(false);
      appendLog('info', t('monitoring.codex_inspection_execute_started'));

      try {
        const execution = await executeCodexInspectionActions({
          settings: currentResult.settings,
          items: targets,
          previousFiles: currentResult.files,
          onLog: appendLog,
        });

        const failed = execution.outcomes.filter((item) => !item.success);
        if (failed.length > 0) {
          showNotification(
            `${t('monitoring.codex_inspection_execute_partial')}: ${failed
              .slice(0, 2)
              .map(buildExecutionFailureMessage)
              .join('；')}`,
            'warning'
          );
        } else {
          showNotification(t('monitoring.codex_inspection_execute_success'), 'success');
        }

        const nextResult = applyCodexInspectionExecutionResult(currentResult, execution);
        setResult(nextResult);
        setResultConnectionFingerprint(currentResultFingerprint);

        if (source === 'auto') {
          const successCount = execution.outcomes.filter((item) => item.success).length;
          const failedCount = execution.outcomes.length - successCount;
          const remainingCount = nextResult.results.filter(isSuggestedAction).length;
          const summaryMessage =
            failedCount > 0 || remainingCount > 0
              ? t('monitoring.codex_inspection_auto_execute_summary_partial', {
                  total: targets.length,
                  success: successCount,
                  failed: failedCount,
                  remaining: remainingCount,
                })
              : t('monitoring.codex_inspection_auto_execute_summary_success', {
                  total: targets.length,
                  success: successCount,
                });
          appendLog(failedCount > 0 || remainingCount > 0 ? 'warning' : 'success', summaryMessage);
          showNotification(
            summaryMessage,
            failedCount > 0 || remainingCount > 0 ? 'warning' : 'success'
          );
        }
      } finally {
        setExecuting(false);
      }
    },
    [appendLog, connectionFingerprint, result, resultConnectionFingerprint, showNotification, t]
  );

  useEffect(() => {
    executeItemsRef.current = executeItems;
  }, [executeItems]);

  const attachSessionPromise = useCallback(
    (
      session: CodexInspectionSession,
      promise: Promise<CodexInspectionRunResult>,
      autoActionMode: CodexInspectionAutoActionMode,
      runConnectionFingerprint: string | null
    ) => {
      const sessionId = session.id;

      void promise
        .then((nextResult) => {
          if (activeSessionIdRef.current !== sessionId) return;
          const nextSuggestedResults = nextResult.results.filter(isSuggestedAction);
          const autoTargets = resolveCodexInspectionAutoActionItems(
            autoActionMode,
            nextSuggestedResults
          );
          setResult(nextResult);
          setResultConnectionFingerprint(runConnectionFingerprint);
          setProgress(session.getProgress());
          setRunStatus('success');
          setLogsCollapsed(true);
          if (autoActionMode !== 'none') {
            if (autoTargets.length > 0 && executeItemsRef.current) {
              const startedMessage = t('monitoring.codex_inspection_auto_execute_started', {
                count: autoTargets.length,
                mode: formatAutoActionModeLabel(autoActionMode, t),
              });
              appendLog('info', startedMessage);
              showNotification(startedMessage, 'info');
              void executeItemsRef.current(autoTargets, {
                resultOverride: nextResult,
                source: 'auto',
                connectionFingerprint: runConnectionFingerprint,
              });
              return;
            }

            if (nextSuggestedResults.length > 0) {
              const skippedMessage = t('monitoring.codex_inspection_auto_execute_skipped_by_mode', {
                mode: formatAutoActionModeLabel(autoActionMode, t),
                count: nextSuggestedResults.length,
              });
              appendLog('warning', skippedMessage);
              showNotification(skippedMessage, 'info');
              return;
            }
          }

          const noActionsMessage =
            nextSuggestedResults.length === 0
              ? t('monitoring.codex_inspection_auto_execute_no_actions')
              : t('monitoring.codex_inspection_run_success');
          appendLog('success', noActionsMessage);
          showNotification(noActionsMessage, 'success');
        })
        .catch((error) => {
          if (activeSessionIdRef.current !== sessionId) return;
          if (isCodexInspectionStoppedError(error)) {
            setRunStatus('idle');
            setProgress(createIdleProgressSnapshot());
            return;
          }

          const message = buildCodexInspectionError(
            error instanceof Error ? error.message : String(error || t('common.unknown_error'))
          );
          appendLog('error', message);
          setRunStatus('error');
          setLogsCollapsed(false);
          showNotification(message, 'error');
        });
    },
    [appendLog, showNotification, t]
  );

  const startFreshInspection = useCallback(() => {
    if (connectionStatus !== 'connected' || !connectionFingerprint) {
      const message = t('notification.connection_required');
      showNotification(message, 'warning');
      return;
    }

    const autoActionMode = inspectionSettings.autoActionMode;
    const runConnectionFingerprint = connectionFingerprint;

    setLogs([]);
    setResult(null);
    setResultConnectionFingerprint(runConnectionFingerprint);
    setRunStatus('running');
    setLogsCollapsed(false);
    setActionFilter('all');
    setHandlingFilter('all');
    setResultPage(1);

    const session = createGrokInspectionSession({
      config,
      apiBase,
      managementKey,
      settings: inspectionSettings,
      onLog: (level, message) => {
        if (activeSessionIdRef.current !== session.id) return;
        appendLog(level, message);
      },
      onProgress: (snapshot) => {
        if (activeSessionIdRef.current !== session.id) return;
        setProgress(snapshot);
        if (snapshot.status === 'running') {
          setRunStatus('running');
          return;
        }
        if (snapshot.status === 'paused') {
          setRunStatus('paused');
        }
      },
      onResultsChange: (nextResult) => {
        if (activeSessionIdRef.current !== session.id) return;
        setResult(nextResult);
        setResultConnectionFingerprint(runConnectionFingerprint);
      },
    });

    sessionRef.current = session;
    activeSessionIdRef.current = session.id;
    setProgress(session.getProgress());
    attachSessionPromise(session, session.start(), autoActionMode, runConnectionFingerprint);
  }, [
    apiBase,
    appendLog,
    attachSessionPromise,
    config,
    connectionFingerprint,
    connectionStatus,
    inspectionSettings,
    managementKey,
    showNotification,
    t,
  ]);

  const handleRunInspection = useCallback(() => {
    if (runStatus === 'paused' && sessionRef.current) {
      setLogsCollapsed(false);
      sessionRef.current.resume();
      return;
    }

    startFreshInspection();
  }, [runStatus, startFreshInspection]);

  const handlePauseInspection = useCallback(() => {
    if (runStatus !== 'running') return;
    sessionRef.current?.pause();
  }, [runStatus]);

  const handleStopInspection = useCallback(() => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    appendLog('warning', t('monitoring.codex_inspection_stopped'));
    activeSessionIdRef.current = null;
    sessionRef.current = null;
    currentSession.stop();
    setRunStatus('idle');
    setProgress(createIdleProgressSnapshot());
    setResult(null);
    setResultConnectionFingerprint(null);
    setLogsCollapsed(false);
  }, [appendLog, t]);

  const displayResults = useMemo(() => (result ? result.results : []), [result]);
  const suggestedResults = useMemo(
    () => displayResults.filter(isSuggestedAction),
    [displayResults]
  );
  const executableResults = useMemo(
    () => displayResults.filter(isExecutableAction),
    [displayResults]
  );
  const reauthResults = useMemo(() => displayResults.filter(isReauthAction), [displayResults]);
  const filteredResults = useMemo(
    () => filterInspectionResults(displayResults, handlingFilter, actionFilter),
    [displayResults, handlingFilter, actionFilter]
  );
  const resultPagination = useMemo(
    () => buildCodexInspectionPaginationState(filteredResults, resultPage, resultPageSize),
    [filteredResults, resultPage, resultPageSize]
  );

  const handleResultPageSizeChange = useCallback((pageSize: number) => {
    setResultPageSize(pageSize);
    setResultPage(1);
  }, []);

  const handleActionFilterChange = useCallback((filter: ActionFilter) => {
    setActionFilter(filter);
    setResultPage(1);
  }, []);

  const handleHandlingFilterChange = useCallback((filter: HandlingFilter) => {
    setHandlingFilter(filter);
    setResultPage(1);
  }, []);

  const handleExecutePlanned = useCallback(() => {
    if (!result) return;

    const targets = executableResults;
    const counts = countActions(targets);
    showConfirmation({
      title: t('monitoring.codex_inspection_execute_confirm_title'),
      message: t('monitoring.codex_inspection_execute_confirm_body', {
        total: targets.length,
        delete: counts.delete,
        disable: counts.disable,
        enable: counts.enable,
      }),
      confirmText: t('monitoring.codex_inspection_execute_now'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => executeItems(targets),
    });
  }, [executableResults, executeItems, result, showConfirmation, t]);

  const handleExecuteSingle = useCallback(
    (item: CodexInspectionResultItem) => {
      const actionLabel = formatActionLabel(item.action, t);
      showConfirmation({
        title: t('monitoring.codex_inspection_execute_single_title'),
        message: t('monitoring.codex_inspection_execute_single_body', {
          account: item.displayAccount,
          action: actionLabel,
        }),
        confirmText: actionLabel,
        cancelText: t('common.cancel'),
        variant: item.action === 'delete' ? 'danger' : 'primary',
        onConfirm: () => executeItems([item]),
      });
    },
    [executeItems, showConfirmation, t]
  );

  const handleDeleteReauthPlanned = useCallback(() => {
    if (!result) return;
    const targets = reauthResults.map(toReauthDeleteExecutionItem);
    showConfirmation({
      title: t('monitoring.codex_inspection_delete_reauth_confirm_title'),
      message: t('monitoring.codex_inspection_delete_reauth_confirm_body', {
        count: targets.length,
      }),
      confirmText: t('monitoring.codex_inspection_delete_reauth_now'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => executeItems(targets),
    });
  }, [executeItems, reauthResults, result, showConfirmation, t]);

  const handleDeleteSingleReauth = useCallback(
    (item: CodexInspectionResultItem) => {
      showConfirmation({
        title: t('monitoring.codex_inspection_delete_reauth_single_title'),
        message: t('monitoring.codex_inspection_delete_reauth_single_body', {
          account: item.displayAccount,
          file: item.fileName,
        }),
        confirmText: t('monitoring.codex_inspection_action_delete'),
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => executeItems([toReauthDeleteExecutionItem(item)]),
      });
    },
    [executeItems, showConfirmation, t]
  );

  const bulkDisableTargets = useMemo(
    () =>
      displayResults
        .filter((item) => !item.disabled)
        .map((item) => toBulkExecutionItem(item, 'disable')),
    [displayResults]
  );
  const bulkDeleteTargets = useMemo(
    () => displayResults.map((item) => toBulkExecutionItem(item, 'delete')),
    [displayResults]
  );

  const handleBulkDisableAll = useCallback(() => {
    showConfirmation({
      title: t('monitoring.grok_inspection_bulk_disable_confirm_title'),
      message: t('monitoring.grok_inspection_bulk_disable_confirm_body', {
        count: bulkDisableTargets.length,
      }),
      confirmText: t('monitoring.grok_inspection_bulk_disable_all'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => executeItems(bulkDisableTargets),
    });
  }, [bulkDisableTargets, executeItems, showConfirmation, t]);

  const handleBulkDeleteAll = useCallback(() => {
    showConfirmation({
      title: t('monitoring.grok_inspection_bulk_delete_confirm_title'),
      message: t('monitoring.grok_inspection_bulk_delete_confirm_body', {
        count: bulkDeleteTargets.length,
      }),
      confirmText: t('monitoring.grok_inspection_bulk_delete_all'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => executeItems(bulkDeleteTargets),
    });
  }, [bulkDeleteTargets, executeItems, showConfirmation, t]);

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const summarySource =
      runStatus === 'running' || runStatus === 'paused'
        ? progress.summary
        : (result?.summary ?? null);
    const blank = '--';
    const dash = '-';
    const probeSetCount = summarySource ? summarySource.probeSetCount : null;
    const sampledTotal = summarySource ? summarySource.sampledCount : null;
    const sampledCompleted =
      summarySource === null
        ? null
        : runStatus === 'running' || runStatus === 'paused'
          ? progress.completed
          : summarySource.sampledCount;
    const deleteCount = summarySource ? summarySource.deleteCount : null;
    const disableCount = summarySource ? summarySource.disableCount : null;
    const enableCount = summarySource ? summarySource.enableCount : null;
    const reauthCount = summarySource ? summarySource.reauthCount : null;
    const keepCount = summarySource ? summarySource.keepCount : null;
    const actionCounts =
      summarySource !== null
        ? summarySource.deleteCount +
          summarySource.disableCount +
          summarySource.enableCount +
          summarySource.reauthCount
        : null;

    const probeMeta = summarySource
      ? t('monitoring.server_codex_inspection_total_files', {
          count: summarySource.totalFiles,
        })
      : t('monitoring.server_codex_inspection_total_files', { count: 0 });

    const sampledMeta = (() => {
      if (sampledTotal === null) return t('monitoring.codex_inspection_sampled_meta_idle');
      if (runStatus === 'running' || runStatus === 'paused') {
        return t('monitoring.codex_inspection_sampled_meta_running', {
          total: sampledTotal,
          percent: progress.percent,
        });
      }
      return t('monitoring.codex_inspection_sampled_meta_done', { total: sampledTotal });
    })();

    return [
      {
        key: 'probe-total',
        label: t('monitoring.codex_inspection_total_accounts'),
        value: probeSetCount === null ? blank : String(probeSetCount),
        meta: probeMeta,
        icon: 'probe',
        accent: 'blue',
      },
      {
        key: 'sampled',
        label: t('monitoring.codex_inspection_sampled_accounts'),
        value: sampledCompleted === null ? blank : String(sampledCompleted),
        meta: sampledMeta,
        icon: 'sampled',
        accent: 'cyan',
      },
      {
        key: 'delete',
        label: t('monitoring.codex_inspection_delete_count'),
        value: deleteCount === null ? blank : String(deleteCount),
        meta:
          actionCounts === null
            ? dash
            : t('monitoring.server_codex_inspection_action_total_value', { count: actionCounts }),
        tone: deleteCount && deleteCount > 0 ? 'bad' : undefined,
        icon: 'delete',
        accent: 'red',
      },
      {
        key: 'disable',
        label: t('monitoring.codex_inspection_disable_count'),
        value: disableCount === null ? blank : String(disableCount),
        meta: `${t('monitoring.codex_inspection_threshold')}: ${inspectionSettings.usedPercentThreshold}%`,
        tone: disableCount && disableCount > 0 ? 'warn' : undefined,
        icon: 'disable',
        accent: 'amber',
      },
      {
        key: 'enable',
        label: t('monitoring.codex_inspection_enable_count'),
        value: enableCount === null ? blank : String(enableCount),
        meta:
          keepCount === null
            ? dash
            : t('monitoring.server_codex_inspection_keep_count', { count: keepCount }),
        tone: enableCount && enableCount > 0 ? 'good' : undefined,
        icon: 'enable',
        accent: 'green',
      },
      {
        key: 'reauth',
        label: t('monitoring.codex_inspection_reauth_count'),
        value: reauthCount === null ? blank : String(reauthCount),
        meta: t('monitoring.codex_inspection_action_reauth'),
        tone: reauthCount && reauthCount > 0 ? 'info' : undefined,
        icon: 'reauth',
        accent: 'violet',
      },
    ];
  }, [
    inspectionSettings.usedPercentThreshold,
    progress.completed,
    progress.percent,
    progress.summary,
    result,
    runStatus,
    t,
  ]);

  const pendingActionCount = executableResults.length;
  const progressLabel =
    progress.total > 0
      ? t('monitoring.codex_inspection_progress_status', {
          completed: progress.completed,
          total: progress.total,
          inFlight: progress.inFlight,
          pending: progress.pending,
          percent: progress.percent,
        })
      : t('monitoring.codex_inspection_progress_idle');
  const showProgressBar = runStatus === 'running' || runStatus === 'paused';
  const statusToneMap: Record<RunStatus, StatusTone> = {
    idle: 'idle',
    running: 'info',
    paused: 'warn',
    success: 'good',
    error: 'bad',
  };
  const statusLabelMap: Record<RunStatus, string> = {
    idle: t('monitoring.codex_inspection_status_idle'),
    running: t('monitoring.codex_inspection_status_running'),
    paused: t('monitoring.codex_inspection_status_paused'),
    success: t('monitoring.codex_inspection_status_success'),
    error: t('monitoring.codex_inspection_status_error'),
  };
  const lastFinishedLabel =
    result && result.finishedAt > 0
      ? `${t('monitoring.codex_inspection_last_finished_at')} · ${formatTime(result.finishedAt, i18n.language)}`
      : null;

  const openSettingsModal = useCallback(
    (field?: string) => {
      setSettingsDraft(toSettingsDraft(inspectionSettings));
      setConfigFocusField(field ?? null);
      setIsSettingsModalOpen(true);
    },
    [inspectionSettings]
  );

  const handleSettingsDraftChange = useCallback(
    (field: InspectionSettingsDraftField, value: string) => {
      setSettingsDraft((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    []
  );

  const handleAutoActionModeChange = useCallback((value: CodexInspectionAutoActionMode) => {
    setSettingsDraft((previous) => ({
      ...previous,
      autoActionMode: value,
    }));
  }, []);

  const settingsFieldErrors = useMemo(
    () => validateInspectionConfigFields(settingsDraft, t),
    [settingsDraft, t]
  );

  const hasUnsavedSettings = useMemo(() => {
    const baseline = toSettingsDraft(inspectionSettings);
    return (Object.keys(baseline) as (keyof InspectionSettingsDraft)[]).some(
      (key) => baseline[key] !== settingsDraft[key]
    );
  }, [inspectionSettings, settingsDraft]);

  const handleSaveSettings = useCallback(() => {
    const validation = validateInspectionConfigDraft(settingsDraft, t);
    if (!validation.ok) {
      const firstError = Object.values(validation.errors).find(Boolean);
      showNotification(firstError ?? t('common.unknown_error'), 'error');
      return;
    }

    const nextSettings = saveGrokInspectionConfigurableSettings({
      ...validation.values,
      targetType: 'xai',
    });

    setInspectionSettings(nextSettings);
    setSettingsDraft(toSettingsDraft(nextSettings));
    setIsSettingsModalOpen(false);
    showNotification(t('monitoring.codex_inspection_settings_saved'), 'success');
  }, [settingsDraft, showNotification, t]);

  const handleCloseSettingsDrawer = useCallback(() => {
    if (hasUnsavedSettings) {
      showConfirmation({
        title: t('monitoring.server_codex_inspection_close_confirm_title'),
        message: t('monitoring.server_codex_inspection_close_unsaved_hint'),
        confirmText: t('monitoring.server_codex_inspection_discard'),
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => {
          setSettingsDraft(toSettingsDraft(inspectionSettings));
          setIsSettingsModalOpen(false);
        },
      });
      return;
    }
    setIsSettingsModalOpen(false);
  }, [hasUnsavedSettings, inspectionSettings, showConfirmation, t]);

  const handleResetSettings = useCallback(() => {
    clearGrokInspectionConfigurableSettings();
    const nextSettings = saveGrokInspectionConfigurableSettings(DEFAULT_GROK_INSPECTION_SETTINGS);
    setInspectionSettings(nextSettings);
    setSettingsDraft(toSettingsDraft(nextSettings));
    showNotification(t('monitoring.codex_inspection_settings_reset'), 'success');
  }, [showNotification, t]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    if (logsCollapsed) {
      setLogsCollapsed(false);
      requestAnimationFrame(scrollLogsToBottom);
      return;
    }
    scrollLogsToBottom();
  }, [logsCollapsed, scrollLogsToBottom]);

  const filterCounts = useMemo(() => getActionFilterCounts(displayResults), [displayResults]);
  const handlingFilterCounts = useMemo(() => countHandlingStates(displayResults), [displayResults]);

  const filterLabel = (filter: ActionFilter) => {
    switch (filter) {
      case 'delete':
        return t('monitoring.codex_inspection_filter_delete');
      case 'disable':
        return t('monitoring.codex_inspection_filter_disable');
      case 'enable':
        return t('monitoring.codex_inspection_filter_enable');
      case 'reauth':
        return t('monitoring.codex_inspection_filter_reauth');
      case 'keep':
        return t('monitoring.codex_inspection_action_keep');
      case 'all':
      default:
        return t('monitoring.codex_inspection_filter_all');
    }
  };

  const handlingFilterLabel = (filter: HandlingFilter) => {
    switch (filter) {
      case 'pending':
        return t('monitoring.codex_inspection_handling_filter_pending');
      case 'no_action':
        return t('monitoring.codex_inspection_handling_filter_no_action');
      case 'all':
      default:
        return t('monitoring.codex_inspection_handling_filter_all');
    }
  };

  const isInspectionInFlight = runStatus === 'running' || runStatus === 'paused';
  const runButtonLabel =
    runStatus === 'paused'
      ? t('monitoring.codex_inspection_resume')
      : runStatus === 'running'
        ? t('monitoring.codex_inspection_running')
        : t('monitoring.grok_inspection_run_local');
  const configOverviewItems = buildConfigOverviewItems(inspectionSettings, {
    mode: 'local',
    t,
  });

  return (
    <div className={styles.page}>
      <Panel
        title={t('monitoring.grok_inspection_title')}
        subtitle={t('monitoring.grok_inspection_desc')}
        extra={
          <div className={styles.resultsHeaderActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBulkDisableAll}
              disabled={
                !result || isInspectionInFlight || executing || bulkDisableTargets.length === 0
              }
            >
              <IconShield size={14} />
              {t('monitoring.grok_inspection_bulk_disable_all')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleBulkDeleteAll}
              disabled={
                !result || isInspectionInFlight || executing || bulkDeleteTargets.length === 0
              }
            >
              <IconTrash2 size={14} />
              {t('monitoring.grok_inspection_bulk_delete_all')}
            </Button>
          </div>
        }
      >
        <div className={styles.emptyBlockSmall}>{t('monitoring.grok_inspection_bulk_desc')}</div>
      </Panel>

      <CodexInspectionStatusPanel
        statusTone={statusToneMap[runStatus]}
        statusLabel={statusLabelMap[runStatus]}
        lastFinishedLabel={lastFinishedLabel}
        pendingActionCount={pendingActionCount}
        summaryCards={summaryCards}
        progress={progress}
        progressLabel={progressLabel}
        showProgressBar={showProgressBar}
        runStatus={runStatus}
        runButtonLabel={runButtonLabel}
        executing={executing}
        isInspectionInFlight={isInspectionInFlight}
        runDisabled={runStatus === 'running' || executing || connectionStatus !== 'connected'}
        configOverviewItems={configOverviewItems}
        configOverviewTitle={t('monitoring.grok_inspection_config_overview_title')}
        configOverviewEditLabel={t('monitoring.codex_inspection_config_overview_edit')}
        t={t}
        onEditConfig={openSettingsModal}
        onRunInspection={handleRunInspection}
        onPauseInspection={handlePauseInspection}
        onStopInspection={handleStopInspection}
      />

      <CodexInspectionResultsPanel
        result={result}
        filteredResults={resultPagination.pageItems}
        suggestedResults={suggestedResults}
        pendingActionCount={pendingActionCount}
        manualActionCount={filterCounts.reauth}
        reauthActionCount={reauthResults.length}
        handlingFilterCounts={handlingFilterCounts}
        filterCounts={filterCounts}
        handlingFilter={handlingFilter}
        actionFilter={actionFilter}
        pagination={resultPagination}
        pageSize={resultPageSize}
        pageSizeOptions={CODEX_INSPECTION_RESULT_PAGE_SIZE_OPTIONS}
        executing={executing}
        isInspectionInFlight={isInspectionInFlight}
        t={t}
        title={t('monitoring.codex_inspection_results_title')}
        subtitle={t('monitoring.grok_inspection_results_desc')}
        onActionFilterChange={handleActionFilterChange}
        onHandlingFilterChange={handleHandlingFilterChange}
        onPageChange={setResultPage}
        onPageSizeChange={handleResultPageSizeChange}
        onExecutePlanned={handleExecutePlanned}
        onExecuteSingle={handleExecuteSingle}
        onDeleteReauthPlanned={handleDeleteReauthPlanned}
        onDeleteReauthSingle={handleDeleteSingleReauth}
        filterLabel={filterLabel}
        handlingFilterLabel={handlingFilterLabel}
      />

      <CodexInspectionLogsPanel
        logs={logs}
        logsCollapsed={logsCollapsed}
        logListRef={logListRef}
        locale={i18n.language}
        t={t}
        onJumpToLatest={handleJumpToLatest}
        onToggleCollapsed={() => setLogsCollapsed((value) => !value)}
        onClearLogs={handleClearLogs}
      />

      <InspectionConfigDrawer
        open={isSettingsModalOpen}
        title={t('monitoring.grok_inspection_settings_title')}
        description={t('monitoring.grok_inspection_settings_desc')}
        closeLabel={t('common.close')}
        focusField={configFocusField}
        onClose={handleCloseSettingsDrawer}
        footer={
          <>
            <Button variant="secondary" onClick={handleResetSettings}>
              {t('monitoring.codex_inspection_settings_reset_button')}
            </Button>
            <Button variant="secondary" onClick={handleCloseSettingsDrawer}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSaveSettings}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <InspectionConfigFields
          draft={settingsDraft}
          errors={settingsFieldErrors}
          t={t}
          hideTargetType
          onFieldChange={handleSettingsDraftChange}
          onAutoActionModeChange={handleAutoActionModeChange}
        />
      </InspectionConfigDrawer>
    </div>
  );
}
