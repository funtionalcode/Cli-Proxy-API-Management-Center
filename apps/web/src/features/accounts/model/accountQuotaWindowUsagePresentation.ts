import type {
  MonitoringAccountWindowUsageItem,
} from '@/services/api/usageService';
import type {
  AccountQuotaDisplayWindow,
} from './accountQuotaDisplayWindows';
import { accountWindowUsageRequestKey } from './accountWindowUsageRows';
import { estimateWindowUsage, type WindowUsageForecast } from './estimateWindowUsage';
import type { AccountRow } from './accountRows';
import type { AccountQuotaCycleDefinition } from './accountQuotaWindowDefinitions';

export const FORECAST_COST_EPSILON = 1e-9;

export interface AccountDetailWindowUsageSummary {
  fromMs: number;
  toMs: number;
  matched: boolean;
  totalRequests: number;
  successCalls: number;
  failureCalls: number;
  totalTokens: number;
  totalCost: number;
  successRate: number | null;
  lastSeenMs: number | null;
  syncStatus: string;
  scopeMatchStatus: string;
  unmatchedRequests: number;
}

export interface AccountQuotaWindowUsagePresentationInput
  extends Partial<AccountQuotaDisplayWindow> {
  key: string;
  providerWindowId?: string;
  availability?: string;
  currentCycle?: AccountQuotaCycleDefinition | null;
  previousCycle?: AccountQuotaCycleDefinition | null;
  stale?: boolean;
}

export interface AccountQuotaWindowUsagePresentation {
  providerWindowId: string;
  currentUsage: AccountDetailWindowUsageSummary | null;
  previousUsage: AccountDetailWindowUsageSummary | null;
  previousPeriod: 'previous' | 'previous_equal_range' | null;
  forecast: WindowUsageForecast | null;
  hasTrustedCurrentActual: boolean;
  currentCost: number | null;
  currentTokens: number | null;
  forecastCost: number | null;
  forecastTokens: number | null;
}

export const toWindowUsageSummary = (
  item: MonitoringAccountWindowUsageItem | undefined
): AccountDetailWindowUsageSummary | null => {
  if (!item) return null;
  return {
    fromMs: item.from_ms,
    toMs: item.to_ms,
    matched: item.matched,
    totalRequests: item.total_requests,
    successCalls: item.success_calls,
    failureCalls: item.failure_calls,
    totalTokens: item.total_tokens,
    totalCost: item.total_cost,
    successRate: item.success_rate === null ? null : item.success_rate * 100,
    lastSeenMs: item.last_seen_ms,
    syncStatus: item.sync_status,
    scopeMatchStatus: item.scope_match_status ?? 'complete',
    unmatchedRequests: item.unmatched_requests ?? 0,
  };
};

