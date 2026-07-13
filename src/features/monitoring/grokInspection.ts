import { authFilesApi } from '@/services/api/authFiles';
import type { AuthFileItem, Config } from '@/types';
import { XAI_GROK_USER_AGENT } from '@/utils/quota';
import { normalizeNumberValue } from '@/utils/quota';
import {
  type CodexInspectionAccount,
  type CodexInspectionAutoActionMode,
  type CodexInspectionConfigurableSettings,
  type CodexInspectionLogLevel,
  type CodexInspectionProgressSnapshot,
  type CodexInspectionProgressStatus,
  type CodexInspectionResultItem,
  type CodexInspectionRunResult,
  type CodexInspectionSession,
  type CodexInspectionStoredActionFilter,
  CodexInspectionStoppedError,
} from '@/features/monitoring/codexInspection';
import {
  buildProgressSummary,
  buildSummary,
  createProgressSnapshot,
} from '@/features/monitoring/model/codexInspectionProgress';
import {
  hydrateCodexInspectionLastRun,
  serializeCodexInspectionLastRun,
  sortCodexInspectionResults,
} from '@/features/monitoring/model/codexInspectionStorage';
import {
  CODEX_INSPECTION_AUTO_ACTION_MODES,
  clampPositiveInteger,
  isRecord,
  normalizeAutoActionMode,
  readString,
} from '@/features/monitoring/model/codexInspectionSettings';
import {
  inspectSingleGrokAccount,
  toGrokInspectionAccount,
} from '@/features/monitoring/model/grokInspectionProbe';

export const GROK_INSPECTION_SETTINGS_STORAGE_KEY = 'cli-proxy-grok-inspection-settings-v1';
export const GROK_INSPECTION_LAST_RUN_STORAGE_KEY = 'cli-proxy-grok-inspection-last-run-v1';

export const DEFAULT_GROK_INSPECTION_SETTINGS: CodexInspectionConfigurableSettings = {
  targetType: 'xai',
  workers: 4,
  deleteWorkers: 4,
  timeout: 15000,
  retries: 0,
  userAgent: XAI_GROK_USER_AGENT,
  usedPercentThreshold: 100,
  sampleSize: 0,
  autoActionMode: 'none',
};

type LogHandler = (level: CodexInspectionLogLevel, message: string) => void;
type ProgressHandler = (progress: CodexInspectionProgressSnapshot) => void;
type ResultsChangeHandler = (result: CodexInspectionRunResult) => void;

type InspectGrokAccountsOptions = {
  config: Config | null;
  apiBase: string;
  managementKey: string;
  settings?: Partial<CodexInspectionConfigurableSettings> | null;
  onLog?: LogHandler;
  onProgress?: ProgressHandler;
  onResultsChange?: ResultsChangeHandler;
};

type GrokInspectionSessionPromiseState = {
  promise: Promise<CodexInspectionRunResult>;
  resolve: (value: CodexInspectionRunResult) => void;
  reject: (reason?: unknown) => void;
};

const normalizeThreshold = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return NaN;
  if (normalized > 0 && normalized <= 1) return normalized * 100;
  return normalized;
};

const readNonNegativeInteger = (value: unknown, fallback: number) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return fallback;
  return Math.floor(normalized);
};

export const normalizeGrokInspectionConfigurableSettings = (
  input?: Partial<CodexInspectionConfigurableSettings> | null
): CodexInspectionConfigurableSettings => {
  const merged = {
    ...DEFAULT_GROK_INSPECTION_SETTINGS,
    ...(input ?? {}),
  };
  const threshold = normalizeThreshold(merged.usedPercentThreshold);
  const retriesValue = normalizeNumberValue(merged.retries);

  return {
    targetType: 'xai',
    workers: clampPositiveInteger(
      normalizeNumberValue(merged.workers) ?? undefined,
      DEFAULT_GROK_INSPECTION_SETTINGS.workers
    ),
    deleteWorkers: clampPositiveInteger(
      normalizeNumberValue(merged.deleteWorkers) ?? undefined,
      DEFAULT_GROK_INSPECTION_SETTINGS.deleteWorkers
    ),
    timeout: clampPositiveInteger(
      normalizeNumberValue(merged.timeout) ?? undefined,
      DEFAULT_GROK_INSPECTION_SETTINGS.timeout
    ),
    retries:
      retriesValue === null
        ? DEFAULT_GROK_INSPECTION_SETTINGS.retries
        : Math.max(0, Math.floor(retriesValue)),
    userAgent: readString(merged.userAgent) || DEFAULT_GROK_INSPECTION_SETTINGS.userAgent,
    usedPercentThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(100, threshold))
      : DEFAULT_GROK_INSPECTION_SETTINGS.usedPercentThreshold,
    sampleSize: readNonNegativeInteger(
      merged.sampleSize,
      DEFAULT_GROK_INSPECTION_SETTINGS.sampleSize
    ),
    autoActionMode: normalizeAutoActionMode(merged.autoActionMode),
  };
};

