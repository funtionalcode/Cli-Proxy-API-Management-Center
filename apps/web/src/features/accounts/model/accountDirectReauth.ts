import type { AuthFileItem } from '@/types';
import {
  getAuthFileStatusMessage,
  isHealthyAuthFileStatusMessage,
} from '@/features/authFiles/constants';
import {
  readAuthFileCredentialRefreshAtMs,
  readAuthFileUpdatedAtMs,
} from '@/features/accounts/model/accountQuotaSummary';
import type { CodexReauthTarget } from '@/features/oauth/codexReauthModel';
import {
  readAuthFileStatusAccountId,
  readAuthFileStatusAuthIndex,
  readAuthFileStatusPhysicalName,
  readAuthFileStatusProvider,
  readAuthFileStatusRuntimeId,
} from '@/utils/authFileCredentialIdentity';

const STORAGE_KEY = 'cpa.accounts.direct-reauth.v2';
const STORAGE_VERSION = 2;
const MAX_PENDING_REAUTHS = 16;
const MAX_PENDING_REAUTH_AGE_MS = 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface AccountDirectReauthBaseline {
  target: CodexReauthTarget;
  targetIdentityKey: string;
  resultKeys: string[];
  startedAtMs: number;
  credentialRefreshAtMs: number;
  updatedAtMs: number;
  statusMessage: string;
  providerCredentials: AccountDirectReauthCredentialEvidence[];
}

export interface AccountDirectReauthCredentialEvidence {
  identityKey: string;
  accountId: string;
  credentialRefreshAtMs: number;
  updatedAtMs: number;
  statusMessage: string;
}

export type AccountDirectReauthReconciliation =
  | { status: 'confirmed'; file: AuthFileItem }
  | { status: 'identity-changed'; file: AuthFileItem; observedAccountId: string }
  | { status: 'ambiguous' }
  | { status: 'unconfirmed' };

export interface PendingAccountDirectReauth extends AccountDirectReauthBaseline {
  id: string;
  connectionFingerprint: string;
}

type StoredAccountDirectReauths = {
  version: number;
  items: PendingAccountDirectReauth[];
};

let memoryPendingReauths: PendingAccountDirectReauth[] = [];

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeProvider = (value: unknown): string => {
  const provider = normalizeString(value).toLowerCase().replace(/_/g, '-');
  if (provider === 'x-ai' || provider === 'grok') return 'xai';
  return provider;
};

const normalizeTimestamp = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

const normalizeTarget = (value: unknown): CodexReauthTarget | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const account = normalizeString(record.account);
  const fileName = normalizeString(record.fileName);
  const provider = normalizeProvider(record.provider);
  const runtimeId = normalizeString(record.runtimeId);
  const accountId = normalizeString(record.accountId);
  const accountSnapshot = normalizeString(record.accountSnapshot);
  const authIndexValue = record.authIndex;
  const authIndex =
    typeof authIndexValue === 'string' || typeof authIndexValue === 'number'
      ? String(authIndexValue).trim()
      : '';
  if (!account || !fileName || provider !== 'codex') return null;
  return {
    account,
    fileName,
    ...(runtimeId ? { runtimeId } : {}),
    provider,
    ...(authIndex ? { authIndex } : {}),
    ...(accountId ? { accountId } : {}),
    ...(accountSnapshot ? { accountSnapshot } : {}),
  };
};

const normalizeResultKeys = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(value.map((item) => normalizeString(item)).filter((item) => item.length > 0))
      )
    : [];

const normalizeProviderCredentialEvidence = (
  value: unknown
): AccountDirectReauthCredentialEvidence | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const identityKey = normalizeString(record.identityKey);
  if (!identityKey) return null;
  return {
    identityKey,
    accountId: normalizeString(record.accountId),
    credentialRefreshAtMs: normalizeTimestamp(record.credentialRefreshAtMs),
    updatedAtMs: normalizeTimestamp(record.updatedAtMs),
    statusMessage: normalizeString(record.statusMessage),
  };
};

const parsePendingReauth = (value: unknown): PendingAccountDirectReauth | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const connectionFingerprint = normalizeString(record.connectionFingerprint);
  const target = normalizeTarget(record.target);
  const targetIdentityKey = normalizeString(record.targetIdentityKey);
  const resultKeys = normalizeResultKeys(record.resultKeys);
  const startedAtMs = normalizeTimestamp(record.startedAtMs);
  if (!id || !connectionFingerprint || !target || !targetIdentityKey || startedAtMs <= 0) {
    return null;
  }
  return {
    id,
    connectionFingerprint,
    target,
    targetIdentityKey,
    resultKeys,
    startedAtMs,
    credentialRefreshAtMs: normalizeTimestamp(record.credentialRefreshAtMs),
    updatedAtMs: normalizeTimestamp(record.updatedAtMs),
    statusMessage: normalizeString(record.statusMessage),
    providerCredentials: Array.isArray(record.providerCredentials)
      ? record.providerCredentials
          .map(normalizeProviderCredentialEvidence)
          .filter((item): item is AccountDirectReauthCredentialEvidence => item !== null)
      : [],
  };
};

const getStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const prunePendingReauths = (
  items: readonly PendingAccountDirectReauth[],
  nowMs = Date.now()
): PendingAccountDirectReauth[] => {
  const oldestAllowedAtMs = nowMs - MAX_PENDING_REAUTH_AGE_MS;
  const unique = new Map<string, PendingAccountDirectReauth>();
  items.forEach((item) => {
    if (item.startedAtMs < oldestAllowedAtMs) return;
    unique.set(item.id, item);
  });
  return Array.from(unique.values())
    .sort((left, right) => left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id))
    .slice(-MAX_PENDING_REAUTHS);
};

const readPendingReauths = (
  storage: StorageLike | null = getStorage(),
  nowMs = Date.now()
): PendingAccountDirectReauth[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredAccountDirectReauths>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) return [];
    return prunePendingReauths(
      parsed.items
        .map(parsePendingReauth)
        .filter((item): item is PendingAccountDirectReauth => item !== null),
      nowMs
    );
  } catch {
    return [];
  }
};

const loadPendingReauths = (
  storage: StorageLike | null = getStorage(),
  nowMs = Date.now()
): PendingAccountDirectReauth[] =>
  prunePendingReauths([...readPendingReauths(storage, nowMs), ...memoryPendingReauths], nowMs);

const writePendingReauths = (
  items: readonly PendingAccountDirectReauth[],
  storage: StorageLike | null = getStorage()
): boolean => {
  const next = prunePendingReauths(items);
  memoryPendingReauths = next;
  if (!storage) return true;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, items: next }));
    return true;
  } catch {
    return true;
  }
};

