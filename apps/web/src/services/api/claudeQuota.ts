import type { AuthFileItem } from '@/types';
import { isRecord } from '@/utils/helpers';
import { normalizeAuthIndex } from '@/utils/quota/parsers';
import { CLAUDE_REQUEST_HEADERS, CLAUDE_RESET_ORGANIZATIONS_URL } from '@/utils/quota/constants';
import {
  isClaudeResetGrantId,
  normalizeClaudeOrganizationId,
} from '@/utils/quota/claudeLimitReset';
import { createStatusError } from '@/utils/quota/formatters';
import { apiCallApi, getApiCallErrorMessage } from './apiCall';
import { createScopedApiRequestConfig, type ApiClientRequestScope } from './client';

export interface ClaudeLimitResetResult {
  outcome: 'reset' | 'declined' | 'unconfirmed';
  result: string | null;
  reason: string | null;
}

export const createClaudeResetRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (placeholder) => {
    const random = Math.floor(Math.random() * 16);
    return (placeholder === 'x' ? random : (random & 3) | 8).toString(16);
  });
};

export const consumeClaudeLimitReset = async (
  file: AuthFileItem,
  organizationId: string,
  grantId: string,
  requestScope?: ApiClientRequestScope
): Promise<ClaudeLimitResetResult> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) throw new Error('Auth file missing auth_index');
  if (!normalizeClaudeOrganizationId(organizationId))
    throw new Error('Invalid Claude organization ID');
  if (!isClaudeResetGrantId(grantId)) throw new Error('Invalid Claude reset grant ID');

  const response = await apiCallApi.request(
    {
      authIndex,
      method: 'POST',
      url: `${CLAUDE_RESET_ORGANIZATIONS_URL}/${organizationId}/reset_rate_limits`,
      header: { ...CLAUDE_REQUEST_HEADERS },
      data: JSON.stringify({
        program: 'cedar_ember',
        grant_id: grantId,
        request_id: createClaudeResetRequestId(),
      }),
    },
    requestScope ? createScopedApiRequestConfig(requestScope) : undefined
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(response), response.statusCode);
  }
  let body: unknown = response.body;
  if (!body && response.bodyText) {
    try {
      body = JSON.parse(response.bodyText);
    } catch {
      body = null;
    }
  }
  const result = isRecord(body) && typeof body.result === 'string' ? body.result : null;
  const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason : null;
  const uncertain = reason === 'reset_unconfirmed' || reason === 'stamp_indeterminate';
  return {
    result,
    reason,
    outcome:
      result === 'reset' && !uncertain
        ? 'reset'
        : !uncertain &&
            ['already_used', 'not_limited', 'cooldown', 'ineligible', 'unavailable'].includes(
              result ?? ''
            )
          ? 'declined'
          : 'unconfirmed',
  };
};
