import { describe, expect, it } from 'vitest';
import { estimateWindowUsage } from './estimateWindowUsage';

describe('estimateWindowUsage', () => {
  it('projects request, token and cost totals from provider quota progress', () => {
    expect(
      estimateWindowUsage({
        usedPercent: 1,
        current: { requests: 2, tokens: 6_400, cost: 0.02 },
      })
    ).toEqual({ requests: 200, tokens: 640_000, cost: 2, basis: 'quota' });
  });

  it('rounds dynamic projections while preserving current actual minimums', () => {
    expect(
      estimateWindowUsage({
        usedPercent: 7,
        current: { requests: 1, tokens: 6_400, cost: 0.06 },
      })
    ).toEqual({ requests: 14, tokens: 91_429, cost: 0.86, basis: 'quota' });
  });

  it('returns current actual metrics when the provider quota is fully used', () => {
    expect(
      estimateWindowUsage({
        usedPercent: 100,
        current: { requests: 12, tokens: 34_500, cost: 1.23 },
      })
    ).toEqual({ requests: 12, tokens: 34_500, cost: 1.23, basis: 'quota' });
  });

  it('uses previous actual metrics when provider quota progress is unavailable', () => {
    expect(
      estimateWindowUsage({
        usedPercent: 0,
        current: { requests: 1, tokens: 10, cost: 0.01 },
        previous: { requests: 60, tokens: 600_000, cost: 6 },
      })
    ).toEqual({ requests: 60, tokens: 600_000, cost: 6, basis: 'previous' });
  });

  it('falls back instead of returning non-finite projections', () => {
    expect(
      estimateWindowUsage({
        usedPercent: Number.MIN_VALUE,
        current: { requests: 2, tokens: 6_400, cost: 0.02 },
        previous: { requests: 60, tokens: 600_000, cost: 6 },
      })
    ).toEqual({ requests: 60, tokens: 600_000, cost: 6, basis: 'previous' });
  });

  it('rejects non-finite current and previous metrics', () => {
    expect(
      estimateWindowUsage({
        usedPercent: 1,
        current: { requests: Number.POSITIVE_INFINITY, tokens: 6_400, cost: 0.02 },
        previous: { requests: 60, tokens: Number.NaN, cost: 6 },
      })
    ).toBeNull();
  });

  it('returns null without a usable actual basis', () => {
    expect(
      estimateWindowUsage({
        usedPercent: null,
        current: { requests: 2, tokens: 6_400, cost: 0.02 },
      })
    ).toBeNull();
  });
});
