import type { AuthFileItem, CredentialScopedQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isCredentialIdentityVerified } from '@/utils/authFileCredentialIdentity';
import { getAuthFileStatusIdentityKey } from '@/utils/authFileStatusMutation';

export interface QuotaCredentialIdentity {
  authFileKey: string;
  authFileName: string;
  authIndex: string | null;
  authFileIdentityVerified: boolean;
}

export const buildQuotaCredentialIdentity = (
  file: AuthFileItem | undefined
): Partial<QuotaCredentialIdentity> => {
  if (!file?.name) return {};
  return {
    authFileKey: getAuthFileStatusIdentityKey(file),
    authFileName: file.name,
    authIndex: normalizeAuthIndex(file.authIndex ?? file['auth_index'] ?? file['auth-index']),
    authFileIdentityVerified: isCredentialIdentityVerified(file),
  };
};

export const getQuotaCredentialStoreKey = (file: AuthFileItem): string =>
  buildQuotaCredentialIdentity(file).authFileKey ?? file.name;

export const scopeQuotaStateToCredential = <TState extends CredentialScopedQuotaState>(
  file: AuthFileItem,
  state: TState | undefined
): TState | undefined => {
  if (!state?.authFileKey) return undefined;
  return state.authFileKey === getQuotaCredentialStoreKey(file) ? state : undefined;
};

export const getCredentialScopedQuotaState = <TState extends CredentialScopedQuotaState>(
  states: Record<string, TState>,
  file: AuthFileItem
): TState | undefined => {
  const storeKey = getQuotaCredentialStoreKey(file);
  const scopedState = scopeQuotaStateToCredential(file, states[storeKey]);
  if (scopedState || storeKey === file.name) return scopedState;
  return scopeQuotaStateToCredential(file, states[file.name]);
};
