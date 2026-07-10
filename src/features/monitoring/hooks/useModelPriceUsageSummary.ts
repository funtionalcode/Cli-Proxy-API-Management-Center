import { useCallback, useEffect, useRef, useState } from 'react';
import { usageServiceApi, type ModelPriceUsageSummaryResponse } from '@/services/api/usageService';
import { shouldFallbackToModelPriceModelStats } from '@/features/monitoring/model/modelPricesPageModel';

interface UseModelPriceUsageSummaryParams {
  serviceBase: string;
  managementKey?: string;
}

export interface UseModelPriceUsageSummaryResult {
  usageSummary: ModelPriceUsageSummaryResponse | null;
  loading: boolean;
  error: string;
  modelStatsFallbackEnabled: boolean;
  retry: () => void;
}

const resolveErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Manager Server request failed';
};

export function useModelPriceUsageSummary({
  serviceBase,
  managementKey,
}: UseModelPriceUsageSummaryParams): UseModelPriceUsageSummaryResult {
  const [usageSummary, setUsageSummary] = useState<ModelPriceUsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modelStatsFallbackEnabled, setModelStatsFallbackEnabled] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const requestId = ++requestIdRef.current;

    if (!serviceBase) {
      setUsageSummary(null);
      setLoading(false);
      setError('');
      setModelStatsFallbackEnabled(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setUsageSummary(null);
    setLoading(true);
    setError('');
    setModelStatsFallbackEnabled(false);

    void usageServiceApi
      .getModelPriceUsageSummary(serviceBase, managementKey, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setUsageSummary(response);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        const fallbackEnabled = shouldFallbackToModelPriceModelStats(requestError);
        setUsageSummary(null);
        setError(fallbackEnabled ? '' : resolveErrorMessage(requestError));
        setModelStatsFallbackEnabled(fallbackEnabled);
      })
      .finally(() => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        abortControllerRef.current = null;
        setLoading(false);
      });
  }, [managementKey, serviceBase]);

  useEffect(() => {
    // The request lifecycle intentionally resets visible state when its parameters change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      requestIdRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [load]);

  return {
    usageSummary,
    loading,
    error,
    modelStatsFallbackEnabled,
    retry: load,
  };
}