export const loadGrokInspectionConfigurableSettings = (
  config?: Config | null
): CodexInspectionConfigurableSettings => {
  const clean = isRecord(config?.clean) ? config?.clean : {};
  const configSettings = {
    workers: normalizeNumberValue(clean?.workers) ?? undefined,
    deleteWorkers: normalizeNumberValue(clean?.deleteWorkers) ?? undefined,
    timeout: normalizeNumberValue(clean?.timeout) ?? undefined,
    retries: normalizeNumberValue(clean?.retries) ?? undefined,
    usedPercentThreshold: normalizeNumberValue(clean?.usedPercentThreshold) ?? undefined,
    sampleSize: normalizeNumberValue(clean?.sampleSize) ?? undefined,
    autoActionMode:
      clean?.autoActionMode === undefined
        ? undefined
        : normalizeAutoActionMode(clean.autoActionMode),
  };

  try {
    if (typeof localStorage === 'undefined') {
      return normalizeGrokInspectionConfigurableSettings(configSettings);
    }
    const raw = localStorage.getItem(GROK_INSPECTION_SETTINGS_STORAGE_KEY);
    if (!raw) return normalizeGrokInspectionConfigurableSettings(configSettings);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return normalizeGrokInspectionConfigurableSettings(configSettings);
    return normalizeGrokInspectionConfigurableSettings({
      ...configSettings,
      ...parsed,
    });
  } catch {
    return normalizeGrokInspectionConfigurableSettings(configSettings);
  }
};

export const saveGrokInspectionConfigurableSettings = (
  settings: Partial<CodexInspectionConfigurableSettings>
): CodexInspectionConfigurableSettings => {
  const normalized = normalizeGrokInspectionConfigurableSettings(settings);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GROK_INSPECTION_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    console.warn('保存 Grok 巡检配置失败');
  }

  return normalized;
};

export const clearGrokInspectionConfigurableSettings = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GROK_INSPECTION_SETTINGS_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Grok 巡检配置失败');
  }
};

export const loadGrokInspectionLastRun = (expectedConnectionFingerprint?: string | null) => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GROK_INSPECTION_LAST_RUN_STORAGE_KEY);
    if (!raw) return null;
    return hydrateCodexInspectionLastRun(JSON.parse(raw), { expectedConnectionFingerprint });
  } catch {
    return null;
  }
};

export const saveGrokInspectionLastRun = (
  input: Parameters<typeof serializeCodexInspectionLastRun>[0]
) => {
  const payload = serializeCodexInspectionLastRun(input);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GROK_INSPECTION_LAST_RUN_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    console.warn('保存 Grok 巡检记录失败');
  }
  return hydrateCodexInspectionLastRun(payload);
};

export const clearGrokInspectionLastRun = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GROK_INSPECTION_LAST_RUN_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Grok 巡检记录失败');
  }
};

