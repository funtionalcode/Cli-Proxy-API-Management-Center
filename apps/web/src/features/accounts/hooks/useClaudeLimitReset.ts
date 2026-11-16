import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { CLAUDE_CONFIG } from '@/components/quota/quotaConfigs';
import { authFilesApi } from '@/services/api/authFiles';
import { consumeClaudeLimitReset } from '@/services/api/claudeQuota';
import type { ApiClientRequestScope } from '@/services/api/client';
import { useNotificationStore } from '@/stores/useNotificationStore';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { getClaudeResetUnavailableReason } from '@/utils/quota/claudeLimitReset';
import { getQuotaCredentialStoreKey } from '@/utils/quota/credentialScope';
import type { AccountRow } from '../model/accountRows';
import { beginAccountQuotaRequest } from '../model/accountQuotaRequestGate';

interface ClaudeLimitResetOptions {
  rows: AccountRow[];
  connectionKey: string;
  requestScope: ApiClientRequestScope;
  disabled: boolean;
  requestVersions: RefObject<Map<string, number>>;
  onGatewayReset: () => Promise<unknown>;
}

export function useClaudeLimitReset(options: ClaudeLimitResetOptions) {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const setClaudeQuota = useQuotaStore((state) => state.setClaudeQuota);
  const latest = useRef(options);
  const mounted = useRef(false);
  const pending = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const resetClaudeQuotaForRow = useCallback(
    async (row: AccountRow, grantId: string) => {
      if (options.disabled || row.provider !== 'claude' || row.runtimeOnly) return;
      const authIndex = normalizeAuthIndex(row.raw['auth_index'] ?? row.raw.authIndex);
      if (!authIndex) return;
      const storeKey = getQuotaCredentialStoreKey(row.raw);
      const pendingKey = `${options.connectionKey}:${storeKey}`;
      if (pending.current.has(pendingKey)) return;
      pending.current.add(pendingKey);
      setPendingKeys(new Set(pending.current));
      const finish = () => {
        pending.current.delete(pendingKey);
        if (mounted.current) setPendingKeys(new Set(pending.current));
      };
      const cacheGeneration = captureQuotaCacheGeneration();
      const isCurrent = () =>
        mounted.current &&
        latest.current.connectionKey === options.connectionKey &&
        !latest.current.disabled &&
        captureQuotaCacheGeneration() === cacheGeneration &&
        latest.current.rows.some(
          (current) =>
            current.selectionKey === row.selectionKey &&
            current.provider === 'claude' &&
            !current.runtimeOnly &&
            getQuotaCredentialStoreKey(current.raw) === storeKey
        );
      const requestKey = `claude:${storeKey}`;
      let quotaIsCurrent = beginAccountQuotaRequest(options.requestVersions.current, requestKey);
      const publish = (data: Awaited<ReturnType<typeof CLAUDE_CONFIG.fetchQuota>>) => {
        if (!isCurrent() || !quotaIsCurrent()) return;
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setClaudeQuota((previous) => ({
            ...previous,
            [storeKey]: CLAUDE_CONFIG.buildSuccessState(data, row.raw),
          }));
        });
      };

      let fresh: Awaited<ReturnType<typeof CLAUDE_CONFIG.fetchQuota>>;
      try {
        fresh = await CLAUDE_CONFIG.fetchQuota(row.raw, t, options.requestScope);
      } catch (error) {
        if (isCurrent())
          showNotification(
            t('claude_quota.reset_verify_failed', {
              message: error instanceof Error ? error.message : t('common.unknown_error'),
            }),
            'error'
          );
        finish();
        return;
      }
      if (!isCurrent() || !quotaIsCurrent()) {
        finish();
        return;
      }
      publish(fresh);
      const status = fresh.limitResets;
      const grant = status?.grants.find((item) => item.id === grantId);
      if (
        !fresh.organizationId ||
        !status ||
        !grant ||
        getClaudeResetUnavailableReason(status, grant)
      ) {
        showNotification(t('claude_quota.reset_not_available'), 'warning');
        finish();
        return;
      }
      const organizationId = fresh.organizationId;
      let confirmed = false;
      showConfirmation({
        title: t('claude_quota.reset_confirm_title'),
        message: t('claude_quota.reset_confirm_message', {
          name: row.fileName,
          label:
            grant.kind === 'unknown'
              ? grant.label
              : `${t(`claude_quota.reset_kind_${grant.kind}`)} · ${grant.label}`,
          count: grant.resetsLeft,
          scopes: grant.clears.join(', ') || t('claude_quota.reset_scope_unknown'),
        }),
        confirmText: t('claude_quota.reset_action'),
        cancelText: t('common.cancel'),
        variant: 'primary',
        onCancel: () => {
          confirmed = true;
          finish();
        },
        onConfirm: async () => {
          if (confirmed) return;
          confirmed = true;
          if (!isCurrent() || !quotaIsCurrent() || getClaudeResetUnavailableReason(status, grant)) {
            if (mounted.current)
              showNotification(t('claude_quota.reset_context_changed'), 'warning');
            finish();
            return;
          }
          let result: Awaited<ReturnType<typeof consumeClaudeLimitReset>> | null = null;
          let requestError: string | null = null;
          try {
            result = await consumeClaudeLimitReset(
              row.raw,
              organizationId,
              grant.id,
              options.requestScope
            );
          } catch (error) {
            requestError = error instanceof Error ? error.message : t('common.unknown_error');
          }
          if (!isCurrent()) {
            finish();
            return;
          }
          quotaIsCurrent = beginAccountQuotaRequest(options.requestVersions.current, requestKey);
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            setClaudeQuota((previous) => ({
              ...previous,
              [storeKey]: { ...previous[storeKey], limitResets: null },
            }));
          });
          let refreshed: Awaited<ReturnType<typeof CLAUDE_CONFIG.fetchQuota>> | null = null;
          try {
            refreshed = await CLAUDE_CONFIG.fetchQuota(row.raw, t, options.requestScope);
            publish(refreshed);
          } catch (error) {
            console.warn('[Accounts] Failed to refresh Claude quota after limit reset:', error);
          }
          if (!isCurrent()) {
            finish();
            return;
          }
          let gatewaySyncFailed = false;
          const quotaHealthy =
            refreshed?.quotaInventoryObserved &&
            ['five-hour', 'seven-day'].every((id) =>
              refreshed.windows.some((window) => window.id === id)
            ) &&
            refreshed.windows.every(
              (window) => window.usedPercent !== null && window.usedPercent < 100
            );
          if (
            result?.outcome === 'reset' &&
            quotaHealthy &&
            latest.current.rows.some(
              (current) =>
                current.selectionKey === row.selectionKey && current.raw.disabled !== true
            ) &&
            quotaIsCurrent()
          ) {
            try {
              await authFilesApi.resetQuota(authIndex, options.requestScope);
              if (isCurrent()) await latest.current.onGatewayReset();
            } catch (error) {
              gatewaySyncFailed = true;
              console.warn('[Accounts] Failed to synchronize Claude gateway cooldown:', error);
            }
          }
          if (isCurrent()) {
            if (!result || result.outcome === 'unconfirmed') {
              showNotification(
                t('claude_quota.reset_unconfirmed', {
                  message:
                    requestError ?? result?.reason ?? result?.result ?? t('common.unknown_error'),
                }),
                'warning'
              );
            } else if (result.outcome === 'declined') {
              showNotification(
                t('claude_quota.reset_declined', { reason: result.reason ?? result.result }),
                'warning'
              );
            } else {
              const partial = !refreshed || gatewaySyncFailed || !quotaIsCurrent();
              showNotification(
                t(partial ? 'claude_quota.reset_partial_success' : 'claude_quota.reset_success'),
                partial ? 'warning' : 'success'
              );
            }
          }
          finish();
        },
      });
    },
    [options, setClaudeQuota, showConfirmation, showNotification, t]
  );

  return {
    resetClaudeQuotaForRow,
    isClaudeQuotaResetting: (row: AccountRow) =>
      pendingKeys.has(`${options.connectionKey}:${getQuotaCredentialStoreKey(row.raw)}`),
  };
}
