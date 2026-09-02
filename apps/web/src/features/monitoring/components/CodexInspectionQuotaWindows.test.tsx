import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { formatQuotaResetTime } from '@/utils/quota/formatters';
import { CodexInspectionQuotaWindows } from './CodexInspectionQuotaWindows';
import styles from '../CodexInspectionPage.module.scss';

const t = ((key: string, options?: Record<string, unknown>) => {
  if (options?.percent !== undefined) return `${key}:${options.percent}`;
  if (options?.time !== undefined) return `${key}:${options.time}`;
  return key;
}) as never;

const collectText = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.children[0] === 'string')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'));

describe('CodexInspectionQuotaWindows', () => {
  it('prefers the canonical reset timestamp over a server-formatted reset label', () => {
    const resetAtMs = Date.parse('2026-08-20T12:37:00Z');
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CodexInspectionQuotaWindows
          windows={[
            {
              id: 'five-hour',
              labelKey: 'five-hour',
              usedPercent: 3,
              resetLabel: '08/20 03:40',
              resetAtMs,
              resetAccuracy: 'exact',
            },
          ]}
          t={t}
        />
      );
    });

    const text = collectText(renderer!);
    expect(text).toContain(
      `monitoring.codex_inspection_quota_reset:${formatQuotaResetTime(resetAtMs)}`
    );
    expect(text).not.toContain('monitoring.codex_inspection_quota_reset:08/20 03:40');
  });

  it('falls back to a non-absolute reset label when no timestamp is available', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CodexInspectionQuotaWindows
          windows={[
            {
              id: 'five-hour',
              labelKey: 'five-hour',
              usedPercent: 3,
              resetLabel: '2h 18m',
              resetAtMs: null,
            },
          ]}
          t={t}
        />
      );
    });

    expect(collectText(renderer!)).toContain('monitoring.codex_inspection_quota_reset:2h 18m');
  });

  it('formats an ISO legacy reset label in the browser timezone', () => {
    const resetLabel = '2026-08-20T03:40:00Z';
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CodexInspectionQuotaWindows
          windows={[{ id: 'weekly', labelKey: 'weekly', usedPercent: 3, resetLabel }]}
          t={t}
        />
      );
    });

    expect(collectText(renderer!)).toContain(
      `monitoring.codex_inspection_quota_reset:${formatQuotaResetTime(resetLabel)}`
    );
  });

  it('omits the reset message when no reset information is available', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CodexInspectionQuotaWindows
          windows={[{ id: 'monthly', labelKey: 'monthly', usedPercent: 3, resetLabel: '-' }]}
          t={t}
        />
      );
    });

    expect(collectText(renderer!)).not.toContain('monitoring.codex_inspection_quota_reset');
  });

  it('shows the remaining percentage using the remaining-width progress bar', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CodexInspectionQuotaWindows
          windows={[{ id: 'monthly', labelKey: 'monthly', usedPercent: 3 }]}
          t={t}
        />
      );
    });

    expect(collectText(renderer!)).toContain('monitoring.codex_inspection_quota_remaining:97%');
    expect(renderer!.root.find((node) => node.props.style?.width).props.style.width).toBe('97%');
  });

  it('collapses quota windows without usage percentages into one unavailable state', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CodexInspectionQuotaWindows
          windows={[
            { id: 'weekly', labelKey: 'weekly', usedPercent: null },
            { id: 'monthly', labelKey: 'monthly', usedPercent: null },
          ]}
          t={t}
        />
      );
    });

    expect(collectText(renderer!)).toEqual(['monitoring.codex_inspection_quota_unavailable']);
    expect(
      renderer!.root.findAll((node) => node.props.className === styles.quotaWindowPlaceholderBar)
    ).toHaveLength(1);
  });
});
