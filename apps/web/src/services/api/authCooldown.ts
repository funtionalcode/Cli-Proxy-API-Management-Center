import { normalizeAuthIndex } from '@/utils/authIndex';
import { apiClient, createScopedApiRequestConfig, type ApiClientRequestScope } from './client';

type ClearLocalCooldownResponse = {
  status: string;
  auth_index: string;
  models?: string[];
};

export async function clearLocalCooldown(
  authIndex: string,
  requestScope: ApiClientRequestScope
): Promise<ClearLocalCooldownResponse> {
  const index = normalizeAuthIndex(authIndex);
  if (!index) throw new Error('auth_index is required');
  const result = await apiClient.post<ClearLocalCooldownResponse>(
    '/reset-quota',
    { auth_index: index },
    createScopedApiRequestConfig(requestScope)
  );
  if (result.status !== 'ok' || normalizeAuthIndex(result.auth_index) !== index) {
    throw new Error('Unexpected reset-quota response');
  }
  return result;
}
