import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('./client', () => ({
  apiClient: { post },
  createScopedApiRequestConfig: (scope: { apiBase: string; managementKey: string }) => ({
    baseURL: `${scope.apiBase}/v0/management`,
    headers: { Authorization: `Bearer ${scope.managementKey}` },
    cpampScopedRequest: true,
  }),
}));

import { clearLocalCooldown } from './authCooldown';

const scope = { apiBase: 'http://cpa-a.local:8317', managementKey: 'test-management-key' };
beforeEach(() => post.mockReset());

describe('clearLocalCooldown', () => {
  it('clears only the selected auth index on the captured CPA connection', async () => {
    post.mockResolvedValue({ status: 'ok', auth_index: 'auth-a', models: ['gpt-5.5'] });

    await clearLocalCooldown(' auth-a ', scope);

    expect(post).toHaveBeenCalledExactlyOnceWith(
      '/reset-quota',
      { auth_index: 'auth-a' },
      {
        baseURL: 'http://cpa-a.local:8317/v0/management',
        headers: { Authorization: 'Bearer test-management-key' },
        cpampScopedRequest: true,
      }
    );
  });

  it('rejects a missing index before issuing a request', async () => {
    await expect(clearLocalCooldown(' ', scope)).rejects.toThrow('auth_index is required');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a response that confirms a different credential', async () => {
    post.mockResolvedValue({ status: 'ok', auth_index: 'other-auth' });
    await expect(clearLocalCooldown('auth-a', scope)).rejects.toThrow('Unexpected reset-quota');
  });
});
