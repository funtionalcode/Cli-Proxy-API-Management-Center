import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  antigravitySubscriptionApi,
  type AntigravitySubscriptionSummary,
} from '@/services/api';
import type { AuthFileItem } from '@/types';
import {
  getStatusFromError,
  isAntigravityFile,
  isRuntimeOnlyAuthFile,
  normalizeAuthIndex,
} from '@/utils/quota';

export type AntigravitySubscriptionState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: AntigravitySubscriptionSummary;
  error?: string;
  errorStatus?: number;
};

type SubscriptionTarget = {
  file: AuthFileItem;
  authIndex: string | null;
  cacheKey: string;
};

const successfulSubscriptionCache = new Map<string, AntigravitySubscriptionSummary>();
const inFlightSubscriptionRequests = new Map<
  string,
  Promise<AntigravitySubscriptionSummary | null>
>();

const buildCacheKey = (authIndex: string | null): string => authIndex ?? '';

const getCachedSubscriptionState = (
  cacheKey: string
): AntigravitySubscriptionState | undefined => {
  const data = successfulSubscriptionCache.get(cacheKey);
  return data ? { status: 'success', data } : undefined;
};

const requestAntigravitySubscription = (authIndex: string, cacheKey: string) => {
  const cached = successfulSubscriptionCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const inFlight = inFlightSubscriptionRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = antigravitySubscriptionApi
    .get(authIndex)
    .then((data) => {
      if (data) {
        successfulSubscriptionCache.set(cacheKey, data);
      }
      return data;
    })
    .finally(() => {
      inFlightSubscriptionRequests.delete(cacheKey);
    });

  inFlightSubscriptionRequests.set(cacheKey, request);
  return request;
};

const buildSubscriptionTarget = (file: AuthFileItem): SubscriptionTarget | null => {
  if (!isAntigravityFile(file) || isRuntimeOnlyAuthFile(file)) return null;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return {
    file,
    authIndex,
    cacheKey: buildCacheKey(authIndex),
  };
};

export function useAntigravitySubscriptions() {
  const { t } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<Record<string, AntigravitySubscriptionState>>(
    {}
  );

  const refreshSubscription = useCallback(
    async (file: AuthFileItem) => {
      const target = buildSubscriptionTarget(file);
      if (!target) return;

      const cached = getCachedSubscriptionState(target.cacheKey);
      if (cached) {
        setSubscriptions((prev) => ({
          ...prev,
          [target.file.name]: cached,
        }));
        return;
      }

      if (!target.authIndex) {
        setSubscriptions((prev) => ({
          ...prev,
          [target.file.name]: {
            status: 'error',
            error: t('antigravity_subscription.missing_auth_index'),
          },
        }));
        return;
      }

      setSubscriptions((prev) => ({
        ...prev,
        [target.file.name]: { status: 'loading' },
      }));

      try {
        const data = await requestAntigravitySubscription(target.authIndex, target.cacheKey);
        setSubscriptions((prev) => ({
          ...prev,
          [target.file.name]: data
            ? { status: 'success', data }
            : { status: 'error', error: t('antigravity_subscription.empty_data') },
        }));
      } catch (err: unknown) {
        setSubscriptions((prev) => ({
          ...prev,
          [target.file.name]: {
            status: 'error',
            error: err instanceof Error ? err.message : t('common.unknown_error'),
            errorStatus: getStatusFromError(err),
          },
        }));
      }
    },
    [t]
  );

  const current = useMemo(() => {
    const next: Record<string, AntigravitySubscriptionState> = {};
    Object.entries(subscriptions).forEach(([fileName, state]) => {
      next[fileName] = state;
    });
    return next;
  }, [subscriptions]);

  return { subscriptions: current, refreshSubscription };
}
