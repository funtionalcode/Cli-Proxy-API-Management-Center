import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { resolveCodexChatgptAccountId } from '@/utils/quota/resolvers';
import { resolveAuthProvider } from '@/utils/quota/validators';

export interface CredentialIdentity {
  physicalName: string;
  runtimeId: string;
  authIndex: string | null;
  provider: string;
  accountId: string;
  accountSnapshot: string;
  authLabelSnapshot: string;
}

export type CredentialIdentityTarget = AuthFileItem & {
  physicalName?: string | null;
  runtimeId?: string | null;
  authIndex?: string | number | null;
  provider?: string | null;
  accountId?: string | null;
  accountSnapshot?: string | null;
  authLabelSnapshot?: string | null;
};

const normalizeIdentityValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const firstNonEmptyIdentityValue = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = normalizeIdentityValue(value);
    if (normalized) return normalized;
  }
  return '';
};

const normalizeProvider = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (normalized === 'x-ai' || normalized === 'grok') return 'xai';
  return normalized;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const ACCOUNT_ID_FIELD_NAMES = [
  'account_id',
  'accountId',
  'chatgpt_account_id',
  'chatgptAccountId',
  'project_id',
  'projectId',
  'gemini_virtual_project',
  'geminiVirtualProject',
  'sub',
] as const;

const readAccountIdFromValue = (value: unknown, seen = new Set<object>()): string => {
  const record = readRecord(value);
  if (!record || seen.has(record)) return '';
  seen.add(record);

  for (const field of ACCOUNT_ID_FIELD_NAMES) {
    const normalized = normalizeIdentityValue(record[field]);
    if (normalized) return normalized;
  }
  for (const field of ['id_token', 'idToken'] as const) {
    const nested = readAccountIdFromValue(record[field], seen);
    if (nested) return nested;
  }
  return '';
};

export const readAuthFileStatusRuntimeId = (file: AuthFileItem): string =>
  typeof file.id === 'string' ? file.id.trim() : '';

export const readAuthFileStatusPhysicalName = (file: AuthFileItem): string =>
  String(file.name ?? '').trim();

export const readAuthFileStatusAuthIndex = (file: AuthFileItem): string | null =>
  normalizeAuthIndex(file.authIndex ?? file['auth_index'] ?? file['auth-index']);

export const readAuthFileStatusProvider = (file: AuthFileItem): string =>
  normalizeProvider(
    firstNonEmptyIdentityValue(file.provider, file.type, file.typo) || resolveAuthProvider(file)
  );

export const readAuthFileStatusAccountId = (file: AuthFileItem): string => {
  const direct = readAccountIdFromValue(file);
  if (direct) return direct;
  for (const field of ['id_token', 'idToken', 'metadata', 'attributes'] as const) {
    const nested = readAccountIdFromValue(file[field]);
    if (nested) return nested;
  }
  return normalizeIdentityValue(resolveCodexChatgptAccountId(file));
};

export const readAuthFileStatusAccountSnapshot = (file: AuthFileItem): string => {
  for (const value of [file.account, file.email, file.display_account, file.displayAccount]) {
    const normalized = normalizeIdentityValue(value);
    if (normalized) return normalized;
  }
  return '';
};

export const readAuthFileStatusAuthLabelSnapshot = (file: AuthFileItem): string =>
  firstNonEmptyIdentityValue(file.label, file.note);

export const resolveCredentialIdentity = (
  target: AuthFileItem | CredentialIdentityTarget
): CredentialIdentity => {
  const record = target as CredentialIdentityTarget;
  const directAccountSnapshot = normalizeIdentityValue(record.accountSnapshot);
  const directAuthLabelSnapshot = normalizeIdentityValue(record.authLabelSnapshot);
  return {
    physicalName:
      normalizeIdentityValue(record.physicalName) || readAuthFileStatusPhysicalName(record),
    runtimeId: normalizeIdentityValue(record.runtimeId) || readAuthFileStatusRuntimeId(record),
    authIndex: normalizeAuthIndex(record.authIndex ?? record['auth_index'] ?? record['auth-index']),
    provider: readAuthFileStatusProvider(record),
    accountId: normalizeIdentityValue(record.accountId) || readAuthFileStatusAccountId(record),
    accountSnapshot: directAccountSnapshot || readAuthFileStatusAccountSnapshot(record),
    authLabelSnapshot: directAuthLabelSnapshot || readAuthFileStatusAuthLabelSnapshot(record),
  };
};

export const isCredentialIdentityVerified = (
  target: AuthFileItem | CredentialIdentityTarget
): boolean => {
  const identity = resolveCredentialIdentity(target);
  const accountSnapshot =
    identity.accountSnapshot && identity.accountSnapshot !== identity.physicalName
      ? identity.accountSnapshot
      : '';
  return Boolean(
    identity.authIndex ||
      identity.accountId ||
      accountSnapshot ||
      (identity.runtimeId && identity.runtimeId !== identity.physicalName)
  );
};
