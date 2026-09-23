import { describe, expect, it } from 'vitest';
import type { AuthFileType } from '@/types';
import { isMetaFile } from '@/utils/quota/validators';
import {
  getAuthFileIcon,
  getTypeColor,
  getTypeLabel,
  isQuotaRefreshSupportedProvider,
  normalizeProviderKey,
  QUOTA_PROVIDER_TYPES,
} from './constants';

describe('authFiles constants - devin', () => {
  it('returns valid distinct light and dark icons for devin', () => {
    const light = getAuthFileIcon('devin', 'light');
    const dark = getAuthFileIcon('devin', 'dark');

    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(light).not.toBe(dark);
  });

  it('returns correct type colors for devin in light and dark mode', () => {
    expect(getTypeColor('devin', 'light')).toEqual({
      bg: '#e8f4ff',
      text: '#155e9b',
    });
    expect(getTypeColor('devin', 'dark')).toEqual({
      bg: '#123b5d',
      text: '#8dc9f5',
    });
  });

  it('supports devin as AuthFileType', () => {
    const type: AuthFileType = 'devin';
    expect(type).toBe('devin');
  });
});

describe('authFiles constants - meta', () => {
  it('returns valid icon for meta in light and dark mode and resolves muse alias', () => {
    const light = getAuthFileIcon('meta', 'light');
    const dark = getAuthFileIcon('meta', 'dark');
    const museLight = getAuthFileIcon('muse', 'light');

    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(museLight).toBe(light);
  });

  it('returns correct type colors for meta in light and dark mode', () => {
    expect(getTypeColor('meta', 'light')).toEqual({
      bg: '#e5f2ff',
      text: '#0064e0',
    });
    expect(getTypeColor('meta', 'dark')).toEqual({
      bg: '#0b3564',
      text: '#70b5ff',
    });
  });

  it('supports meta as AuthFileType', () => {
    const type: AuthFileType = 'meta';
    expect(type).toBe('meta');
  });

  it('normalizes provider keys and aliases correctly', () => {
    expect(normalizeProviderKey('meta')).toBe('meta');
    expect(normalizeProviderKey('muse')).toBe('meta');
    expect(normalizeProviderKey('MUSE')).toBe('meta');
  });

  it('includes meta in QUOTA_PROVIDER_TYPES in phase 2', () => {
    expect((QUOTA_PROVIDER_TYPES as Set<string>).has('meta')).toBe(true);
  });

  it('resolves type label for meta as Muse (Meta)', () => {
    const t = ((key: string) => key) as unknown as Parameters<typeof getTypeLabel>[0];
    expect(getTypeLabel(t, 'meta')).toBe('Muse (Meta)');
    expect(getTypeLabel(t, 'muse')).toBe('Muse (Meta)');
  });

  it('validates meta files using isMetaFile', () => {
    expect(isMetaFile({ name: 'meta-test.json', provider: 'meta' })).toBe(true);
    expect(isMetaFile({ name: 'muse-test.json', type: 'muse' })).toBe(true);
    expect(isMetaFile({ name: 'codex.json', provider: 'codex' })).toBe(false);
  });

  it('correctly evaluates quota refresh eligibility via isQuotaRefreshSupportedProvider', () => {
    // Meta / Muse is quota-refreshable in phase 2
    expect(isQuotaRefreshSupportedProvider('meta')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('muse')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('META')).toBe(true);

    // Supported providers (including Devin)
    expect(isQuotaRefreshSupportedProvider('devin')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('codex')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('claude')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('antigravity')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('kimi')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('xai')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('x-ai')).toBe(true);
    expect(isQuotaRefreshSupportedProvider('grok')).toBe(true);

    // Other non-quota providers
    expect(isQuotaRefreshSupportedProvider('vertex')).toBe(false);
    expect(isQuotaRefreshSupportedProvider('qwen')).toBe(false);
    expect(isQuotaRefreshSupportedProvider('iflow')).toBe(false);
    expect(isQuotaRefreshSupportedProvider('')).toBe(false);
  });
});
