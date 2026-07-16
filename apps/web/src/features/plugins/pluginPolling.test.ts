import { describe, expect, it } from 'vitest';
import type { PluginStoreEntry } from '@/types';
import { isPluginStoreInstallSettled } from './pluginPolling';

const createStoreEntry = (patch: Partial<PluginStoreEntry> = {}): PluginStoreEntry => ({
  storeId: 'official/demo-plugin',
  sourceId: 'official',
  sourceName: 'official',
  sourceUrl: 'https://example.test/registry.json',
  id: 'demo-plugin',
  name: 'Demo Plugin',
  description: '',
  author: '',
  version: '1.0.0',
  repository: 'router-for-me/demo-plugin',
  installType: 'github-release',
  authRequired: false,
  authConfigured: false,
  platforms: [],
  logo: '',
  homepage: '',
  license: '',
  tags: [],
  installed: true,
  installedVersion: '1.0.0',
  path: 'plugins/demo-plugin-v1.0.0.so',
  configured: true,
  registered: true,
  enabled: true,
  effectiveEnabled: true,
  updateAvailable: false,
  ...patch,
});

describe('plugin store install polling helpers', () => {
  it('settles unpinned installs only when no update remains available', () => {
    expect(isPluginStoreInstallSettled(createStoreEntry())).toBe(true);
    expect(isPluginStoreInstallSettled(createStoreEntry({ updateAvailable: true }))).toBe(false);
  });

  it('settles explicit version installs even when CPA still reports an update', () => {
    expect(
      isPluginStoreInstallSettled(
        createStoreEntry({
          installedVersion: '0.3.0',
          version: '0.4.0',
          updateAvailable: true,
        }),
        'v0.3.0'
      )
    ).toBe(true);
  });

  it('keeps waiting when the requested version is not installed yet', () => {
    expect(
      isPluginStoreInstallSettled(
        createStoreEntry({
          installedVersion: '0.2.0',
          version: '0.4.0',
          updateAvailable: true,
        }),
        '0.3.0'
      )
    ).toBe(false);
  });
});
