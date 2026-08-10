import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadCodexInspectionLastRun } from '@/features/monitoring/codexInspection';
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

interface UseCredentialInspectionSnapshotOptions {
  connectionFingerprint: string | null;
  checking: boolean;
  serverAvailable: boolean;
  managerServiceBase: string;
  managementKey: string;
}

export function useCredentialInspectionSnapshot({
  connectionFingerprint,
  checking,
  serverAvailable,
  managerServiceBase,
  managementKey,
}: UseCredentialInspectionSnapshotOptions) {
  const scopeKey = useMemo(
    () => [connectionFingerprint ?? '', managerServiceBase, managementKey].join('\u001f'),
    [connectionFingerprint, managementKey, managerServiceBase]
  );
  const [snapshotState, setSnapshotState] = useState<{
    scopeKey: string;
    snapshot: CredentialInspectionSnapshot | null;
  }>(() => ({ scopeKey, snapshot: null }));
  const [loadingState, setLoadingState] = useState({ scopeKey, loading: false });
  const requestIdRef = useRef(0);

  const readLocalSnapshot = useCallback(() => {
    const localState = connectionFingerprint
      ? loadCodexInspectionLastRun(connectionFingerprint)
      : null;
    return localState ? createStoredLocalCredentialInspectionSnapshot(localState) : null;
  }, [connectionFingerprint]);

  const applySnapshot = useCallback(
    (next: CredentialInspectionSnapshot) => {
      setSnapshotState((current) => {
        if (current.scopeKey !== scopeKey) return current;
        return {
          scopeKey,
          snapshot: selectLatestCredentialInspectionSnapshot([current.snapshot, next]),
        };
      });
    },
    [scopeKey]
  );

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const localSnapshot = readLocalSnapshot();

    if (checking || !serverAvailable || !managerServiceBase || !managementKey) {
      if (requestIdRef.current === requestId) {
        setSnapshotState({ scopeKey, snapshot: localSnapshot });
        setLoadingState({ scopeKey, loading: false });
      }
      return;
    }

    setLoadingState({ scopeKey, loading: true });
    try {
      const runsResponse = await usageServiceApi.listCodexInspectionRuns(
        managerServiceBase,
        managementKey,
        10
      );
      if (requestIdRef.current !== requestId) return;
      const latestCompletedRun = runsResponse.items.find(isCompletedCredentialInspectionRun);
      if (!latestCompletedRun) {
        setSnapshotState({ scopeKey, snapshot: localSnapshot });
        return;
      }
      const detail = await usageServiceApi.getCodexInspectionRun(
        managerServiceBase,
        managementKey,
        latestCompletedRun.id
      );
      if (requestIdRef.current !== requestId) return;
      setSnapshotState({
        scopeKey,
        snapshot: selectLatestCredentialInspectionSnapshot([
          localSnapshot,
          createServerCredentialInspectionSnapshot(detail, runsResponse.items),
        ]),
      });
    } catch {
      if (requestIdRef.current === requestId) {
        setSnapshotState({ scopeKey, snapshot: localSnapshot });
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingState({ scopeKey, loading: false });
      }
    }
  }, [checking, managementKey, managerServiceBase, readLocalSnapshot, scopeKey, serverAvailable]);

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
  };
}
