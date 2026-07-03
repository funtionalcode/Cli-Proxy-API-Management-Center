import { describe, expect, it } from 'vitest';
import { normalizeCodexResetCreditsPayload } from './resetCredits';

describe('normalizeCodexResetCreditsPayload', () => {
  it('normalizes available Codex rate limit reset credits', () => {
    const result = normalizeCodexResetCreditsPayload({
      available_count: '2',
      credits: [
        {
          id: 123,
          reset_type: 'codex_rate_limits',
          status: 'available',
          granted_at: '2026-06-01T00:00:00Z',
          expires_at: '2026-06-30T00:00:00Z',
        },
        {
          id: 'used-credit',
          reset_type: 'codex_rate_limits',
          status: 'used',
          expires_at: '2026-06-30T00:00:00Z',
        },
        {
          id: 'other-credit',
          reset_type: 'other',
          status: 'available',
          expires_at: '2026-06-30T00:00:00Z',
        },
      ],
    });

    expect(result).toEqual({
      availableCount: 2,
      invalidPayload: false,
      credits: [
        {
          id: '123',
          status: 'available',
          grantedAt: '2026-06-01T00:00:00Z',
          expiresAt: '2026-06-30T00:00:00Z',
        },
      ],
    });
  });

  it('parses JSON string payloads and supports camelCase fields', () => {
    const result = normalizeCodexResetCreditsPayload(
      JSON.stringify({
        availableCount: 1,
        credits: [
          {
            id: 'credit-1',
            resetType: 'codex_rate_limits',
            status: 'available',
            grantedAt: '2026-06-01T00:00:00Z',
            expiresAt: '2026-06-30T00:00:00Z',
          },
        ],
      })
    );

    expect(result.availableCount).toBe(1);
    expect(result.credits[0]?.id).toBe('credit-1');
    expect(result.invalidPayload).toBe(false);
  });

  it('marks invalid payloads', () => {
    expect(normalizeCodexResetCreditsPayload('not-json')).toEqual({
      availableCount: null,
      credits: [],
      invalidPayload: true,
    });

    expect(normalizeCodexResetCreditsPayload({ unknown: true })).toEqual({
      availableCount: null,
      credits: [],
      invalidPayload: true,
    });
  });
});
