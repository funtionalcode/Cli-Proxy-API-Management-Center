import { describe, expect, it } from 'vitest';
import { resolveAccountReauthAction } from './accountReauth';

describe('accountReauth', () => {
  it('keeps Codex on the dedicated reauth dialog', () => {
    expect(resolveAccountReauthAction({ name: 'codex.json', type: 'codex' })).toEqual({
      kind: 'codex-dialog',
    });
  });

  it('routes supported providers to their OAuth login paths', () => {
    expect(resolveAccountReauthAction({ name: 'xai.json', type: 'xai' })).toEqual({
      kind: 'navigate',
      oauthProvider: 'xai',
      path: '/oauth#oauth-provider-xai',
    });
    expect(resolveAccountReauthAction({ name: 'claude.json', type: 'claude' })).toEqual({
      kind: 'navigate',
      oauthProvider: 'anthropic',
      path: '/oauth#oauth-provider-anthropic',
    });
    expect(resolveAccountReauthAction({ name: 'devin.json', type: 'devin' })).toEqual({
      kind: 'navigate',
      oauthProvider: 'devin',
      path: '/oauth#oauth-provider-devin',
    });
    expect(resolveAccountReauthAction({ name: 'antigravity.json', type: 'antigravity' })).toEqual({
      kind: 'navigate',
      oauthProvider: 'antigravity',
      path: '/oauth#oauth-provider-antigravity',
    });
    expect(resolveAccountReauthAction({ name: 'kimi.json', type: 'kimi' })).toEqual({
      kind: 'navigate',
      oauthProvider: 'kimi',
      path: '/oauth#oauth-provider-kimi',
    });
  });

  it('returns unsupported reauth action for Meta and Muse credentials', () => {
    expect(
      resolveAccountReauthAction({
        name: 'meta-account.json',
        provider: 'meta',
      })
    ).toEqual({
      kind: 'unsupported',
      provider: 'meta',
    });

    expect(
      resolveAccountReauthAction({
        name: 'muse-account.json',
        provider: 'muse',
      })
    ).toEqual({
      kind: 'unsupported',
      provider: 'meta',
    });
  });

  it('returns an explicit unsupported action for providers without OAuth login', () => {
    expect(resolveAccountReauthAction({ name: 'vertex.json', type: 'vertex' })).toEqual({
      kind: 'unsupported',
      provider: 'vertex',
    });
  });
});
