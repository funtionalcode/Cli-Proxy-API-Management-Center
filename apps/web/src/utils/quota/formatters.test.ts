import { describe, expect, it } from 'vitest';
import { getStatusFromError } from './formatters';

describe('getStatusFromError', () => {
  it('reads numeric and numeric-string status values', () => {
    expect(getStatusFromError({ status: 429 })).toBe(429);
    expect(getStatusFromError({ status: '502' })).toBe(502);
  });

  it('returns undefined for values without a valid status', () => {
    expect(getStatusFromError(new Error('failed'))).toBeUndefined();
    expect(getStatusFromError({ status: 'not-a-status' })).toBeUndefined();
  });
});
