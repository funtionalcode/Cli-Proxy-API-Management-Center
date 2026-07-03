import type { AuthFileItem } from '@/types';
import {
  type CodexInspectionAccount,
  type CodexInspectionProgressSnapshot,
  type CodexInspectionProgressStatus,
  type CodexInspectionProgressSummary,
  type CodexInspectionResultItem,
  type CodexInspectionSettings,
  type CodexInspectionSummary,
} from '@/features/monitoring/codexInspection';

export const createEmptyProgressSummary = (): CodexInspectionProgressSummary => ({
  totalFiles: 0,
  probeSetCount: 0,
  sampledCount: 0,
  deleteCount: 0,
  disableCount: 0,
  enableCount: 0,
  reauthCount: 0,
  keepCount: 0,
});

export const buildProgressSummary = (
  files: AuthFileItem[],
  probeSet: CodexInspectionAccount[],
  sampledAccounts: CodexInspectionAccount[],
  results: CodexInspectionResultItem[]
): CodexInspectionProgressSummary => {
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const reauthCount = results.filter((item) => item.action === 'reauth').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount - reauthCount;

  return {
    totalFiles: files.length,
    probeSetCount: probeSet.length,
    sampledCount: sampledAccounts.length,
    deleteCount,
    disableCount,
    enableCount,
    reauthCount,
    keepCount,
  };
};

export const createProgressSnapshot = (
  total: number,
  completed: number,
  inFlight: number,
  status: CodexInspectionProgressStatus,
  startedAt: number,
  updatedAt: number = Date.now(),
  summary: CodexInspectionProgressSummary = createEmptyProgressSummary()
): CodexInspectionProgressSnapshot => {
  const pending = Math.max(0, total - completed - inFlight);

  return {
    total,
    completed,
    inFlight,
    pending,
    percent: total <= 0 ? 0 : Math.round((Math.min(total, completed) / total) * 100),
    status,
    summary,
    startedAt,
    updatedAt,
  };
};

export const buildSummary = (
  files: AuthFileItem[],
  sampledAccounts: CodexInspectionAccount[],
  results: CodexInspectionResultItem[],
  settings: CodexInspectionSettings
): CodexInspectionSummary => {
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const reauthCount = results.filter((item) => item.action === 'reauth').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount - reauthCount;
  const preview = results
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    totalFiles: files.length,
    probeSetCount: sampledAccounts.length,
    sampledCount: results.length,
    disabledCount: sampledAccounts.filter((item) => item.disabled).length,
    enabledCount: sampledAccounts.filter((item) => !item.disabled).length,
    deleteCount,
    disableCount,
    enableCount,
    reauthCount,
    keepCount,
    usedPercentThreshold: settings.usedPercentThreshold,
    sampled: settings.sampleSize > 0 && settings.sampleSize < sampledAccounts.length,
    plannedActionPreview: preview,
  };
};
