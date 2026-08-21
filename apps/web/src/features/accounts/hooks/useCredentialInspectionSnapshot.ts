import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createCodexInspectionConnectionFingerprint,
  loadCodexInspectionLastRun,
} from '@/features/monitoring/codexInspection';
import {
  createServerCredentialInspectionSnapshot,
  createStoredLocalCredentialInspectionSnapshot,
  isCompletedCredentialInspectionRun,
  selectLatestCredentialInspectionSnapshot,
  type CredentialInspectionResult,
  type CredentialInspectionSnapshot,
} from '@/features/monitoring/model/credentialInspectionSnapshot';
import { usageServiceApi } from '@/services/api';

const EMPTY_CREDENTIAL_INSPECTION_RESULTS: CredentialInspectionResult[] = [];
const INITIAL_INSPECTION_RUN_LIMIT = 10;
const FALLBACK_INSPECTION_RUN_LIMIT = 200;

interface UseCredentialInspectionSnapshotOptions {
  connectionFingerprint: string | null;
  checking: boolean;
  serverAvailable: boolean;
  managerServiceBase: string;
  managementKey: string;
}

export const createCredentialInspectionSnapshotScopeKey = (
  connectionFingerprint: string | null,
  managerServiceBase: string,
  managementKey: string
): string => {
  const managerFingerprint = createCodexInspectionConnectionFingerprint(
    managerServiceBase,
    managementKey
  );
  return [connectionFingerprint ?? '', managerFingerprint ?? ''].join('\u001f');
};

export function useCredentialInspectionSnapshot({
  connectionFingerprint,
  checking,
  serverAvailable,
  managerServiceBase,
  managementKey,
}: UseCredentialInspectionSnapshotOptions) {
  const scopeKey = useMemo(
    () =>
      createCredentialInspectionSnapshotScopeKey(
        connectionFingerprint,
        managerServiceBase,
        managementKey
      ),
    [connectionFingerprint, managementKey, managerServiceBase]
  );
  const [snapshotState, setSnapshotState] = useState<{
    scopeKey: string;
    snapshot: CredentialInspectionSnapshot | null;
  }>(() => ({ scopeKey, snapshot: null }));
  const [loadingState, setLoadingState] = useState({ scopeKey, loading: false });
  const requestIdRef = useRef(0);
  const activeScopeKeyRef = useRef(scopeKey);
  activeScopeKeyRef.current = scopeKey;

  const mergeSnapshots = useCallback(
    (candidates: Array<CredentialInspectionSnapshot | null | undefined>) => {
      setSnapshotState((current) => {
        if (current.scopeKey !== scopeKey) return current;
        return {
          scopeKey,
          snapshot: selectLatestCredentialInspectionSnapshot([current.snapshot, ...candidates]),
        };
      });
    },
    [scopeKey]
  );

  const readLocalSnapshot = useCallback(() => {
    const localState = connectionFingerprint
      ? loadCodexInspectionLastRun(connectionFingerprint)
      : null;
    return localState ? createStoredLocalCredentialInspectionSnapshot(localState) : null;
  }, [connectionFingerprint]);

  const applySnapshot = useCallback(
    (next: CredentialInspectionSnapshot) => {
      if (activeScopeKeyRef.current !== scopeKey) return;
      requestIdRef.current += 1;
      setLoadingState({ scopeKey, loading: false });
      mergeSnapshots([next]);
    },
    [mergeSnapshots, scopeKey]
  );

  const invalidatePendingRefresh = useCallback(() => {
    requestIdRef.current += 1;
    setLoadingState({ scopeKey, loading: false });
  }, [scopeKey]);

  const refresh = useCallback(async () => {
    if (activeScopeKeyRef.current !== scopeKey) return null;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isCurrentRequest = () =>
      requestIdRef.current === requestId && activeScopeKeyRef.current === scopeKey;
    const localSnapshot = readLocalSnapshot();

    if (checking || !serverAvailable || !managerServiceBase || !managementKey) {
      if (isCurrentRequest()) {
        mergeSnapshots([localSnapshot]);
        setLoadingState({ scopeKey, loading: false });
      }
      return null;
    }

    setLoadingState({ scopeKey, loading: true });
    try {
      let runsResponse = await usageServiceApi.listCodexInspectionRuns(
        managerServiceBase,
        managementKey,
        INITIAL_INSPECTION_RUN_LIMIT
      );
      if (!isCurrentRequest()) return null;
      let latestCompletedRun = runsResponse.items.find(isCompletedCredentialInspectionRun);
      if (!latestCompletedRun && runsResponse.items.length >= INITIAL_INSPECTION_RUN_LIMIT) {
        runsResponse = await usageServiceApi.listCodexInspectionRuns(
          managerServiceBase,
          managementKey,
          FALLBACK_INSPECTION_RUN_LIMIT
        );
        if (!isCurrentRequest()) return null;
        latestCompletedRun = runsResponse.items.find(isCompletedCredentialInspectionRun);
      }
      if (!latestCompletedRun) {
        mergeSnapshots([localSnapshot]);
        return null;
      }
      const detail = await usageServiceApi.getCodexInspectionRun(
        managerServiceBase,
        managementKey,
        latestCompletedRun.id
      );
      if (!isCurrentRequest()) return null;
      const serverSnapshot = createServerCredentialInspectionSnapshot(detail, runsResponse.items);
      if (!serverSnapshot) {
        mergeSnapshots([localSnapshot]);
        return null;
      }
      mergeSnapshots([localSnapshot, serverSnapshot]);
      return serverSnapshot;
    } catch {
      if (isCurrentRequest()) {
        mergeSnapshots([localSnapshot]);
      }
      return null;
    } finally {
      if (isCurrentRequest()) {
        setLoadingState({ scopeKey, loading: false });
      }
    }
  }, [
    checking,
    managementKey,
    managerServiceBase,
    mergeSnapshots,
    readLocalSnapshot,
    scopeKey,
    serverAvailable,
  ]);

  useLayoutEffect(() => {
    requestIdRef.current += 1;
    setSnapshotState({ scopeKey, snapshot: readLocalSnapshot() });
    setLoadingState({ scopeKey, loading: false });
  }, [readLocalSnapshot, scopeKey]);

  const snapshot = snapshotState.scopeKey === scopeKey ? snapshotState.snapshot : null;
  const loading = loadingState.scopeKey === scopeKey && loadingState.loading;

  return {
    snapshot,
    results: snapshot?.results ?? EMPTY_CREDENTIAL_INSPECTION_RESULTS,
    loading,
    refresh,
    applySnapshot,
    invalidatePendingRefresh,
  };
}