export const resolveGrokInspectionSettings = (
  config: Config | null,
  apiBase: string,
  managementKey: string,
  settingsOverride?: Partial<CodexInspectionConfigurableSettings> | null
) => {
  const clean = config?.clean ?? null;
  const configurable = normalizeGrokInspectionConfigurableSettings({
    ...loadGrokInspectionConfigurableSettings(config),
    ...(settingsOverride ?? {}),
  });

  return {
    baseUrl: readString(apiBase) || readString(clean?.baseUrl),
    token: readString(managementKey) || readString(clean?.token),
    targetType: configurable.targetType,
    workers: configurable.workers,
    deleteWorkers: configurable.deleteWorkers,
    timeout: configurable.timeout,
    retries: configurable.retries,
    userAgent: configurable.userAgent,
    usedPercentThreshold: configurable.usedPercentThreshold,
    sampleSize: configurable.sampleSize,
  };
};

const createDeferred = (): GrokInspectionSessionPromiseState => {
  let resolve: ((value: CodexInspectionRunResult) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<CodexInspectionRunResult>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (reason) => reject?.(reason),
  };
};

const pickSample = <T>(items: T[], sampleSize: number): T[] => {
  if (sampleSize <= 0 || sampleSize >= items.length) return [...items];

  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, sampleSize);
};

