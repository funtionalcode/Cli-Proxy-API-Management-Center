import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_LOG_PAGE_SIZE,
  REQUEST_LOG_PAGE_SIZE_OPTIONS,
  normalizeRequestLogPageSize,
} from './requestLogPagination';

describe('request log pagination', () => {
  it('accepts configured page sizes from the supported options', () => {
    expect(REQUEST_LOG_PAGE_SIZE_OPTIONS).toEqual([10, 20, 50, 100]);
    expect(normalizeRequestLogPageSize(50)).toBe(50);
  });

  it('falls back when a stored page size is unsupported', () => {
    expect(normalizeRequestLogPageSize(25)).toBe(DEFAULT_REQUEST_LOG_PAGE_SIZE);
    expect(normalizeRequestLogPageSize('100')).toBe(100);
  });
});