const createPendingReauthId = (startedAtMs: number): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall back to a tab-local opaque identifier when Web Crypto is unavailable.
  }
  return `${startedAtMs.toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const buildTargetIdentityKey = (target: CodexReauthTarget): string =>
  JSON.stringify([
    normalizeString(target.fileName),
    normalizeProvider(target.provider),
    normalizeString(target.authIndex === null ? '' : String(target.authIndex ?? '')),
    normalizeString(target.accountId),
    normalizeString(target.accountSnapshot),
    normalizeString(target.runtimeId),
  ]);

const buildCredentialIdentityKey = (file: AuthFileItem): string =>
  JSON.stringify([
    readAuthFileStatusProvider(file),
    readAuthFileStatusAccountId(file),
    readAuthFileStatusPhysicalName(file),
    readAuthFileStatusRuntimeId(file),
    readAuthFileStatusAuthIndex(file) ?? '',
  ]);

const buildProviderCredentialEvidence = (
  file: AuthFileItem
): AccountDirectReauthCredentialEvidence => ({
  identityKey: buildCredentialIdentityKey(file),
  accountId: readAuthFileStatusAccountId(file),
  credentialRefreshAtMs: readAuthFileCredentialRefreshAtMs(file) ?? 0,
  updatedAtMs: readAuthFileUpdatedAtMs(file) ?? 0,
  statusMessage: getAuthFileStatusMessage(file),
});

export const createAccountDirectReauthBaseline = ({
  target,
  file,
  files = [file],
  resultKeys,
  startedAtMs = Date.now(),
}: {
  target: CodexReauthTarget;
  file: AuthFileItem;
  files?: readonly AuthFileItem[];
  resultKeys: Iterable<string>;
  startedAtMs?: number;
}): AccountDirectReauthBaseline | null => {
  const normalizedTarget = normalizeTarget(target);
  const normalizedStartedAtMs = normalizeTimestamp(startedAtMs);
  if (!normalizedTarget || normalizedStartedAtMs <= 0) return null;
  return {
    target: normalizedTarget,
    targetIdentityKey: buildTargetIdentityKey(normalizedTarget),
    resultKeys: Array.from(new Set(Array.from(resultKeys, normalizeString).filter(Boolean))),
    startedAtMs: normalizedStartedAtMs,
    credentialRefreshAtMs: readAuthFileCredentialRefreshAtMs(file) ?? 0,
    updatedAtMs: readAuthFileUpdatedAtMs(file) ?? 0,
    statusMessage: getAuthFileStatusMessage(file),
    providerCredentials: files
      .filter((candidate) => readAuthFileStatusProvider(candidate) === 'codex')
      .map(buildProviderCredentialEvidence),
  };
};

export const recordPendingAccountDirectReauth = ({
  connectionFingerprint,
  baseline,
  storage = getStorage(),
}: {
  connectionFingerprint: string;
  baseline: AccountDirectReauthBaseline;
  storage?: StorageLike | null;
}): PendingAccountDirectReauth | null => {
  const normalizedFingerprint = connectionFingerprint.trim();
  if (!normalizedFingerprint) return null;
  const item: PendingAccountDirectReauth = {
    ...baseline,
    id: createPendingReauthId(baseline.startedAtMs),
    connectionFingerprint: normalizedFingerprint,
  };
  const existing = loadPendingReauths(storage).filter(
    (candidate) =>
      candidate.connectionFingerprint !== normalizedFingerprint ||
      candidate.targetIdentityKey !== baseline.targetIdentityKey
  );
  return writePendingReauths([...existing, item], storage) ? item : null;
};

export const listPendingAccountDirectReauths = (
  connectionFingerprint: string,
  storage: StorageLike | null = getStorage(),
  nowMs = Date.now()
): PendingAccountDirectReauth[] => {
  const normalizedFingerprint = connectionFingerprint.trim();
  if (!normalizedFingerprint) return [];
  return loadPendingReauths(storage, nowMs).filter(
    (item) => item.connectionFingerprint === normalizedFingerprint
  );
};

export const acknowledgePendingAccountDirectReauths = (
  ids: readonly string[],
  storage: StorageLike | null = getStorage()
): void => {
  const acknowledgedIds = new Set(ids.map(normalizeString).filter(Boolean));
  if (acknowledgedIds.size === 0) return;
  writePendingReauths(
    loadPendingReauths(storage).filter((item) => !acknowledgedIds.has(item.id)),
    storage
  );
};

const hasChangedCredentialEvidence = (
  current: AccountDirectReauthCredentialEvidence,
  baseline: AccountDirectReauthCredentialEvidence | undefined
): boolean => {
  if (!baseline) return true;
  const statusImproved =
    baseline.statusMessage.length > 0 &&
    current.statusMessage !== baseline.statusMessage &&
    (current.statusMessage.length === 0 || isHealthyAuthFileStatusMessage(current.statusMessage));
  return (
    current.credentialRefreshAtMs > baseline.credentialRefreshAtMs ||
    current.updatedAtMs > baseline.updatedAtMs ||
    statusImproved
  );
};

export const reconcileAccountDirectReauth = (
  pending: AccountDirectReauthBaseline,
  files: readonly AuthFileItem[]
): AccountDirectReauthReconciliation => {
  const providerFiles = files.filter((file) => readAuthFileStatusProvider(file) === 'codex');
  const expectedAccountId = normalizeString(pending.target.accountId);

  // A display account/email can locate the original row in the UI, but it cannot
  // prove that an OAuth result belongs to the same ChatGPT Space. Without a
  // trusted baseline account_id, fail closed instead of auto-confirming by email.
  if (!expectedAccountId) return { status: 'unconfirmed' };

  const baselineByIdentity = new Map(
    pending.providerCredentials.map((item) => [item.identityKey, item])
  );
  const matchingFiles = providerFiles.filter(
    (file) => readAuthFileStatusAccountId(file) === expectedAccountId
  );
  if (matchingFiles.length > 1) return { status: 'ambiguous' };
  if (matchingFiles.length === 1) {
    const file = matchingFiles[0];
    const evidence = buildProviderCredentialEvidence(file);
    if (hasChangedCredentialEvidence(evidence, baselineByIdentity.get(evidence.identityKey))) {
      return { status: 'confirmed', file };
    }
  }

  // Timestamp/status changes on another credential are not causal evidence for
  // this reauth: CPA may refresh unrelated Codex credentials in the background.
  // Only a structurally new credential identity (including an account_id
  // replacement that changes the identity key) is strong enough to flag a
  // different Space.
  const changedDifferentAccountFiles = providerFiles.filter((file) => {
    const evidence = buildProviderCredentialEvidence(file);
    return (
      Boolean(evidence.accountId) &&
      evidence.accountId !== expectedAccountId &&
      !baselineByIdentity.has(evidence.identityKey)
    );
  });
  const observedAccountIds = new Set(
    changedDifferentAccountFiles.map((file) => readAuthFileStatusAccountId(file))
  );
  if (changedDifferentAccountFiles.length === 1 && observedAccountIds.size === 1) {
    const file = changedDifferentAccountFiles[0];
    return {
      status: 'identity-changed',
      file,
      observedAccountId: readAuthFileStatusAccountId(file),
    };
  }
  if (changedDifferentAccountFiles.length > 1) return { status: 'ambiguous' };
  return { status: 'unconfirmed' };
};

export const confirmAccountDirectReauth = (
  pending: AccountDirectReauthBaseline,
  files: readonly AuthFileItem[]
): AuthFileItem | null => {
  const result = reconcileAccountDirectReauth(pending, files);
  return result.status === 'confirmed' ? result.file : null;
};

export const clearPendingAccountDirectReauthsForTests = (): void => {
  memoryPendingReauths = [];
  try {
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable or blocked session storage.
  }
};