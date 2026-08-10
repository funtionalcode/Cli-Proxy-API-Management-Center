import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  monitoringAnalyticsApi,
  type UsageHeaderSnapshotsResponse,
} from '@/services/api/usageService';

interface UseHeaderSnapshotsLoaderOptions {
  serviceBase: string;
  managementKey: string;
  onResponse: (response: UsageHeaderSnapshotsResponse) => void;
  onReset: () => void;
}

interface HeaderSnapshotsRequest {
  serviceBase: string;
  managementKey: string;
  controller: AbortController;
  promise: Promise<void>;
}

export function useHeaderSnapshotsLoader({
  serviceBase,
  managementKey,
  onResponse,
  onReset,
}: UseHeaderSnapshotsLoaderOptions) {
  const inFlightRef = useRef<HeaderSnapshotsRequest | null>(null);
  const onResponseRef = useRef(onResponse);
  const onResetRef = useRef(onReset);
  const scopeVersionRef = useRef(0);
  const initializedScopeRef = useRef(false);
  onResponseRef.current = onResponse;
  onResetRef.current = onReset;

  useLayoutEffect(() => {
    scopeVersionRef.current += 1;
    inFlightRef.current?.controller.abort();
    inFlightRef.current = null;
    if (initializedScopeRef.current) {
      onResetRef.current();
    } else {
      initializedScopeRef.current = true;
    }
    return () => {
      scopeVersionRef.current += 1;
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
    };
  }, [managementKey, serviceBase]);

  return useCallback(async () => {
    if (!serviceBase) {
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
      onResetRef.current();
      return;
    }
    const currentRequest = inFlightRef.current;
    if (
      currentRequest?.serviceBase === serviceBase &&
      currentRequest.managementKey === managementKey
    ) {
      await currentRequest.promise;
      return;
    }

    const scopeVersion = scopeVersionRef.current;
    const controller = new AbortController();
    const inFlight: HeaderSnapshotsRequest = {
      serviceBase,
      managementKey,
      controller,
      promise: Promise.resolve(),
    };
    inFlight.promise = (async () => {
      try {
        const response = await monitoringAnalyticsApi.getHeaderSnapshots(
          serviceBase,
          managementKey,
          { days: 30, limit: 1000 },
          controller.signal
        );
        if (
          inFlightRef.current === inFlight &&
          scopeVersionRef.current === scopeVersion &&
          !controller.signal.aborted
        ) {
          onResponseRef.current(response);
        }
      } catch {
        // Preserve the last successful snapshot when a refresh fails.
      } finally {
        if (inFlightRef.current === inFlight) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = inFlight;
    await inFlight.promise;
  }, [managementKey, serviceBase]);
}
