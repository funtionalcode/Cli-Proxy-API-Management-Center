import type { ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AccountLatestRequest } from './AccountLatestRequest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) =>
      ({
        'monitoring.fail_status_code_short': 'HTTP',
        'monitoring.result_failed': 'Failed',
        'monitoring.result_success': 'Success',
        'monitoring.header_error': 'Header error',
        'monitoring.header_trace': 'Trace',
        'accounts.latest_request_copy_details': 'Copy error details',
        'accounts.latest_request_time_title': 'Most recent request time',
        'accounts.latest_request_loading': 'Loading request',
        'accounts.latest_request_unavailable': 'Request record unavailable',
        'accounts.latest_request_empty': 'No request yet',
      })[key] ?? key,
  }),
}));

const readText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(readText).join('');
  if (value && typeof value === 'object') {
    if ('props' in value) {
      return readText((value as { props: { children?: unknown } }).props.children);
    }
    if ('children' in value) {
      return readText((value as { children?: unknown }).children);
    }
  }
  return '';
};

const renderLatestRequest = (
  props: Partial<ComponentProps<typeof AccountLatestRequest>> = {},
  timeWidth?: number
) => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<AccountLatestRequest onCopy={vi.fn()} {...props} />, {
      createNodeMock: (element) =>
        element.type === 'time' && typeof timeWidth === 'number'
          ? {
              getBoundingClientRect: () => ({ width: timeWidth }),
            }
          : null,
    });
  });
  return renderer!;
};

const containsText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAll((node) => readText(node.props.children).includes(text)).length > 0;

describe('AccountLatestRequest', () => {
  it('shows recent statuses from oldest to newest with a copyable failure tooltip', () => {
    const onCopy = vi.fn();
    const renderer = renderLatestRequest({
      onCopy,
      recentRequests: [
        {
          timestamp_ms: 1_700_000_003_000,
          failed: true,
          fail_status_code: 429,
          fail_summary: 'Authorization: Bearer private-request-token',
          header_error_kind: 'rate_limit',
          header_error_code: 'quota_exceeded',
          header_trace_id: 'trace-123',
        },
        { timestamp_ms: 1_700_000_002_000, failed: false },
        { timestamp_ms: 1_700_000_001_000, failed: true },
      ],
    });

    expect(
      renderer.root
        .findAll((node) => typeof node.props['data-request-status'] === 'string')
        .map((node) => node.props['data-request-status'])
    ).toEqual(['empty', 'empty', 'failed', 'success', 'failed']);
    expect(containsText(renderer, 'Status')).toBe(false);

    const trigger = renderer.root.findByProps({
      'aria-label': 'Failed · HTTP 429 · Authorization: [redacted] · rate_limit',
    });
    act(() => trigger.props.onClick());
    expect(readText(trigger.props.children)).toContain('HTTP 429');

    const copyButton = renderer.root.findByProps({ 'aria-label': 'Copy error details' });
    act(() => copyButton.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));

    expect(onCopy).toHaveBeenCalledWith(
      'HTTP 429\nAuthorization: [redacted]\nHeader error: rate_limit / quota_exceeded\nTrace: trace-123'
    );
  });

  it('uses the rendered time width to choose up to ten status slots', () => {
    const renderer = renderLatestRequest(
      {
        recentRequests: Array.from({ length: 10 }, (_, index) => ({
          timestamp_ms: 1_700_000_010_000 - index * 1_000,
          failed: index % 2 === 0,
        })),
      },
      95
    );
    const statusTrack = renderer.root.findByProps({
      'data-account-request-status-track': 'true',
    });

    expect(statusTrack.props['data-account-request-status-slot-count']).toBe(10);
    expect(
      statusTrack.findAll((node) => typeof node.props['data-request-status'] === 'string')
    ).toHaveLength(10);
  });

  it('falls back to the legacy latest request and uses neutral slots when no history exists', () => {
    const success = renderLatestRequest({
      latestRequest: { timestamp_ms: 1_700_000_000_000, failed: false },
    });
    expect(
      success.root
        .findAll((node) => typeof node.props['data-request-status'] === 'string')
        .map((node) => node.props['data-request-status'])
    ).toEqual(['empty', 'empty', 'empty', 'empty', 'success']);
    expect(success.root.findAllByType('svg')).toHaveLength(0);

    const empty = renderLatestRequest();
    expect(
      empty.root
        .findAll((node) => typeof node.props['data-request-status'] === 'string')
        .map((node) => node.props['data-request-status'])
    ).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
    expect(
      empty.root.findByProps({ 'data-account-request-status-track': 'true' }).props['aria-label']
    ).toBe('No request yet');

    const unavailable = renderLatestRequest({
      recentRequests: [{ timestamp_ms: 1_700_000_000_000, failed: false }],
      unavailable: true,
    });
    expect(
      unavailable.root
        .findAll((node) => typeof node.props['data-request-status'] === 'string')
        .map((node) => node.props['data-request-status'])
    ).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
    expect(
      unavailable.root.findByProps({ 'data-account-request-status-track': 'true' }).props[
        'aria-label'
      ]
    ).toBe('Request record unavailable');
  });

  it('shows seconds and exposes the complete timestamp in an immediate two-line tooltip', () => {
    const timestamp = new Date(2026, 6, 24, 12, 55, 42).getTime();
    const renderer = renderLatestRequest({
      latestRequest: { timestamp_ms: timestamp, failed: false },
    });
    const time = renderer.root.findByProps({ 'data-account-request-time': 'true' });
    const tooltipTrigger = renderer.root.findByProps({
      'data-account-request-time-tooltip': 'true',
    });
    const tooltipLabel = renderer.root.findByProps({
      'data-account-request-time-tooltip-label': 'true',
    });
    const tooltipValue = renderer.root.findByProps({
      'data-account-request-time-tooltip-value': 'true',
    });

    expect(readText(time)).toBe('07/24 12:55:42');
    expect(time.props.title).toBeUndefined();
    expect(time.props.dateTime).toBe(new Date(timestamp).toISOString());
    expect(readText(tooltipLabel)).toBe('Most recent request time');
    expect(readText(tooltipValue)).toBe('2026/07/24 12:55:42');
    expect(tooltipTrigger.props['aria-describedby']).toBeUndefined();

    act(() => tooltipTrigger.props.onMouseEnter());
    expect(tooltipTrigger.props['aria-describedby']).toEqual(expect.any(String));
  });
});
