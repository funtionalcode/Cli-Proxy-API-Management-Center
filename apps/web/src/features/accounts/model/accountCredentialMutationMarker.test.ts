import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import {
  acknowledgeAccountCredentialMutationMarkers,
  clearAccountCredentialMutationMarkersForTests,
  createAccountCredentialMutationBaseline,
  hasAccountCredentialMutationEvidence,
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
    const rawStorage = window.sessionStorage.getItem('cpa.accounts.credential-mutation-markers.v2');
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

  it('requires post-baseline credential evidence for OAuth markers', () => {
    const existing = [
      {
        id: 'runtime-a',
        name: 'codex-a.json',
        provider: 'codex',
        authIndex: 'auth-a',
        account_id: 'account-a',
        modified: 1_000,
      },
      {
        id: 'runtime-b',
        name: 'codex-b.json',
        provider: 'codex',
        authIndex: 'auth-b',
        account_id: 'account-b',
        modified: 1_000,
      },
    ] as AuthFileItem[];
    const baseline = createAccountCredentialMutationBaseline(existing, 'codex');
    const marker = recordAccountCredentialMutationMarker({
      connectionFingerprint: 'connection-a',
      provider: 'codex',
      baseline,
      requireObservedMutation: true,
      createdAtMs: Date.now(),
    });
    expect(marker).not.toBeNull();
    expect(hasAccountCredentialMutationEvidence(marker!, existing)).toBe(false);
    expect(
      hasAccountCredentialMutationEvidence(marker!, [
        { ...existing[0], status_message: 'token_expired' },
        existing[1],
      ])
    ).toBe(false);

    const created = {
      id: 'runtime-c',
      name: 'codex-c.json',
      provider: 'codex',
      authIndex: 'auth-c',
      account_id: 'account-c',
      modified: 2_000,
    } as AuthFileItem;
    expect(hasAccountCredentialMutationEvidence(marker!, [...existing, created])).toBe(true);
  });

  it('fails closed when an OAuth marker has no captured baseline', () => {
    expect(
      recordAccountCredentialMutationMarker({
        connectionFingerprint: 'connection-a',
        provider: 'codex',
        requireObservedMutation: true,
        createdAtMs: Date.now(),
      })
    ).toBeNull();
  });
});
