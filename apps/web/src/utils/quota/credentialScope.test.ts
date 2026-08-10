import { describe, expect, it } from 'vitest';
import type { ClaudeQuotaState } from '@/types';
import {
  buildQuotaCredentialIdentity,
  getCredentialScopedQuotaState,
  getQuotaCredentialStoreKey,
  scopeQuotaStateToCredential,
} from './credentialScope';

describe('quota credential scope', () => {
  it('builds provider-independent keys from credential identity', () => {
    const first = {
      name: 'shared.json',
      provider: 'claude',
      authIndex: 'auth-1',
    };
    const second = {
      name: 'shared.json',
      provider: 'claude',
      authIndex: 'auth-2',
    };

    expect(getQuotaCredentialStoreKey(first)).toBe('shared.json::auth-1');
    expect(getQuotaCredentialStoreKey(second)).toBe('shared.json::auth-2');
    expect(buildQuotaCredentialIdentity(first).authFileIdentityVerified).toBe(true);
  });

  it('marks filename-only identities as unverified', () => {
    expect(
      buildQuotaCredentialIdentity({ name: 'legacy.json', provider: 'kimi' })
        .authFileIdentityVerified
    ).toBe(false);
  });

  it('rejects legacy or mismatched quota state without credential identity', () => {
    const file = { name: 'shared.json', provider: 'claude', authIndex: 'auth-1' };
    const matching: ClaudeQuotaState = {
      status: 'success',
      windows: [],
      authFileKey: 'shared.json::auth-1',
    };
    const mismatched: ClaudeQuotaState = {
      ...matching,
      authFileKey: 'shared.json::auth-2',
    };

    expect(scopeQuotaStateToCredential(file, matching)).toBe(matching);
    expect(scopeQuotaStateToCredential(file, mismatched)).toBeUndefined();
    expect(
      scopeQuotaStateToCredential<ClaudeQuotaState>(file, {
        status: 'success',
        windows: [],
      })
    ).toBeUndefined();
  });

  it('migrates a correctly identified state stored under its old filename key', () => {
    const file = { name: 'shared.json', provider: 'claude', authIndex: 'auth-1' };
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [],
      authFileKey: 'shared.json::auth-1',
    };

    expect(getCredentialScopedQuotaState({ [file.name]: quota }, file)).toBe(quota);
  });
});