export const resolveAccountQuotaWindowUsageAndForecast = (
  row: AccountRow,
  window: AccountQuotaWindowUsagePresentationInput,
  windowUsageByKey: Map<string, MonitoringAccountWindowUsageItem>
): AccountQuotaWindowUsagePresentation => {
  const providerWindowId = window.providerWindowId ?? window.key;
  const modelScope = window.modelScope
    ? {
        kind: window.modelScope.kind,
        key: window.modelScope.key,
        models: window.modelScope.models,
        complete: window.modelScope.complete,
      }
    : undefined;
  const scopeAllowsUsage = modelScope?.complete !== false;
  const currentUsage = toWindowUsageSummary(
    windowUsageByKey.get(
      accountWindowUsageRequestKey(row.selectionKey, providerWindowId, 'current', modelScope)
    )
  );
  const previousPeriod =
    window.windowMode === 'rolling'
      ? ('previous_equal_range' as const)
      : window.windowMode === 'fixed' || window.windowMode === 'calendar'
        ? ('previous' as const)
        : null;
  const previousUsage = previousPeriod
    ? toWindowUsageSummary(
        windowUsageByKey.get(
          accountWindowUsageRequestKey(
            row.selectionKey,
            providerWindowId,
            previousPeriod,
            modelScope
          )
        )
      )
    : null;
  const hasLifecycleEvidence =
    window.availability !== undefined ||
    window.currentCycle !== undefined ||
    window.previousCycle !== undefined;
  const lifecycleActive = window.availability === undefined || window.availability === 'active';
  const previousForecastEligible = window.previousCycle
    ? window.previousCycle.forecastEligible
    : !hasLifecycleEvidence;
  const currentForecastEligible = window.currentCycle
    ? window.currentCycle.forecastEligible
    : !hasLifecycleEvidence;
  const canForecastCurrentWindow =
    !hasLifecycleEvidence || (currentForecastEligible && window.stale !== true);
  const quotaProgressObservedAtMs =
    typeof window.quotaProgressObservedAtMs === 'number' &&
    Number.isFinite(window.quotaProgressObservedAtMs) &&
    window.quotaProgressObservedAtMs > 0
      ? window.quotaProgressObservedAtMs
      : null;
  const hasReliableQuotaProgress =
    typeof window.usedPercent === 'number' &&
    Number.isFinite(window.usedPercent) &&
    quotaProgressObservedAtMs !== null;
  const hasReliableCurrentUsage =
    currentUsage?.matched === true &&
    currentUsage.scopeMatchStatus === 'complete' &&
    currentForecastEligible;
  const currentUsageAheadOfQuotaProgressObservation =
    hasReliableCurrentUsage &&
    hasReliableQuotaProgress &&
    quotaProgressObservedAtMs !== null &&
    currentUsage.lastSeenMs !== null &&
    currentUsage.lastSeenMs > quotaProgressObservedAtMs;
  const currentForecastUsage =
    hasReliableCurrentUsage &&
    hasReliableQuotaProgress &&
    quotaProgressObservedAtMs !== null &&
    currentUsage.lastSeenMs !== null &&
    currentUsage.lastSeenMs <= quotaProgressObservedAtMs
      ? {
          requests: currentUsage.totalRequests,
          tokens: currentUsage.totalTokens,
          cost: currentUsage.totalCost,
        }
      : null;
  const forecast =
    scopeAllowsUsage &&
    lifecycleActive &&
    canForecastCurrentWindow &&
    (window.windowMode === 'fixed' || window.windowMode === 'calendar') &&
    typeof window.cycleStartMs === 'number' &&
    typeof window.cycleEndMs === 'number'
      ? estimateWindowUsage({
          usedPercent: window.usedPercent ?? null,
          current: currentForecastUsage,
          previous:
            !currentUsageAheadOfQuotaProgressObservation &&
            previousForecastEligible &&
            previousUsage?.matched === true &&
            previousUsage.scopeMatchStatus === 'complete'
              ? {
                  requests: previousUsage.totalRequests,
                  tokens: previousUsage.totalTokens,
                  cost: previousUsage.totalCost,
                }
              : null,
        })
      : null;
  const trustedCurrentActual =
    currentUsage?.matched === true &&
    currentUsage.scopeMatchStatus === 'complete' &&
    Number.isFinite(currentUsage.totalRequests) &&
    currentUsage.totalRequests >= 0 &&
    Number.isFinite(currentUsage.totalTokens) &&
    currentUsage.totalTokens >= 0 &&
    Number.isFinite(currentUsage.totalCost) &&
    currentUsage.totalCost >= 0
      ? {
          requests: currentUsage.totalRequests,
          tokens: currentUsage.totalTokens,
          cost: currentUsage.totalCost,
        }
      : null;
  const forecastIsConsistentWithCurrentActual =
    forecast === null ||
    trustedCurrentActual === null ||
    (forecast.requests >= trustedCurrentActual.requests &&
      forecast.tokens >= trustedCurrentActual.tokens &&
      forecast.cost + FORECAST_COST_EPSILON >= trustedCurrentActual.cost);

  const resolvedForecast = forecastIsConsistentWithCurrentActual ? forecast : null;
  const hasTrustedCurrentActual = trustedCurrentActual !== null;

  return {
    providerWindowId,
    currentUsage,
    previousUsage,
    previousPeriod,
    forecast: resolvedForecast,
    hasTrustedCurrentActual,
    currentCost: trustedCurrentActual?.cost ?? null,
    currentTokens: trustedCurrentActual?.tokens ?? null,
    forecastCost: hasTrustedCurrentActual && resolvedForecast ? resolvedForecast.cost : null,
    forecastTokens: hasTrustedCurrentActual && resolvedForecast ? resolvedForecast.tokens : null,
  };
};
