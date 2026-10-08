import { describe, expect, it } from 'vitest';
import type { UsageArchiveRunSummary } from '@/services/api/usageService';
import {
  archiveHistoryFilterStatus,
  getArchiveRunAction,
  getArchiveRunPresentationStage,
  isArchiveRunCancellable,
  recommendRetentionDays,
  resolveArchiveProgressPresentation,
  pickFreshestArchiveStatus,
  resolveRawEventRange,
  resolveProgressPercent,
  resolveRetentionCutoff,
  toLocalDateTimeValue,
} from './usageMaintenanceModel';

const dayMS = 24 * 60 * 60 * 1000;

const archiveRun = (overrides: Partial<UsageArchiveRunSummary> = {}): UsageArchiveRunSummary => ({
  id: 'run',
  mode: 'manual',
  status: 'archiving',
  cutoff_timestamp_ms: 1,
  target_event_id: 100,
  event_count: 100,
  estimated_bytes: 100,
  last_archived_event_id: 0,
  archived_event_count: 0,
  archived_uncompressed_bytes: 0,
  archived_compressed_bytes: 0,
  last_deleted_event_id: 0,
  deleted_event_count: 0,
  created_at_ms: 1,
  updated_at_ms: 10,
  has_error: false,
  ...overrides,
});

