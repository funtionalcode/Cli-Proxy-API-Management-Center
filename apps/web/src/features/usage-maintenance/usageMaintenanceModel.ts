import type { UsageArchiveRunSummary, UsageArchiveStatus } from '@/services/api/usageService';

export const retentionPresetDays = [7, 30, 90] as const;

export type RetentionPresetDays = (typeof retentionPresetDays)[number];
export type RetentionSelection = RetentionPresetDays | 'custom';

export type ArchiveRunPresentationStage =
  | 'archiving'
  | 'verifying'
  | 'delete_ready'
  | 'deleting'
  | 'completed'
  | 'attention';

export type UsageMaintenanceView =
  | 'overview'
  | 'create'
  | 'active'
  | 'history'
  | 'detail'
  | 'transfer'
  | 'advanced'
  | 'diagnostics';

export type ArchiveHistoryFilter =
  | 'all'
  | 'previewed'
  | 'archiving'
  | 'archived'
  | 'verifying'
  | 'verified'
  | 'deleting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ArchiveHistorySource = 'all' | 'manual' | 'retention';

export type ArchiveRunAction = 'resume' | 'verify' | 'delete' | 'cancel';

export type RawEventRangeState =
  | { kind: 'empty' }
  | { kind: 'unavailable' }
  | {
      kind: 'available';
      minTimestampMS: number;
      maxTimestampMS: number;
    };

const dayMS = 24 * 60 * 60 * 1000;

export const toLocalDateTimeValue = (timestampMS: number) => {
  if (!Number.isFinite(timestampMS) || timestampMS <= 0) return '';
  const date = new Date(timestampMS);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export const resolveRetentionCutoff = (
  selection: RetentionSelection,
  customCutoff: string,
  nowMS: number
): number | null => {
  if (!Number.isFinite(nowMS) || nowMS <= 0) return null;
  if (selection !== 'custom') {
    const cutoffTimestampMS = nowMS - selection * dayMS;
    return cutoffTimestampMS > 0 ? cutoffTimestampMS : null;
  }

  const cutoffTimestampMS = new Date(customCutoff).getTime();
  if (!Number.isFinite(cutoffTimestampMS) || cutoffTimestampMS <= 0 || cutoffTimestampMS > nowMS) {
    return null;
  }
  return cutoffTimestampMS;
};

export const resolveRawEventRange = (status: {
  raw_event_count: number;
  raw_min_timestamp_ms?: number;
  raw_max_timestamp_ms?: number;
}): RawEventRangeState => {
  if (status.raw_event_count <= 0) return { kind: 'empty' };
  const minTimestampMS = status.raw_min_timestamp_ms;
  const maxTimestampMS = status.raw_max_timestamp_ms;
  if (
    !Number.isFinite(minTimestampMS) ||
    !Number.isFinite(maxTimestampMS) ||
    !minTimestampMS ||
    !maxTimestampMS ||
    minTimestampMS > maxTimestampMS
  ) {
    return { kind: 'unavailable' };
  }
  return { kind: 'available', minTimestampMS, maxTimestampMS };
};

export const recommendRetentionDays = (
  range: RawEventRangeState,
  nowMS: number
): RetentionPresetDays | null => {
  if (range.kind !== 'available') return null;
  return (
    [...retentionPresetDays]
      .reverse()
      .find((days) => nowMS - days * dayMS > range.minTimestampMS) ?? null
  );
};

export const getArchiveRunPresentationStage = (run: {
  status: string;
  resume_status?: string;
}): ArchiveRunPresentationStage => {
  if (run.status === 'completed') return 'completed';
  if (run.status === 'verified') return 'delete_ready';
  if (run.status === 'failed' || run.status === 'cancelled') return 'attention';
  if (run.status === 'deleting' || run.resume_status === 'deleting') return 'deleting';
  if (
    run.status === 'archived' ||
    run.status === 'verifying' ||
    run.resume_status === 'verifying'
  ) {
    return 'verifying';
  }
  return run.status === 'previewed' || run.status === 'archiving' ? 'archiving' : 'attention';
};

export const resolveProgressPercent = (completed: number, total: number): number | null => {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || completed < 0 || total <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (completed / total) * 100));
};

export interface ArchiveProgressPresentation {
  phase: string;
  labelKey: string;
  current: number;
  total: number;
  unit: 'events' | 'segments' | null;
  percent: number | null;
  updatedAtMS?: number;
}

const archiveProgressLabels: Record<string, string> = {
  archiving_records: 'usage_maintenance.progress_archiving_records',
  archive_finalizing: 'usage_maintenance.progress_archive_finalizing',
  archive_publishing: 'usage_maintenance.progress_archive_publishing',
  verifying_archive: 'usage_maintenance.progress_verifying_archive',
  cleanup_revalidating: 'usage_maintenance.progress_cleanup_revalidating',
  deleting_records: 'usage_maintenance.progress_deleting_records',
};

