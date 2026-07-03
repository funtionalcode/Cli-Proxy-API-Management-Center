import { describe, expect, it } from 'vitest';
import { parseLatencyBoundary } from './useLogFilters';

describe('parseLatencyBoundary', () => {
  it('accepts non-negative numeric latency boundaries', () => {
    expect(parseLatencyBoundary('0')).toBe(0);
    expect(parseLatencyBoundary('123.5')).toBe(123.5);
  });

  it('ignores empty, negative, and non-numeric latency boundaries', () => {
    expect(parseLatencyBoundary('')).toBeUndefined();
    expect(parseLatencyBoundary('-1')).toBeUndefined();
    expect(parseLatencyBoundary('slow')).toBeUndefined();
  });
});