describe('usage maintenance model', () => {
  it('resolves every persisted subphase and clamps real denominators', () => {
    for (const [phase, status, current, total, percent] of [
      ['archiving_records', 'archiving', 60, 100, 60],
      ['archive_finalizing', 'archiving', 12, 14, (12 / 14) * 100],
      ['archive_publishing', 'archiving', 0, 0, null],
      ['verifying_archive', 'verifying', 6, 14, (6 / 14) * 100],
      ['cleanup_revalidating', 'deleting', 8, 14, (8 / 14) * 100],
      ['deleting_records', 'deleting', 58, 100, 58],
      ['archive_finalizing', 'failed', 12, 14, (12 / 14) * 100],
      ['archive_finalizing', 'archiving', 0, 0, null],
      ['archive_finalizing', 'archiving', 20, 14, 100],
    ] as const) {
      const progress = resolveArchiveProgressPresentation(
        archiveRun({
          status,
          progress: { phase, current, total, unit: 'segments', updated_at_ms: 20 },
        })
      );
      expect(progress?.phase).toBe(phase);
      if (percent === null) expect(progress?.percent).toBeNull();
      else expect(progress?.percent).toBeCloseTo(percent);
      expect(progress?.updatedAtMS).toBe(20);
    }
  });

  it('uses safe indeterminate fallbacks for legacy finalizing, verify, and cleanup', () => {
    const cases = [
      [archiveRun({ archived_event_count: 50 }), 'archiving_records', 50],
      [archiveRun({ archived_event_count: 100 }), 'archive_publishing', null],
      [archiveRun({ status: 'verifying' }), 'verifying_archive', null],
      [archiveRun({ status: 'deleting' }), 'cleanup_preparing', null],
      [archiveRun({ status: 'deleting', deleted_event_count: 20 }), 'deleting_records', 20],
    ] as const;
    for (const [run, phase, percent] of cases) {
      const progress = resolveArchiveProgressPresentation(run);
      expect(progress?.phase).toBe(phase);
      expect(progress?.percent).toBe(percent);
    }
  });

  it('chooses the freshest archive snapshot, preferring operation on a tie', () => {
    const operation = {
      run: archiveRun({
        progress: { phase: 'archiving_records', current: 45, total: 100, updated_at_ms: 11 },
      }),
      segments: [],
    };
    const selected = {
      run: archiveRun({
        progress: { phase: 'archive_finalizing', current: 12, total: 14, updated_at_ms: 12 },
      }),
      segments: [],
    };
    expect(pickFreshestArchiveStatus(selected, operation)).toBe(selected);
    expect(pickFreshestArchiveStatus(operation, selected)).toBe(selected);
    expect(pickFreshestArchiveStatus(operation, operation)).toBe(operation);
    const completed = {
      run: archiveRun({ status: 'completed', progress: undefined }),
      segments: [],
    };
    const verified = { run: archiveRun({ status: 'verified', progress: undefined }), segments: [] };
    expect(pickFreshestArchiveStatus(verified, completed)).toBe(completed);
    expect(pickFreshestArchiveStatus(completed, verified)).toBe(completed);
  });
  it('resolves preset and valid custom retention cutoffs', () => {
    const nowMS = new Date('2026-08-18T12:00:00Z').getTime();
    expect(resolveRetentionCutoff(30, '', nowMS)).toBe(nowMS - 30 * dayMS);

    const custom = toLocalDateTimeValue(nowMS - 12 * dayMS);
    expect(resolveRetentionCutoff('custom', custom, nowMS)).toBe(nowMS - 12 * dayMS);
  });

  it('rejects invalid and future custom cutoffs', () => {
    const nowMS = new Date('2026-08-18T12:00:00Z').getTime();
    expect(resolveRetentionCutoff('custom', '', nowMS)).toBeNull();
    expect(resolveRetentionCutoff('custom', 'not-a-date', nowMS)).toBeNull();
    expect(resolveRetentionCutoff('custom', toLocalDateTimeValue(nowMS + dayMS), nowMS)).toBeNull();
  });

  it('distinguishes empty, compatible, and legacy raw ranges', () => {
    expect(resolveRawEventRange({ raw_event_count: 0 })).toEqual({ kind: 'empty' });
    expect(resolveRawEventRange({ raw_event_count: 10 })).toEqual({ kind: 'unavailable' });
    expect(
      resolveRawEventRange({
        raw_event_count: 10,
        raw_min_timestamp_ms: 1_000,
        raw_max_timestamp_ms: 3_000,
      })
    ).toEqual({ kind: 'available', minTimestampMS: 1_000, maxTimestampMS: 3_000 });
    expect(
      resolveRawEventRange({
        raw_event_count: 10,
        raw_min_timestamp_ms: 3_000,
        raw_max_timestamp_ms: 1_000,
      })
    ).toEqual({ kind: 'unavailable' });
  });

  it('recommends the longest preset that still matches at least one raw event', () => {
    const nowMS = new Date('2026-08-18T12:00:00Z').getTime();
    const range = (ageDays: number) =>
      resolveRawEventRange({
        raw_event_count: 10,
        raw_min_timestamp_ms: nowMS - ageDays * dayMS,
        raw_max_timestamp_ms: nowMS - dayMS,
      });

    expect(recommendRetentionDays(range(120), nowMS)).toBe(90);
    expect(recommendRetentionDays(range(45), nowMS)).toBe(30);
    expect(recommendRetentionDays(range(20), nowMS)).toBe(7);
    expect(recommendRetentionDays(range(3), nowMS)).toBeNull();
  });

  it('maps internal archive states to user-facing workflow stages', () => {
    expect(getArchiveRunPresentationStage({ status: 'previewed' })).toBe('archiving');
    expect(getArchiveRunPresentationStage({ status: 'failed', resume_status: 'verifying' })).toBe(
      'attention'
    );
    expect(getArchiveRunPresentationStage({ status: 'verified' })).toBe('delete_ready');
    expect(getArchiveRunPresentationStage({ status: 'deleting' })).toBe('deleting');
    expect(getArchiveRunPresentationStage({ status: 'completed' })).toBe('completed');
    expect(getArchiveRunPresentationStage({ status: 'cancelled' })).toBe('attention');
  });

  it('derives determinate progress only from valid non-zero totals', () => {
    expect(resolveProgressPercent(25, 100)).toBe(25);
    expect(resolveProgressPercent(120, 100)).toBe(100);
    expect(resolveProgressPercent(-1, 100)).toBeNull();
    expect(resolveProgressPercent(0, 0)).toBeNull();
    expect(resolveProgressPercent(Number.NaN, 100)).toBeNull();
  });

  it('maps history filters and workflow actions to exact API states', () => {
    expect(archiveHistoryFilterStatus('all')).toBeUndefined();
    expect(archiveHistoryFilterStatus('verified')).toBe('verified');
    expect(getArchiveRunAction('archived')).toBe('verify');
    expect(getArchiveRunAction('verified')).toBe('delete');
    expect(getArchiveRunAction('failed')).toBe('resume');
    expect(getArchiveRunAction('completed')).toBeNull();
  });

  it('only marks safe pre-delete archive runs as cancellable', () => {
    const base = { archived_event_count: 0, deleted_event_count: 0 };
    expect(isArchiveRunCancellable({ ...base, status: 'previewed' })).toBe(true);
    expect(isArchiveRunCancellable({ ...base, status: 'failed', resume_status: 'archiving' })).toBe(
      true
    );
    expect(
      isArchiveRunCancellable({
        ...base,
        status: 'failed',
        resume_status: 'archiving',
        archived_event_count: 1,
      })
    ).toBe(true);
    expect(
      isArchiveRunCancellable({
        ...base,
        status: 'failed',
        resume_status: 'verifying',
        archived_event_count: 1,
      })
    ).toBe(true);
    expect(isArchiveRunCancellable({ ...base, status: 'failed' })).toBe(true);
    expect(isArchiveRunCancellable({ ...base, status: 'failed', archived_event_count: 1 })).toBe(
      false
    );

    expect(isArchiveRunCancellable({ ...base, status: 'previewed', archived_event_count: 1 })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'archived', archived_event_count: 5 })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'archived', archived_event_count: 0 })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'verified', archived_event_count: 5 })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'verified', archived_event_count: 0 })).toBe(
      false
    );

    expect(
      isArchiveRunCancellable({
        ...base,
        status: 'failed',
        resume_status: 'deleting',
        archived_event_count: 5,
        deleted_event_count: 0,
      })
    ).toBe(false);
    expect(isArchiveRunCancellable({ ...base, status: 'failed', resume_status: 'deleting' })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'deleting', delete_started_at_ms: 1 })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'previewed', delete_started_at_ms: 1 })).toBe(
      false
    );
    expect(isArchiveRunCancellable({ ...base, status: 'previewed', deleted_event_count: 1 })).toBe(
      false
    );
    expect(
      isArchiveRunCancellable({ ...base, status: 'previewed', last_deleted_event_id: 1 })
    ).toBe(false);
    expect(isArchiveRunCancellable({ ...base, status: 'completed' })).toBe(false);
  });
});