export const resolveArchiveProgressPresentation = (
  run: UsageArchiveRunSummary
): ArchiveProgressPresentation | null => {
  let phase = run.progress?.phase;
  let current = run.progress?.current ?? 0;
  let total = run.progress?.total ?? 0;
  let unit: 'events' | 'segments' | null =
    run.progress?.unit === 'events' || run.progress?.unit === 'segments' ? run.progress.unit : null;
  if (!phase || !archiveProgressLabels[phase]) {
    if (run.status === 'archiving' || run.resume_status === 'archiving') {
      phase =
        run.event_count > 0 && run.archived_event_count >= run.event_count
          ? 'archive_publishing'
          : 'archiving_records';
      current = run.archived_event_count;
      total = phase === 'archiving_records' ? run.event_count : 0;
      unit = phase === 'archiving_records' ? 'events' : null;
    } else if (run.status === 'verifying' || run.resume_status === 'verifying') {
      phase = 'verifying_archive';
    } else if (run.status === 'deleting' || run.resume_status === 'deleting') {
      phase = run.deleted_event_count > 0 ? 'deleting_records' : 'cleanup_preparing';
      current = run.deleted_event_count;
      total = phase === 'deleting_records' ? run.event_count : 0;
      unit = phase === 'deleting_records' ? 'events' : null;
    } else {
      return null;
    }
  }
  return {
    phase,
    labelKey: archiveProgressLabels[phase] ?? 'usage_maintenance.progress_cleanup_preparing',
    current,
    total,
    unit,
    percent: resolveProgressPercent(current, total),
    updatedAtMS: run.progress?.updated_at_ms,
  };
};

export const pickFreshestArchiveStatus = (
  selected: UsageArchiveStatus | null,
  operation: UsageArchiveStatus | null
): UsageArchiveStatus | null => {
  if (!selected) return operation;
  if (!operation || selected.run.id !== operation.run.id) return selected;
  const freshness = (status: UsageArchiveStatus) =>
    Math.max(status.run.progress?.updated_at_ms ?? 0, status.run.updated_at_ms);
  const selectedTime = freshness(selected);
  const operationTime = freshness(operation);
  if (selectedTime !== operationTime) return selectedTime > operationTime ? selected : operation;
  const statusOrder = [
    'previewed',
    'archiving',
    'archived',
    'verifying',
    'verified',
    'deleting',
    'completed',
  ];
  const selectedStatus = statusOrder.indexOf(selected.run.status);
  const operationStatus = statusOrder.indexOf(operation.run.status);
  if (selectedStatus !== operationStatus && selectedStatus >= 0 && operationStatus >= 0) {
    return selectedStatus > operationStatus ? selected : operation;
  }
  const phaseOrder = [
    'archiving_records',
    'archive_finalizing',
    'archive_publishing',
    'verifying_archive',
    'cleanup_revalidating',
    'deleting_records',
  ];
  const selectedPhase = phaseOrder.indexOf(selected.run.progress?.phase ?? '');
  const operationPhase = phaseOrder.indexOf(operation.run.progress?.phase ?? '');
  if (selectedPhase !== operationPhase && selectedPhase >= 0 && operationPhase >= 0) {
    return selectedPhase > operationPhase ? selected : operation;
  }
  if (
    selectedPhase === operationPhase &&
    selected.run.progress?.current !== operation.run.progress?.current
  ) {
    return (selected.run.progress?.current ?? 0) > (operation.run.progress?.current ?? 0)
      ? selected
      : operation;
  }
  return operation;
};

export const archiveHistoryFilterStatus = (filter: ArchiveHistoryFilter): string | undefined =>
  filter === 'all' ? undefined : filter;

export const getArchiveRunAction = (status: string): ArchiveRunAction | null => {
  if (
    status === 'previewed' ||
    status === 'archiving' ||
    status === 'verifying' ||
    status === 'deleting' ||
    status === 'failed'
  ) {
    return 'resume';
  }
  if (status === 'archived') return 'verify';
  if (status === 'verified') return 'delete';
  return null;
};

export const isArchiveRunCancellable = (run: {
  status: string;
  resume_status?: string;
  requested_stage?: string;
  archived_event_count: number;
  deleted_event_count: number;
  last_deleted_event_id?: number;
  delete_started_at_ms?: number;
}): boolean => {
  if (
    run.deleted_event_count > 0 ||
    (run.last_deleted_event_id ?? 0) > 0 ||
    (run.delete_started_at_ms ?? 0) > 0
  ) {
    return false;
  }
  if (run.status === 'deleting' || run.resume_status === 'deleting') return false;
  if (run.status === 'failed') {
    if (run.resume_status === 'archiving' || run.resume_status === 'verifying') {
      return true;
    }
    if (!run.resume_status) {
      return run.archived_event_count <= 0;
    }
    return false;
  }
  if (run.archived_event_count > 0) return false;
  if (run.status === 'previewed') return true;
  return false;
};
