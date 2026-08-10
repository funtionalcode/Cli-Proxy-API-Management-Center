import { describe, expect, it } from 'vitest';
import { buildAccountLatestRequestFailureDetails } from './accountLatestRequest';

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === 'monitoring.fail_status_code_short') return 'HTTP';
  if (key === 'monitoring.result_failed') return 'Failed';
  if (key === 'monitoring.header_error') return 'Header error';
  if (key === 'monitoring.header_trace') return 'Trace';
  return String(options?.defaultValue ?? key);
};

describe('buildAccountLatestRequestFailureDetails', () => {
  it('preserves useful diagnostics while masking sensitive request text', () => {
    const details = buildAccountLatestRequestFailureDetails(
      {
        timestamp_ms: 1_700_000_000_000,
        failed: true,
        fail_status_code: 429,
        fail_summary: 'Authorization: Bearer private-request-token',
        header_error_kind: 'rate_limit',
        header_error_code: 'quota_exceeded',
        header_trace_id: 'trace-123',
      },
      t as never
    );

    expect(details).toEqual({
      statusText: 'HTTP 429',
      detailLines: [
        'Authorization: [redacted]',
        'Header error: rate_limit / quota_exceeded',
        'Trace: trace-123',
      ],
      copyText:
        'HTTP 429\nAuthorization: [redacted]\nHeader error: rate_limit / quota_exceeded\nTrace: trace-123',
      ariaLabel: 'Failed · HTTP 429 · Authorization: [redacted] · rate_limit',
    });
  });

  it('does not create a tooltip for successful requests or failures without diagnostics', () => {
    expect(
      buildAccountLatestRequestFailureDetails(
        { timestamp_ms: 1_700_000_000_000, failed: false },
        t as never
      )
    ).toBeNull();
    expect(
      buildAccountLatestRequestFailureDetails(
        { timestamp_ms: 1_700_000_000_000, failed: true },
        t as never
      )
    ).toBeNull();
  });
});
