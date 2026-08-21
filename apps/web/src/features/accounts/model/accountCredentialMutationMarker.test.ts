import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeAccountCredentialMutationMarkers,
  clearAccountCredentialMutationMarkersForTests,
  listAccountCredentialMutationMarkers,
  recordAccountCredentialMutationMarker,
} from './accountCredentialMutationMarker';

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe('account credential mutation markers', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: createMemoryStorage() });
    clearAccountCredentialMutationMarkersForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores only opaque connection fingerprints and normalized provider metadata', () => {
    const createdAtMs = Date.now();
    const marker = recordAccountCredentialMutationMarker({
      connectionFingerprint: 'v1:opaque-connection',
      provider: 'Grok',
      createdAtMs,
    });

    expect(marker).toMatchObject({
      connectionFingerprint: 'v1:opaque-connection',
      provider: 'xai',
      createdAtMs,
    });
    const rawStorage = window.sessionStorage.getItem('cpa.accounts.credential-mutation-markers.v1');
    expect(rawStorage).toContain('v1:opaque-connection');
    expect(rawStorage).not.toContain('http://');
    expect(rawStorage).not.toContain('management-key');
  });

  it('maps OAuth endpoint names to the Accounts provider identity', () => {
    recordAccountCredentialMutationMarker({
      connectionFingerprint: 'connection-a',
      provider: 'anthropic',
      createdAtMs: Date.now(),
    });

    expect(listAccountCredentialMutationMarkers('connection-a')[0]?.provider).toBe('claude');
  });

  it('isolates markers by connection and acknowledges only consumed ids', () => {
    const first = recordAccountCredentialMutationMarker({
      connectionFingerprint: 'connection-a',
      provider: 'codex',
      createdAtMs: Date.now(),
    });
    recordAccountCredentialMutationMarker({
      connectionFingerprint: 'connection-b',
      provider: 'codex',
      createdAtMs: Date.now(),
    });

    expect(listAccountCredentialMutationMarkers('connection-a')).toEqual([first]);
    acknowledgeAccountCredentialMutationMarkers(first ? [first.id] : []);
    expect(listAccountCredentialMutationMarkers('connection-a')).toEqual([]);
    expect(listAccountCredentialMutationMarkers('connection-b')).toHaveLength(1);
  });
});
