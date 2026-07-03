import { describe, expect, it } from 'vitest';
import { buildProviderDraftKey, parseProviderIndexParam } from './routeParams';

describe('ai provider route params', () => {
  it('parses missing and numeric index params like the legacy edit pages', () => {
    expect(parseProviderIndexParam(undefined)).toBeNull();
    expect(parseProviderIndexParam('')).toBeNull();
    expect(parseProviderIndexParam('0')).toBe(0);
    expect(parseProviderIndexParam('12')).toBe(12);
  });

  it('preserves parseInt-compatible route behavior for legacy URLs', () => {
    expect(parseProviderIndexParam('3abc')).toBe(3);
    expect(parseProviderIndexParam('-1')).toBe(-1);
    expect(parseProviderIndexParam('abc')).toBeNull();
  });

  it('builds stable draft keys for new, edit, and invalid routes', () => {
    expect(buildProviderDraftKey('claude', null, false)).toBe('claude:new');
    expect(buildProviderDraftKey('claude', 2, false)).toBe('claude:2');
    expect(buildProviderDraftKey('claude', null, true, 'bad')).toBe('claude:invalid:bad');
  });
});
