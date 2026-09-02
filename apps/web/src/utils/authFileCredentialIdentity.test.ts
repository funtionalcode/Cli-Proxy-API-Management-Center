import { describe, expect, it } from 'vitest';
import { resolveCredentialIdentity } from './authFileCredentialIdentity';

describe('credentialIdentity', () => {
  it('normalizes the complete credential identity from one auth-file row', () => {
    expect(
      resolveCredentialIdentity({
        id: ' runtime-1 ',
        name: ' shared.json ',
        provider: 'x_ai',
        authIndex: 42,
        project_id: ' project-1 ',
        email: ' user@example.com ',
        label: ' Primary ',
      })
    ).toEqual({
      physicalName: 'shared.json',
      runtimeId: 'runtime-1',
      authIndex: '42',
      provider: 'xai',
      accountId: 'project-1',
      accountSnapshot: 'user@example.com',
      authLabelSnapshot: 'Primary',
    });
  });

  it('honors explicit identity snapshots supplied by an async target', () => {
    expect(
      resolveCredentialIdentity({
        name: 'shared.json',
        type: 'codex',
        account: 'stale@example.com',
        accountSnapshot: 'current@example.com',
        authLabelSnapshot: 'Current label',
        accountId: 'account-current',
        authIndex: 'auth-current',
      })
    ).toMatchObject({
      physicalName: 'shared.json',
      provider: 'codex',
      accountId: 'account-current',
      accountSnapshot: 'current@example.com',
      authLabelSnapshot: 'Current label',
      authIndex: 'auth-current',
    });
  });

  it('does not treat generic Codex project or sub fields as a ChatGPT account id', () => {
    expect(
      resolveCredentialIdentity({
        name: 'codex.json',
        provider: 'codex',
        authIndex: 'auth-1',
        project_id: 'project-x',
        sub: 'user-x',
      })
    ).toMatchObject({ provider: 'codex', accountId: '' });
  });

  it('reads an explicit Codex ChatGPT account id from token metadata', () => {
    expect(
      resolveCredentialIdentity({
        name: 'codex.json',
        provider: 'codex',
        authIndex: 'auth-1',
        metadata: { id_token: { chatgpt_account_id: ' account-a ' } },
      })
    ).toMatchObject({ provider: 'codex', accountId: 'account-a' });
  });
});