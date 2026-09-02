import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAccountCredentialMutationRevisionKey,
  publishAccountCredentialMutationRevision,
  useAccountCredentialMutationRevisionStore,
} from './useAccountCredentialMutationRevisionStore';

describe('account credential mutation revision store', () => {
  beforeEach(() => {
    useAccountCredentialMutationRevisionStore.getState().clearForTests();
  });

  it('increments only the affected connection and provider revision', () => {
    publishAccountCredentialMutationRevision({
      connectionFingerprint: 'connection-a',
      provider: 'codex',
      kind: 'quota',
      credentialIdentity: 'account-a',
    });
    publishAccountCredentialMutationRevision({
      connectionFingerprint: 'connection-a',
      provider: 'codex',
      kind: 'credential',
      credentialIdentity: 'account-a',
    });
    publishAccountCredentialMutationRevision({
      connectionFingerprint: 'connection-b',
      provider: 'codex',
      kind: 'oauth',
    });

    const events = useAccountCredentialMutationRevisionStore.getState().events;
    expect(
      events[buildAccountCredentialMutationRevisionKey('connection-a', 'codex')]
    ).toMatchObject({
      revision: 2,
      kind: 'credential',
      credentialIdentity: 'account-a',
    });
    expect(
      events[buildAccountCredentialMutationRevisionKey('connection-b', 'codex')]
    ).toMatchObject({ revision: 1, kind: 'oauth' });
  });

  it('normalizes provider aliases without storing credential secrets', () => {
    publishAccountCredentialMutationRevision({
      connectionFingerprint: 'opaque-fingerprint',
      provider: 'anthropic',
      kind: 'oauth',
    });

    const events = useAccountCredentialMutationRevisionStore.getState().events;
    const event = events[buildAccountCredentialMutationRevisionKey('opaque-fingerprint', 'claude')];
    expect(event.provider).toBe('claude');
    expect(JSON.stringify(event)).not.toContain('token');
  });
});
