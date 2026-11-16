import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./apiCall', () => ({
  apiCallApi: { request },
  getApiCallErrorMessage: (response: { statusCode: number }) => String(response.statusCode),
}));

import { consumeClaudeLimitReset, createClaudeResetRequestId } from './claudeQuota';

const file = {
  name: 'claude.json',
  type: 'claude',
  auth_index: ' auth-claude ',
  proxy_url: 'socks5://account-proxy.example.test:1080',
};
const response = (body: unknown, statusCode = 200) => ({
  statusCode,
  hasStatusCode: true,
  header: {},
  body,
  bodyText: '',
});

beforeEach(() => {
  request.mockReset();
  vi.unstubAllGlobals();
});

describe('consumeClaudeLimitReset', () => {
  it('在模拟传输中使用规范化的组织 ID', async () => {
    request.mockResolvedValue(response({ result: 'reset' }));
    await consumeClaudeLimitReset(file, ' org-1 ', 'fable');
    expect(request.mock.calls[0][0].url).toBe(
      'https://api.anthropic.com/api/organizations/org-1/reset_rate_limits'
    );
  });

  it.each(['full_launch', 'fable_launch'])(
    'sends only selected grant %s through the account proxy chain and captured scope',
    async (grantId) => {
      request.mockResolvedValue(response({ result: 'reset', resets_left: 1 }));
      const result = await consumeClaudeLimitReset(file, 'org-1', grantId, {
        apiBase: 'https://captured.example.test',
        managementKey: 'test-management-key',
      });
      expect(result.outcome).toBe('reset');
      expect(request).toHaveBeenCalledTimes(1);
      const [payload, config] = request.mock.calls[0];
      expect(payload).toMatchObject({
        authIndex: 'auth-claude',
        method: 'POST',
        url: 'https://api.anthropic.com/api/organizations/org-1/reset_rate_limits',
        header: {
          Authorization: 'Bearer $TOKEN$',
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-cli/2.1.321 (external, cli)',
          'anthropic-client-platform': 'cli',
        },
      });
      expect(payload).not.toHaveProperty('proxyUrl');
      expect(payload).not.toHaveProperty('proxy_url');
      expect(JSON.parse(payload.data)).toEqual({
        program: 'cedar_ember',
        grant_id: grantId,
        request_id: expect.any(String),
      });
      expect(JSON.parse(payload.data).request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(config).toMatchObject({
        baseURL: 'https://captured.example.test/v0/management',
        headers: { Authorization: 'Bearer test-management-key' },
        cpampScopedRequest: true,
      });
    }
  );

  it.each([
    [{ result: 'already_used' }, 'declined'],
    [{ result: 'not_limited' }, 'declined'],
    [{ result: 'cooldown' }, 'declined'],
    [{ result: 'ineligible' }, 'declined'],
    [{ result: 'unavailable' }, 'declined'],
    [{ result: 'reset', reason: 'reset_unconfirmed' }, 'unconfirmed'],
    [{ result: 'reset', reason: 'stamp_indeterminate' }, 'unconfirmed'],
    [{ result: 'new_result' }, 'unconfirmed'],
    [{}, 'unconfirmed'],
  ])('does not report %j as a new successful reset', async (body, outcome) => {
    request.mockResolvedValue(response(body));
    expect((await consumeClaudeLimitReset(file, 'org-1', 'fable')).outcome).toBe(outcome);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('handles serialized JSON but treats malformed JSON as unconfirmed', async () => {
    request.mockResolvedValueOnce({ ...response(null), bodyText: '{"result":"reset"}' });
    expect((await consumeClaudeLimitReset(file, 'org-1', 'fable')).outcome).toBe('reset');
    request.mockResolvedValueOnce({ ...response(null), bodyText: '<html>error</html>' });
    expect((await consumeClaudeLimitReset(file, 'org-1', 'fable')).outcome).toBe('unconfirmed');
  });

  it.each([400, 401, 403, 429, 500])('does not retry HTTP %s', async (statusCode) => {
    request.mockResolvedValue(response({}, statusCode));
    await expect(consumeClaudeLimitReset(file, 'org-1', 'fable')).rejects.toThrow(
      String(statusCode)
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry a lost response', async () => {
    request.mockRejectedValue(new Error('response lost'));
    await expect(consumeClaudeLimitReset(file, 'org-1', 'fable')).rejects.toThrow('response lost');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['', 'fable'],
    ['org/other', 'fable'],
    ['org-1', '../grant'],
    ['org-1', ''],
  ])('rejects invalid identifiers before forwarding', async (organizationId, grantId) => {
    await expect(consumeClaudeLimitReset(file, organizationId, grantId)).rejects.toThrow(
      'Invalid Claude'
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('does not fall back to an unselected account', async () => {
    await expect(
      consumeClaudeLimitReset({ name: 'missing.json' }, 'org-1', 'fable')
    ).rejects.toThrow('auth_index');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('createClaudeResetRequestId', () => {
  it('creates a distinct UUID even when randomUUID is unavailable on an HTTP origin', () => {
    vi.stubGlobal('crypto', undefined);
    const first = createClaudeResetRequestId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(createClaudeResetRequestId()).not.toBe(first);
  });
});
