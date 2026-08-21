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
  readAuthFileStatusAccountSnapshot,
  readAuthFileStatusAuthIndex,
  readAuthFileStatusPhysicalName,
  readAuthFileStatusProvider,
  readAuthFileStatusRuntimeId,
} from '@/utils/authFileCredentialIdentity';

const STORAGE_KEY = 'cpa.accounts.direct-reauth.v1';
const STORAGE_VERSION = 1;
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
}

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

export const createAccountDirectReauthBaseline = ({
  target,
  file,
  resultKeys,
  startedAtMs = Date.now(),
}: {
  target: CodexReauthTarget;
  file: AuthFileItem;
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

const fileMatchesTargetIdentity = (file: AuthFileItem, target: CodexReauthTarget): boolean => {
  const fileName = normalizeString(target.fileName);
  if (readAuthFileStatusProvider(file) !== normalizeProvider(target.provider)) return false;

  const accountId = normalizeString(target.accountId);
  if (accountId) return readAuthFileStatusAccountId(file) === accountId;

  const accountSnapshot = normalizeString(target.accountSnapshot || target.account);
  if (accountSnapshot && accountSnapshot !== fileName) {
    return readAuthFileStatusAccountSnapshot(file) === accountSnapshot;
  }

  if (!fileName || readAuthFileStatusPhysicalName(file) !== fileName) return false;

  const authIndex = normalizeString(
    target.authIndex === null || target.authIndex === undefined ? '' : String(target.authIndex)
  );
  if (authIndex) return readAuthFileStatusAuthIndex(file) === authIndex;

  const runtimeId = normalizeString(target.runtimeId);
  return Boolean(runtimeId && readAuthFileStatusRuntimeId(file) === runtimeId);
};

const resolveTargetFile = (
  files: readonly AuthFileItem[],
  target: CodexReauthTarget
): AuthFileItem | null => {
  const matches = files.filter((file) => fileMatchesTargetIdentity(file, target));
  return matches.length === 1 ? matches[0] : null;
};

export const confirmAccountDirectReauth = (
  pending: AccountDirectReauthBaseline,
  files: readonly AuthFileItem[]
): AuthFileItem | null => {
  const file = resolveTargetFile(files, pending.target);
  if (!file) return null;

  const credentialRefreshAtMs = readAuthFileCredentialRefreshAtMs(file) ?? 0;
  const updatedAtMs = readAuthFileUpdatedAtMs(file) ?? 0;
  const statusMessage = getAuthFileStatusMessage(file);
  const statusImproved =
    pending.statusMessage.length > 0 &&
    statusMessage !== pending.statusMessage &&
    (statusMessage.length === 0 || isHealthyAuthFileStatusMessage(statusMessage));
  if (
    credentialRefreshAtMs > pending.credentialRefreshAtMs ||
    updatedAtMs > pending.updatedAtMs ||
    statusImproved
  ) {
    return file;
  }
  return null;
};

export const clearPendingAccountDirectReauthsForTests = (): void => {
  memoryPendingReauths = [];
  try {
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable or blocked session storage.
  }
};
