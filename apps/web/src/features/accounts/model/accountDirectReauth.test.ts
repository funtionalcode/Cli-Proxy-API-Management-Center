import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthFileItem } from '@/types';
import {
  acknowledgePendingAccountDirectReauths,
  clearPendingAccountDirectReauthsForTests,
  confirmAccountDirectReauth,
  createAccountDirectReauthBaseline,
  listPendingAccountDirectReauths,
  recordPendingAccountDirectReauth,
} from './accountDirectReauth';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
};

const makeFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({
    id: 'runtime-1',
    name: 'codex-old.json',
    provider: 'codex',
    type: 'codex',
    authIndex: 'auth-1',
    account: 'alice@example.com',
    account_id: 'account-1',
    last_refresh: 1_000,
    modified: 1_100,
    status_message: 'token_expired',
    ...overrides,
  }) as AuthFileItem;

const makeBaseline = (startedAtMs = Date.now()) =>
  createAccountDirectReauthBaseline({
    target: {
      account: 'alice@example.com',
      fileName: 'codex-old.json',
      runtimeId: 'runtime-1',
      provider: 'codex',
      authIndex: 'auth-1',
      accountId: 'account-1',
      accountSnapshot: 'alice@example.com',
    },
    file: makeFile(),
    resultKeys: ['result-1'],
    startedAtMs,
  })!;

describe('accountDirectReauth', () => {
  beforeEach(() => {
    clearPendingAccountDirectReauthsForTests();
  });

  it('confirms only the same target after newer credential evidence appears', () => {
    const baseline = makeBaseline();
    expect(
      confirmAccountDirectReauth(baseline, [
        makeFile({ last_refresh: 2_500, modified: 2_550, status_message: '' }),
      ])
    ).not.toBeNull();
    expect(
      confirmAccountDirectReauth(baseline, [
        makeFile({ account_id: 'account-2', account: 'bob@example.com', last_refresh: 2_500 }),
      ])
    ).toBeNull();
    expect(confirmAccountDirectReauth(baseline, [makeFile()])).toBeNull();
  });

  it('accepts an explicit healthy status transition when timestamps are unavailable', () => {
    const baseline = makeBaseline();
    expect(
      confirmAccountDirectReauth(baseline, [
        makeFile({ last_refresh: undefined, modified: undefined, status_message: 'ready' }),
      ])
    ).not.toBeNull();
  });

  it('confirms the same account when OAuth replaces the physical file name', () => {
    const baseline = makeBaseline();
    expect(
      confirmAccountDirectReauth(baseline, [
        makeFile({
          name: 'codex-alice-plus-account-1.json',
          id: 'runtime-2',
          authIndex: 'auth-2',
          last_refresh: Date.now(),
          modified: Date.now(),
          status_message: '',
        }),
      ])
    ).not.toBeNull();
  });

  it('persists pending retries by connection and acknowledges exact records', () => {
    const storage = createStorage();
    const startedAtMs = Date.now();
    const baseline = makeBaseline(startedAtMs);
    const first = recordPendingAccountDirectReauth({
      connectionFingerprint: 'connection-a',
      baseline,
      storage,
    });
    expect(first).not.toBeNull();

    const persisted = recordPendingAccountDirectReauth({
      connectionFingerprint: 'connection-a',
      baseline: { ...baseline, startedAtMs: startedAtMs + 1 },
      storage,
    });
    expect(persisted).not.toBeNull();

    expect(listPendingAccountDirectReauths('connection-a', storage, startedAtMs + 2)).toEqual([
      persisted,
    ]);
    acknowledgePendingAccountDirectReauths([persisted!.id], storage);
    expect(listPendingAccountDirectReauths('connection-a', storage, startedAtMs + 2)).toEqual([]);
    expect(listPendingAccountDirectReauths('connection-b', storage, startedAtMs + 2)).toEqual([]);
  });
});