export const createGrokInspectionSession = ({
  config,
  apiBase,
  managementKey,
  settings,
  onLog,
  onProgress,
  onResultsChange,
}: InspectGrokAccountsOptions): CodexInspectionSession => {
  const resolvedSettings = resolveGrokInspectionSettings(config, apiBase, managementKey, settings);
  const sessionId = `grok-inspection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let status: CodexInspectionProgressStatus = 'idle';
  let startedAt = 0;
  let finishedAt = 0;
  let files: AuthFileItem[] = [];
  let probeSet: CodexInspectionAccount[] = [];
  let sampledAccounts: CodexInspectionAccount[] = [];
  let cursor = 0;
  let inFlight = 0;
  let finalResult: CodexInspectionRunResult | null = null;
  let deferred: GrokInspectionSessionPromiseState | null = null;
  const resultMap = new Map<string, CodexInspectionResultItem>();

  const emitProgress = () => {
    const baseTime = startedAt || Date.now();
    onProgress?.(
      createProgressSnapshot(
        sampledAccounts.length,
        resultMap.size,
        inFlight,
        status,
        baseTime,
        Date.now(),
        buildProgressSummary(files, probeSet, sampledAccounts, Array.from(resultMap.values()))
      )
    );
  };

  const buildRunResult = (finishedTime: number): CodexInspectionRunResult => {
    const results = sortCodexInspectionResults(Array.from(resultMap.values()));
    const summary = buildSummary(files, probeSet, results, resolvedSettings);
    return {
      settings: resolvedSettings,
      files,
      results,
      summary,
      startedAt,
      finishedAt: finishedTime,
    };
  };

  const emitResultsChange = (latestResult: CodexInspectionResultItem) => {
    if (latestResult.action === 'keep') return;
    onResultsChange?.(buildRunResult(0));
  };

  const settleStopped = () => {
    if (!deferred) return;
    const currentDeferred = deferred;
    deferred = null;
    currentDeferred.reject(new CodexInspectionStoppedError());
  };

  const settleCompleted = () => {
    if (!deferred) return;
    const currentDeferred = deferred;
    deferred = null;
    finishedAt = Date.now();
    finalResult = buildRunResult(finishedAt);
    status = 'completed';
    emitProgress();
    onLog?.(
      'success',
      `Grok 巡检完成：删除 ${finalResult.summary.deleteCount}、禁用 ${finalResult.summary.disableCount}、启用 ${finalResult.summary.enableCount}、重新登录 ${finalResult.summary.reauthCount}、保留 ${finalResult.summary.keepCount}`
    );
    currentDeferred.resolve(finalResult);
  };

  const maybeSettle = () => {
    if (status === 'stopped') {
      if (inFlight === 0) settleStopped();
      return;
    }

    if (cursor >= sampledAccounts.length && inFlight === 0) {
      settleCompleted();
    }
  };

  const pump = () => {
    if (status !== 'running') {
      maybeSettle();
      return;
    }

    while (
      status === 'running' &&
      inFlight < resolvedSettings.workers &&
      cursor < sampledAccounts.length
    ) {
      const account = sampledAccounts[cursor];
      cursor += 1;
      inFlight += 1;
      emitProgress();

      void inspectSingleGrokAccount(account, resolvedSettings, onLog)
        .then((inspectionResult) => {
          resultMap.set(inspectionResult.key, inspectionResult);
          emitResultsChange(inspectionResult);
        })
        .catch((error) => {
          const fallbackResult: CodexInspectionResultItem = {
            ...account,
            action: 'keep',
            actionReason: '探测异常，保留账号',
            statusCode: null,
            usedPercent: null,
            isQuota: false,
            error: error instanceof Error ? error.message : String(error || '探测失败'),
          };
          resultMap.set(account.key, fallbackResult);
          emitResultsChange(fallbackResult);
        })
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          emitProgress();
          pump();
        });
    }

    maybeSettle();
  };

  const ensureStarted = () => {
    if (startedAt <= 0) startedAt = Date.now();
    if (!deferred) deferred = createDeferred();
    return deferred;
  };

  const initialize = async () => {
    onLog?.('info', '加载认证文件列表，目标类型：xai / Grok');

    const authFilesResponse = await authFilesApi.list();
    files = Array.isArray(authFilesResponse.files) ? authFilesResponse.files : [];
    const accounts = files.map(toGrokInspectionAccount);
    probeSet = accounts.filter((item) => item.provider === resolvedSettings.targetType);
    sampledAccounts =
      resolvedSettings.sampleSize > 0
        ? pickSample(probeSet, Math.min(resolvedSettings.sampleSize, probeSet.length))
        : probeSet;

    onLog?.(
      'info',
      `已查询到 ${probeSet.length} 个 Grok 认证文件，本次探测 ${sampledAccounts.length} 个`
    );
    emitProgress();
  };

  const start = () => {
    if (finalResult) return Promise.resolve(finalResult);
    if (status === 'completed') return Promise.reject(new Error('巡检已结束，请重新开始'));
    if (status === 'running') return ensureStarted().promise;
    if (status === 'paused') {
      status = 'running';
      onLog?.('info', '继续 Grok 巡检');
      emitProgress();
      pump();
      return ensureStarted().promise;
    }
    if (status === 'stopped') {
      return Promise.reject(new CodexInspectionStoppedError('巡检已停止，请重新开始'));
    }

    const currentDeferred = ensureStarted();
    status = 'running';
    emitProgress();

    void initialize()
      .then(() => {
        pump();
      })
      .catch((error) => {
        status = 'completed';
        emitProgress();
        const activeDeferred = deferred;
        deferred = null;
        activeDeferred?.reject(error);
      });

    return currentDeferred.promise;
  };

  const resume = () => {
    if (status !== 'paused') return;
    status = 'running';
    onLog?.('info', '继续 Grok 巡检');
    emitProgress();
    pump();
  };

  const pause = () => {
    if (status !== 'running') return;
    status = 'paused';
    onLog?.(
      'info',
      inFlight > 0 ? `Grok 巡检已暂停，等待 ${inFlight} 个进行中的探测完成` : 'Grok 巡检已暂停'
    );
    emitProgress();
    maybeSettle();
  };

  const stop = () => {
    if (status === 'completed' || status === 'stopped' || status === 'idle') return;
    status = 'stopped';
    onLog?.(
      'warning',
      inFlight > 0 ? `Grok 巡检已停止，等待 ${inFlight} 个进行中的探测完成` : 'Grok 巡检已停止'
    );
    emitProgress();
    maybeSettle();
  };

  return {
    id: sessionId,
    start,
    resume,
    pause,
    stop,
    getProgress: () =>
      createProgressSnapshot(
        sampledAccounts.length,
        resultMap.size,
        inFlight,
        status,
        startedAt || Date.now(),
        Date.now(),
        buildProgressSummary(files, probeSet, sampledAccounts, Array.from(resultMap.values()))
      ),
  };
};

export const inspectGrokAccounts = async (
  options: InspectGrokAccountsOptions
): Promise<CodexInspectionRunResult> => createGrokInspectionSession(options).start();

export { CODEX_INSPECTION_AUTO_ACTION_MODES };
export type {
  CodexInspectionAutoActionMode,
  CodexInspectionConfigurableSettings,
  CodexInspectionStoredActionFilter,
};
