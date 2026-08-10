import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UsageServiceStatus } from '@/services/api/usageService';
import { DatabaseStatusCard } from './DatabaseStatusCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join('|')}` : key,
    i18n: { language: 'en' },
  }),
}));

const status: UsageServiceStatus = {
  database: {
    databaseBytes: 1024 ** 3,
    walBytes: 64 * 1024 ** 2,
    shmBytes: 32 * 1024,
    totalBytes: 1024 ** 3 + 64 * 1024 ** 2 + 32 * 1024,
    journalSizeLimitBytes: 256 * 1024 ** 2,
    checkpoint: {
      mode: 'passive',
      busy: 0,
      logFrames: 24,
      checkpointedFrames: 24,
      executedAtMs: Date.UTC(2026, 7, 6, 4, 0, 0),
      durationMs: 112,
    },
  },
};

describe('DatabaseStatusCard', () => {
  it('renders the wide storage summary and latest checkpoint snapshot', () => {
    const markup = renderToStaticMarkup(
      <DatabaseStatusCard status={status} loading={false} error="" />
    );

    expect(markup).toContain('system_info.database_status_title');
    expect(markup).toContain('system_info.database_total_size');
    expect(markup).toContain('1.00 GB');
    expect(markup).toContain('64.00 MB');
    expect(markup).toContain('32.00 KB');
    expect(markup).toContain('256.00 MB');
    expect(markup).toContain('system_info.database_checkpoint_passive');
    expect(markup).toContain('system_info.database_checkpoint_frames:24|24');
    expect(markup).toContain('system_info.database_checkpoint_time:');
    expect(markup).not.toContain('system_info.database_checkpoint_error');
  });

  it('shows checkpoint errors without hiding the last file-size snapshot', () => {
    const markup = renderToStaticMarkup(
      <DatabaseStatusCard
        status={{
          database: {
            ...status.database,
            checkpoint: {
              ...status.database?.checkpoint,
              mode: 'truncate',
              busy: 1,
              error: 'checkpoint deadline exceeded',
            },
          },
        }}
        loading={false}
        error=""
      />
    );

    expect(markup).toContain('system_info.database_checkpoint_truncate');
    expect(markup).toContain('system_info.database_checkpoint_error');
    expect(markup).toContain('checkpoint deadline exceeded');
    expect(markup).toContain('64.00 MB');
  });

  it('labels a failed status request separately from a checkpoint failure', () => {
    const markup = renderToStaticMarkup(
      <DatabaseStatusCard status={null} loading={false} error="status request failed" />
    );

    expect(markup).toContain('system_info.database_status_error');
    expect(markup).toContain('status request failed');
    expect(markup).not.toContain('system_info.database_checkpoint_error');
  });

  it('treats a missing database payload as unavailable instead of a pending healthy checkpoint', () => {
    const markup = renderToStaticMarkup(
      <DatabaseStatusCard status={{ service: 'cpa-manager-plus' }} loading={false} error="" />
    );

    expect(markup).toContain('system_info.database_checkpoint_unavailable');
    expect(markup).not.toContain('system_info.database_checkpoint_pending');
    expect(markup).toContain('statusWarn');
  });

  it('treats a missing checkpoint snapshot as unavailable', () => {
    const markup = renderToStaticMarkup(
      <DatabaseStatusCard
        status={{ database: { databaseBytes: 1024, totalBytes: 1024 } }}
        loading={false}
        error=""
      />
    );

    expect(markup).toContain('system_info.database_checkpoint_unavailable');
    expect(markup).not.toContain('system_info.database_checkpoint_pending');
    expect(markup).toContain('statusWarn');
  });
});
