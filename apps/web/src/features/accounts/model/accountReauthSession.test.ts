import { describe, expect, it } from 'vitest';
import {
  beginAccountOAuthReauthSession,
  buildAccountOAuthReauthPath,
  completeAccountOAuthReauthSession,
  completeAccountOAuthReauthSessionFromSearch,
  readAccountOAuthReauthSessionId,
  readCompletedAccountReauthResultKeys,
  recordCompletedAccountReauthSession,
} from './accountReauthSession';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe('accountReauthSession', () => {
  it('carries a pending account reauth through the OAuth route and completes the exact scope', () => {
    const storage = createStorage();
    const sessionId = beginAccountOAuthReauthSession(
      {
        connectionFingerprint: 'connection-a',
        oauthProvider: 'xai',
        resultKeys: ['old-result', 'old-result'],
        createdAtMs: 1_000,
        sessionId: 'session-1',
      },
      storage
    );

    expect(sessionId).toBe('session-1');
    const path = buildAccountOAuthReauthPath('xai', sessionId);
    expect(path).toBe('/oauth?accountReauth=session-1#oauth-provider-xai');
    expect(readAccountOAuthReauthSessionId('?accountReauth=session-1')).toBe('session-1');
    expect(readCompletedAccountReauthResultKeys('connection-a', storage, 1_500)).toEqual(new Set());

    expect(
      completeAccountOAuthReauthSessionFromSearch(
        '?accountReauth=session-1',
        'xai',
        'connection-a',
        storage,
        2_000
      )
    ).toBe(true);
    expect(readCompletedAccountReauthResultKeys('connection-a', storage, 2_500)).toEqual(
      new Set(['old-result'])
    );
    expect(readCompletedAccountReauthResultKeys('connection-b', storage, 2_500)).toEqual(new Set());
  });

  it('does not complete a session for another provider or connection', () => {
    const storage = createStorage();
    beginAccountOAuthReauthSession(
      {
        connectionFingerprint: 'connection-a',
        oauthProvider: 'anthropic',
        resultKeys: ['old-anthropic-result'],
        createdAtMs: 1_000,
        sessionId: 'session-2',
      },
      storage
    );

    expect(
      completeAccountOAuthReauthSession(
        {
          connectionFingerprint: 'connection-a',
          oauthProvider: 'xai',
          sessionId: 'session-2',
          completedAtMs: 2_000,
        },
        storage
      )
    ).toBe(false);
    expect(
      completeAccountOAuthReauthSession(
        {
          connectionFingerprint: 'connection-b',
          oauthProvider: 'anthropic',
          sessionId: 'session-2',
          completedAtMs: 2_000,
        },
        storage
      )
    ).toBe(false);
    expect(readCompletedAccountReauthResultKeys('connection-a', storage, 2_500)).toEqual(new Set());
  });

  it('records dedicated Codex reauth success without suppressing unrelated result keys', () => {
    const storage = createStorage();
    expect(
      recordCompletedAccountReauthSession(
        {
          connectionFingerprint: 'connection-a',
          oauthProvider: 'codex',
          resultKeys: ['handled-codex-result'],
          createdAtMs: 1_000,
          completedAtMs: 2_000,
          sessionId: 'codex-session',
        },
        storage
      )
    ).toBe(true);

    const handledKeys = readCompletedAccountReauthResultKeys('connection-a', storage, 2_500);
    expect(handledKeys.has('handled-codex-result')).toBe(true);
    expect(handledKeys.has('new-codex-result')).toBe(false);
  });

  it('ignores expired or malformed session data', () => {
    const storage = createStorage();
    storage.setItem('accounts.oauthReauthSessions.v1', '{not-json');
    expect(readCompletedAccountReauthResultKeys('connection-a', storage, 1_000)).toEqual(new Set());

    recordCompletedAccountReauthSession(
      {
        connectionFingerprint: 'connection-a',
        oauthProvider: 'xai',
        resultKeys: ['expired-result'],
        createdAtMs: 1_000,
        completedAtMs: 2_000,
        sessionId: 'expired-session',
      },
      storage
    );
    expect(
      readCompletedAccountReauthResultKeys('connection-a', storage, 25 * 60 * 60 * 1_000)
    ).toEqual(new Set());
  });
});
