import { describe, expect, it } from 'vitest';
import { maskQuotaAccountText, resolveQuotaAccountDisplayText } from './quotaDisplay';

describe('quotaDisplay', () => {
  it('masks email-like credential names and title text in masked mode', () => {
    const display = resolveQuotaAccountDisplayText(
      { name: 'very-long-account-name@example.com.json' },
      'masked'
    );

    expect(display.primary).toBe('ver***@example.com.json');
    expect(display.title).toBe('ver***@example.com.json');
    expect(display.title).not.toContain('very-long-account-name');
  });

  it('shows full credential names when full display mode is selected', () => {
    const display = resolveQuotaAccountDisplayText(
      { name: 'very-long-account-name@example.com.json' },
      'full'
    );

    expect(display.primary).toBe('very-long-account-name@example.com.json');
    expect(display.title).toBe('very-long-account-name@example.com.json');
  });

  it('masks key-like credential names before applying generic filename masking', () => {
    const masked = maskQuotaAccountText('sk-proj-secret-value-1234567890.json');

    expect(masked).not.toContain('secret-value');
    expect(masked).toMatch(/^sk\*+/);
  });

  it('falls back to compact masking for long non-email credential names', () => {
    expect(maskQuotaAccountText('personal-codex-account.json')).toBe('per***ount.json');
  });
});
