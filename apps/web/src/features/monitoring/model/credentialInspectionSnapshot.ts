import type {
  CodexInspectionLastRunState,
  CodexInspectionResultItem,
  CodexInspectionRunResult,
} from '@/features/monitoring/codexInspection';
import type {
  CodexInspectionResult,
  CodexInspectionRun,
  CodexInspectionRunDetail,
} from '@/services/api';

export type CredentialHealthInspectionMode = 'local' | 'server';

export interface CredentialInspectionTarget {
  fileName: string;
  runtimeId?: string | null;
  provider?: string | null;
  authIndex: string | null;
  accountId?: string | null;
  accountSnapshot?: string | null;
}

export type CredentialInspectionResult = CodexInspectionResult & {
  inspectionSource: CredentialHealthInspectionMode;
};

export interface CredentialInspectionSnapshot {
  source: CredentialHealthInspectionMode;
  completedAtMs: number;
  results: CredentialInspectionResult[];
  runs: CodexInspectionRun[];
}

const toLocalInspectionResult = (
  item: CodexInspectionResultItem,
  index: number,
  createdAtMs: number
): CredentialInspectionResult => ({
  id: -(index + 1),
  runId: 0,
  accountKey: item.key,
  fileName: item.fileName,
  displayAccount: item.displayAccount,
  runtimeId: item.runtimeId ?? undefined,
  accountSnapshot: item.accountSnapshot ?? undefined,
  authIndex: item.authIndex ?? undefined,
  accountId: item.accountId ?? undefined,
  provider: item.provider,
  disabled: item.disabled,
  status: item.status,
  state: item.state,
  action: item.action,
  actionReason: item.actionReason,
  actionStatus: item.actionHandled ? 'success' : 'pending',
  statusCode: item.statusCode ?? undefined,
  usedPercent: item.usedPercent ?? undefined,
  isQuota: item.isQuota,
  autoRecoverEligible: item.autoRecoverEligible,
  error: item.error,
  planType: item.planType,
  quotaWindows: item.quotaWindows,
  quotaInventoryObserved: item.quotaInventoryObserved,
  errorKind: item.errorKind,
  errorDetail: item.errorDetail,
  createdAtMs,
  inspectionSource: 'local',
});

const toLocalInspectionRun = (
  result: CodexInspectionRunResult,
  savedAtMs: number
): CodexInspectionRun => ({
  id: 0,
  triggerType: 'browser',
  status: 'completed',
  startedAtMs: result.startedAt,
  finishedAtMs: result.finishedAt,
  totalFiles: result.summary.totalFiles,
  probeSetCount: result.summary.probeSetCount,
  sampledCount: result.summary.sampledCount,
  disabledCount: result.summary.disabledCount,
  enabledCount: result.summary.enabledCount,
  deleteCount: result.summary.deleteCount,
  disableCount: result.summary.disableCount,
  enableCount: result.summary.enableCount,
  reauthCount: result.summary.reauthCount,
  keepCount: result.summary.keepCount,
  createdAtMs: savedAtMs,
  updatedAtMs: savedAtMs,
});

export const createLocalCredentialInspectionSnapshot = (
  result: CodexInspectionRunResult,
  savedAtMs = Date.now()
): CredentialInspectionSnapshot => {
  const completedAtMs = result.finishedAt || result.startedAt || savedAtMs;
  return {
    source: 'local',
    completedAtMs,
    results: result.results.map((item, index) =>
      toLocalInspectionResult(item, index, completedAtMs)
    ),
    runs: [toLocalInspectionRun(result, savedAtMs)],
  };
};

export const createStoredLocalCredentialInspectionSnapshot = (
  state: CodexInspectionLastRunState
): CredentialInspectionSnapshot =>
  createLocalCredentialInspectionSnapshot(state.result, state.savedAt);

export const createServerCredentialInspectionSnapshot = (
  detail: CodexInspectionRunDetail,
  runs: CodexInspectionRun[]
): CredentialInspectionSnapshot | null => {
  if (!isCompletedCredentialInspectionRun(detail.run)) {
    return null;
  }

  return {
    source: 'server',
    completedAtMs: detail.run.finishedAtMs,
    results: detail.results.map((item) => ({ ...item, inspectionSource: 'server' })),
    runs,
  };
};

export const selectLatestCredentialInspectionSnapshot = (
  snapshots: Array<CredentialInspectionSnapshot | null | undefined>
): CredentialInspectionSnapshot | null =>
  snapshots.reduce<CredentialInspectionSnapshot | null>((latest, candidate) => {
    if (!candidate) return latest;
    if (!latest || candidate.completedAtMs >= latest.completedAtMs) return candidate;
    return latest;
  }, null);

export const isCompletedCredentialInspectionRun = (
  run: CodexInspectionRun
): run is CodexInspectionRun & { finishedAtMs: number } =>
  run.status.trim().toLowerCase() === 'completed' &&
  typeof run.finishedAtMs === 'number' &&
  run.finishedAtMs > 0;

const isCredentialMutationAction = (action: string | undefined): boolean =>
  action === 'delete' || action === 'disable' || action === 'enable';

export const getServerCredentialMutationSyncKey = (
  snapshot: CredentialInspectionSnapshot,
  options: { requireLatestCompletedRun?: boolean } = {}
): string | null => {
  if (snapshot.source !== 'server') return null;

  const successfulMutations = snapshot.results
    .filter((result) => {
      if (result.actionStatus !== 'success') return false;
      return isCredentialMutationAction(result.executedAction || result.action);
    })
    .map((result) => `${result.runId}:${result.id}:${result.executedAction || result.action}`)
    .sort();
  if (successfulMutations.length === 0) return null;

  const runIds = new Set(
    snapshot.results
      .filter(
        (result) =>
          result.actionStatus === 'success' &&
          isCredentialMutationAction(result.executedAction || result.action)
      )
      .map((result) => result.runId)
  );
  if (runIds.size !== 1) return null;

  const runId = runIds.values().next().value;
  if (typeof runId !== 'number') return null;
  const run = snapshot.runs.find((item) => item.id === runId);
  if (!run || !isCompletedCredentialInspectionRun(run)) return null;

  if (options.requireLatestCompletedRun !== false) {
    const latestCompletedRun = snapshot.runs.find(isCompletedCredentialInspectionRun);
    if (!latestCompletedRun || latestCompletedRun.id !== runId) return null;
  }

  return [runId, run.finishedAtMs ?? 0, successfulMutations.join(',')].join('\u001f');
};
