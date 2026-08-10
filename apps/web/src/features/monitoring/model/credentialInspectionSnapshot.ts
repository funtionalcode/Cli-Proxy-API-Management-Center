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
  actionStatus: item.actionHandled ? 'executed' : 'pending',
  statusCode: item.statusCode ?? undefined,
  usedPercent: item.usedPercent ?? undefined,
  isQuota: item.isQuota,
  autoRecoverEligible: item.autoRecoverEligible,
  error: item.error,
  planType: item.planType,
  quotaWindows: item.quotaWindows,
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
): CredentialInspectionSnapshot => ({
  source: 'server',
  completedAtMs:
    detail.run.finishedAtMs || detail.run.updatedAtMs || detail.run.startedAtMs || Date.now(),
  results: detail.results.map((item) => ({ ...item, inspectionSource: 'server' })),
  runs,
});

export const selectLatestCredentialInspectionSnapshot = (
  snapshots: Array<CredentialInspectionSnapshot | null | undefined>
): CredentialInspectionSnapshot | null =>
  snapshots.reduce<CredentialInspectionSnapshot | null>((latest, candidate) => {
    if (!candidate) return latest;
    if (!latest || candidate.completedAtMs >= latest.completedAtMs) return candidate;
    return latest;
  }, null);

export const isCompletedCredentialInspectionRun = (run: CodexInspectionRun): boolean =>
  typeof run.finishedAtMs === 'number' && run.finishedAtMs > 0;
