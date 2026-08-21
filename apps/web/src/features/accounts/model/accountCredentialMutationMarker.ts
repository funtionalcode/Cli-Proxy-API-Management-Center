const STORAGE_KEY = 'cpa.accounts.credential-mutation-markers.v1';
const STORAGE_VERSION = 1;
const MAX_MARKERS = 32;
const MAX_MARKER_AGE_MS = 24 * 60 * 60 * 1000;

export interface AccountCredentialMutationMarker {
  id: string;
  connectionFingerprint: string;
  provider: string;
  createdAtMs: number;
}

interface StoredAccountCredentialMutationMarkers {
  version: number;
  markers: AccountCredentialMutationMarker[];
}

let memoryMarkers: AccountCredentialMutationMarker[] = [];
let markerSequence = 0;

const normalizeProvider = (value: string): string => {
  const provider = value.trim().toLowerCase().replace(/_/g, '-');
  if (provider === 'x-ai' || provider === 'grok') return 'xai';
  if (provider === 'anthropic') return 'claude';
  return provider;
};

const readTimestamp = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const normalizeMarker = (value: unknown): AccountCredentialMutationMarker | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const connectionFingerprint =
    typeof record.connectionFingerprint === 'string' ? record.connectionFingerprint.trim() : '';
  const provider = typeof record.provider === 'string' ? normalizeProvider(record.provider) : '';
  const createdAtMs = readTimestamp(record.createdAtMs);
  if (!id || !connectionFingerprint || !provider || createdAtMs <= 0) return null;
  return { id, connectionFingerprint, provider, createdAtMs };
};

const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const pruneMarkers = (
  markers: readonly AccountCredentialMutationMarker[],
  nowMs = Date.now()
): AccountCredentialMutationMarker[] => {
  const oldestAllowedAtMs = nowMs - MAX_MARKER_AGE_MS;
  const unique = new Map<string, AccountCredentialMutationMarker>();
  markers.forEach((marker) => {
    if (marker.createdAtMs < oldestAllowedAtMs) return;
    unique.set(marker.id, marker);
  });
  return Array.from(unique.values())
    .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id))
    .slice(-MAX_MARKERS);
};

const readStoredMarkers = (): AccountCredentialMutationMarker[] => {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredAccountCredentialMutationMarkers>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.markers)) return [];
    return pruneMarkers(
      parsed.markers
        .map(normalizeMarker)
        .filter((marker): marker is AccountCredentialMutationMarker => marker !== null)
    );
  } catch {
    return [];
  }
};

const loadMarkers = (): AccountCredentialMutationMarker[] =>
  pruneMarkers([...readStoredMarkers(), ...memoryMarkers]);

const saveMarkers = (markers: readonly AccountCredentialMutationMarker[]): void => {
  const next = pruneMarkers(markers);
  memoryMarkers = next;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, markers: next }));
  } catch {
    // Mutation markers are an in-session synchronization aid; storage failures remain non-fatal.
  }
};

export const recordAccountCredentialMutationMarker = ({
  connectionFingerprint,
  provider,
  createdAtMs = Date.now(),
}: {
  connectionFingerprint: string;
  provider: string;
  createdAtMs?: number;
}): AccountCredentialMutationMarker | null => {
  const normalizedConnectionFingerprint = connectionFingerprint.trim();
  const normalizedProvider = normalizeProvider(provider);
  const normalizedCreatedAtMs = readTimestamp(createdAtMs);
  if (!normalizedConnectionFingerprint || !normalizedProvider || normalizedCreatedAtMs <= 0) {
    return null;
  }
  markerSequence += 1;
  const marker: AccountCredentialMutationMarker = {
    id: `${normalizedCreatedAtMs.toString(36)}-${markerSequence.toString(36)}`,
    connectionFingerprint: normalizedConnectionFingerprint,
    provider: normalizedProvider,
    createdAtMs: normalizedCreatedAtMs,
  };
  saveMarkers([...loadMarkers(), marker]);
  return marker;
};

export const listAccountCredentialMutationMarkers = (
  connectionFingerprint: string
): AccountCredentialMutationMarker[] => {
  const normalizedConnectionFingerprint = connectionFingerprint.trim();
  if (!normalizedConnectionFingerprint) return [];
  return loadMarkers().filter(
    (marker) => marker.connectionFingerprint === normalizedConnectionFingerprint
  );
};

export const acknowledgeAccountCredentialMutationMarkers = (ids: readonly string[]): void => {
  const acknowledgedIds = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (acknowledgedIds.size === 0) return;
  saveMarkers(loadMarkers().filter((marker) => !acknowledgedIds.has(marker.id)));
};

export const clearAccountCredentialMutationMarkersForTests = (): void => {
  memoryMarkers = [];
  markerSequence = 0;
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable or blocked session storage.
  }
};
