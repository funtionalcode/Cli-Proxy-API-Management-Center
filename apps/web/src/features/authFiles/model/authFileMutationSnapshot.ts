import type { AuthFileLookupTarget } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { resolveCredentialIdentity } from '@/utils/authFileCredentialIdentity';
import {
  getAuthFileStatusSelectionKey,
  readAuthFileStatusAccountId,
  readAuthFileStatusAccountSnapshot,
  readAuthFileStatusCodexMember,
  readAuthFileStatusProvider,
  readAuthFileStatusRuntimeId,
  resolveAuthFileStatusMutationTarget,
  type AuthFileStatusMutationTarget,
} from '@/utils/authFileStatusMutation';

export const getAuthFileSourceMemberKey = (file: AuthFileItem): string =>
  JSON.stringify([
    getAuthFileStatusSelectionKey(file),
    readAuthFileStatusRuntimeId(file),
    readAuthFileStatusProvider(file),
    readAuthFileStatusAccountId(file),
    readAuthFileStatusProvider(file) === 'codex'
      ? readAuthFileStatusCodexMember(file)
      : readAuthFileStatusAccountSnapshot(file),
  ]);

const mergeAuthFileLookupSnapshots = (...snapshots: AuthFileItem[][]): AuthFileItem[] => {
  const seen = new Set<string>();
  const merged: AuthFileItem[] = [];
  snapshots.forEach((files) => {
    files.forEach((file) => {
      const key = getAuthFileSourceMemberKey(file);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(file);
    });
  });
  return merged;
};

export const lookupAuthFileMutationSnapshot = async (
  target: AuthFileStatusMutationTarget,
  lookup: (target: AuthFileLookupTarget) => Promise<AuthFileItem[]>
): Promise<AuthFileItem[]> => {
  const { physicalName, runtimeId } = resolveCredentialIdentity({
    name: target.name,
    runtimeId: target.runtimeId,
  });
  if (!physicalName) return [];

  // Source scope preserves every sibling; runtime scope retains cross-source
  // collision evidence that used to come from the complete inventory.
  const snapshots = await Promise.all([
    lookup({ name: physicalName }),
    runtimeId && runtimeId !== physicalName ? lookup({ name: runtimeId }) : Promise.resolve([]),
  ]);
  let files = mergeAuthFileLookupSnapshots(...snapshots);
  const resolution = resolveAuthFileStatusMutationTarget(files, target);
  // Identity-only resolution discovers a current runtime ID for collision checks.
  // Callers must still resolve the original target before authorizing a mutation.
  const observedResolution =
    resolution.failure === null
      ? resolution
      : resolveAuthFileStatusMutationTarget(files, { ...target, runtimeId: null });
  const observedRuntimeId =
    observedResolution.failure === null && observedResolution.target
      ? readAuthFileStatusRuntimeId(observedResolution.target)
      : '';
  if (observedRuntimeId && observedRuntimeId !== physicalName && observedRuntimeId !== runtimeId) {
    files = mergeAuthFileLookupSnapshots(files, await lookup({ name: observedRuntimeId }));
  }
  return files;
};
