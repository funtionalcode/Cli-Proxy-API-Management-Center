import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildProviderRows,
  ClaudeEditDrawer,
  CodexEditDrawer,
  filterAndSortProviderRows,
  GeminiEditDrawer,
  getProviderHealthCheckProviderKey,
  OpenAIEditDrawer,
  PROVIDER_KIND_LABELS,
  ProviderDetailDrawer,
  ProviderHealthCheckDrawer,
  ProviderTable,
  ProviderToolbar,
  VertexEditDrawer,
  useProviderRecentRequests,
  type ProviderHealthCheckApplyAction,
  type ProviderKind,
  type ProviderKindFilter,
  type ProviderRow,
  type ProviderSortDirection,
  type ProviderSortOption,
} from '@/components/providers';
import {
  hasDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import type {
  CloakConfig,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import styles from './AiProvidersPage.module.scss';
import {
  createProviderWriteQueue,
  enqueueLatestProviderListEntryWrite,
  enqueueLatestProviderListUpsert,
  type ProviderWriteQueue,
} from './providerWriteQueue';

const PROVIDER_TABLE_DEFAULT_PAGE_SIZE = 10;
const PROVIDER_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const DEFAULT_CLOAK_CONFIG: CloakConfig = {
  mode: 'auto',
  strictMode: false,
  sensitiveWords: [],
};

const isProviderKeyEnabled = (config: { excludedModels?: string[] }) =>
  !hasDisableAllModelsRule(config.excludedModels);

type ProviderKeyIdentity =
  | { type: 'auth-index'; authIndex: string }
  | { type: 'composite'; apiKey: string; baseUrl: string; proxyUrl: string };

type ApiKeyProviderIdentity = { apiKey: string; baseUrl: string };

type OpenAIProviderIdentity =
  | { type: 'auth-index'; authIndex: string }
  | { type: 'composite'; name: string; baseUrl: string; prefix: string };

type ProviderEnabledTarget =
  | {
      kind: 'gemini';
      identity: ApiKeyProviderIdentity;
      enabled: boolean;
    }
  | {
      kind: 'interactions';
      identity: ApiKeyProviderIdentity;
      enabled: boolean;
    }
  | {
      kind: 'codex' | 'claude' | 'vertex';
      identity: ProviderKeyIdentity;
      enabled: boolean;
    }
  | { kind: 'openai'; identity: OpenAIProviderIdentity; enabled: boolean };

const getProviderKeyIdentity = (
  config: GeminiKeyConfig | ProviderKeyConfig
): ProviderKeyIdentity =>
  config.authIndex?.trim()
    ? { type: 'auth-index', authIndex: config.authIndex }
    : {
        type: 'composite',
        apiKey: config.apiKey,
        baseUrl: config.baseUrl ?? '',
        proxyUrl: config.proxyUrl ?? '',
      };

const getApiKeyProviderIdentity = (config: GeminiKeyConfig): ApiKeyProviderIdentity => ({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl ?? '',
});

const findApiKeyProviderIndex = (
  configs: GeminiKeyConfig[],
  identity: ApiKeyProviderIdentity
): number =>
  configs.findIndex(
    (config) => config.apiKey === identity.apiKey && (config.baseUrl ?? '') === identity.baseUrl
  );

const findProviderKeyIndex = <T extends GeminiKeyConfig | ProviderKeyConfig>(
  configs: T[],
  identity: ProviderKeyIdentity
): number =>
  configs.findIndex((config) =>
    identity.type === 'auth-index'
      ? config.authIndex === identity.authIndex
      : config.apiKey === identity.apiKey &&
        (config.baseUrl ?? '') === identity.baseUrl &&
        (config.proxyUrl ?? '') === identity.proxyUrl
  );

const getOpenAIProviderIdentity = (provider: OpenAIProviderConfig): OpenAIProviderIdentity =>
  provider.authIndex?.trim()
    ? { type: 'auth-index', authIndex: provider.authIndex }
    : {
        type: 'composite',
        name: provider.name,
        baseUrl: provider.baseUrl ?? '',
        prefix: provider.prefix ?? '',
      };

const findOpenAIProviderIndex = (
  providers: OpenAIProviderConfig[],
  identity: OpenAIProviderIdentity
): number =>
  providers.findIndex((provider) =>
    identity.type === 'auth-index'
      ? provider.authIndex === identity.authIndex
      : provider.name === identity.name &&
        (provider.baseUrl ?? '') === identity.baseUrl &&
        (provider.prefix ?? '') === identity.prefix
  );

export function AiProvidersPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid());
  const [error, setError] = useState('');

  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyConfig[]>(
    () => config?.geminiApiKeys || []
  );
  const [interactionsKeys, setInteractionsKeys] = useState<GeminiKeyConfig[]>(
    () => config?.interactionsApiKeys || []
  );
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.codexApiKeys || []
  );
  const [claudeConfigs, setClaudeConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.claudeApiKeys || []
  );
  const [vertexConfigs, setVertexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.vertexApiKeys || []
  );
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>(
    () => config?.openaiCompatibility || []
  );
  const geminiKeysRef = useRef(geminiKeys);
  const interactionsKeysRef = useRef(interactionsKeys);
  const codexConfigsRef = useRef(codexConfigs);
  const claudeConfigsRef = useRef(claudeConfigs);
  const vertexConfigsRef = useRef(vertexConfigs);
  const openaiProvidersRef = useRef(openaiProviders);

  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);
  const providerWriteQueueRef = useRef<ProviderWriteQueue | null>(null);
  if (providerWriteQueueRef.current === null) {
    providerWriteQueueRef.current = createProviderWriteQueue((pending) => {
      setConfigSwitchingKey(pending > 0 ? 'provider-write' : null);
    });
  }
  const providerWriteQueue = providerWriteQueueRef.current;

  // Table filter, sorting, and detail state.
  const [kindFilter, setKindFilter] = useState<ProviderKindFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [sortOption, setSortOption] = useState<ProviderSortOption>('priority');
  const [sortDirection, setSortDirection] = useState<ProviderSortDirection>('desc');
  const [detailRowKey, setDetailRowKey] = useState<string | null>(null);
  const [healthCheckOpen, setHealthCheckOpen] = useState(false);
  const [editDrawerKind, setEditDrawerKind] = useState<ProviderKind | null>(null);
  const [editDrawerIndex, setEditDrawerIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PROVIDER_TABLE_DEFAULT_PAGE_SIZE);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);
  const actionsDisabled = disableControls || loading || isSwitching;

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const { usageByProvider, loadRecentRequests, refreshRecentRequests } = useProviderRecentRequests({
    enabled: isCurrentLayer,
  });

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const syncGeminiKeys = useCallback((next: GeminiKeyConfig[]) => {
    geminiKeysRef.current = next;
    setGeminiKeys(next);
  }, []);

  const syncInteractionsKeys = useCallback((next: GeminiKeyConfig[]) => {
    interactionsKeysRef.current = next;
    setInteractionsKeys(next);
  }, []);

  const syncCodexConfigs = useCallback((next: ProviderKeyConfig[]) => {
    codexConfigsRef.current = next;
    setCodexConfigs(next);
  }, []);

  const syncClaudeConfigs = useCallback((next: ProviderKeyConfig[]) => {
    claudeConfigsRef.current = next;
    setClaudeConfigs(next);
  }, []);

  const syncVertexConfigs = useCallback((next: ProviderKeyConfig[]) => {
    vertexConfigsRef.current = next;
    setVertexConfigs(next);
  }, []);

  const syncOpenaiProviders = useCallback((next: OpenAIProviderConfig[]) => {
    openaiProvidersRef.current = next;
    setOpenaiProviders(next);
  }, []);

  const applyGeminiKeys = useCallback(
    (next: GeminiKeyConfig[]) => {
      syncGeminiKeys(next);
      updateConfigValue('gemini-api-key', next);
      clearCache('gemini-api-key');
    },
    [clearCache, syncGeminiKeys, updateConfigValue]
  );

  const applyInteractionsKeys = useCallback(
    (next: GeminiKeyConfig[]) => {
      syncInteractionsKeys(next);
      updateConfigValue('interactions-api-key', next);
      clearCache('interactions-api-key');
    },
    [clearCache, syncInteractionsKeys, updateConfigValue]
  );

  const applyCodexConfigs = useCallback(
    (next: ProviderKeyConfig[]) => {
      syncCodexConfigs(next);
      updateConfigValue('codex-api-key', next);
      clearCache('codex-api-key');
    },
    [clearCache, syncCodexConfigs, updateConfigValue]
  );

  const applyClaudeConfigs = useCallback(
    (next: ProviderKeyConfig[]) => {
      syncClaudeConfigs(next);
      updateConfigValue('claude-api-key', next);
      clearCache('claude-api-key');
    },
    [clearCache, syncClaudeConfigs, updateConfigValue]
  );

  const applyVertexConfigs = useCallback(
    (next: ProviderKeyConfig[]) => {
      syncVertexConfigs(next);
      updateConfigValue('vertex-api-key', next);
      clearCache('vertex-api-key');
    },
    [clearCache, syncVertexConfigs, updateConfigValue]
  );

  const applyOpenaiProviders = useCallback(
    (next: OpenAIProviderConfig[]) => {
      syncOpenaiProviders(next);
      updateConfigValue('openai-compatibility', next);
      clearCache('openai-compatibility');
    },
    [clearCache, syncOpenaiProviders, updateConfigValue]
  );

  const loadConfigs = useCallback(
    () =>
      providerWriteQueue.enqueue(async () => {
        const hasValidCache = isCacheValid();
        if (!hasValidCache) {
          setLoading(true);
        }
        setError('');
        try {
          const [configResult, vertexResult, openaiResult] = await Promise.allSettled([
            fetchConfig(),
            providersApi.getVertexConfigs(),
            providersApi.getOpenAIProviders(),
          ]);

          if (configResult.status !== 'fulfilled') {
            throw configResult.reason;
          }

          const data = configResult.value;
          syncGeminiKeys(data?.geminiApiKeys || []);
          syncInteractionsKeys(data?.interactionsApiKeys || []);
          syncCodexConfigs(data?.codexApiKeys || []);
          syncClaudeConfigs(data?.claudeApiKeys || []);
          syncVertexConfigs(data?.vertexApiKeys || []);
          syncOpenaiProviders(data?.openaiCompatibility || []);

          if (vertexResult.status === 'fulfilled') {
            applyVertexConfigs(vertexResult.value || []);
          }

          if (openaiResult.status === 'fulfilled') {
            applyOpenaiProviders(openaiResult.value || []);
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err) || t('notification.refresh_failed');
          setError(message);
        } finally {
          setLoading(false);
        }
      }),
    [
      applyOpenaiProviders,
      applyVertexConfigs,
      fetchConfig,
      isCacheValid,
      providerWriteQueue,
      syncClaudeConfigs,
      syncCodexConfigs,
      syncGeminiKeys,
      syncInteractionsKeys,
      syncOpenaiProviders,
      syncVertexConfigs,
      t,
    ]
  );

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadRecentRequests().catch(() => {});
  }, [isCurrentLayer, loadRecentRequests]);

  useEffect(() => {
    if (config?.geminiApiKeys) syncGeminiKeys(config.geminiApiKeys);
    if (config?.interactionsApiKeys) syncInteractionsKeys(config.interactionsApiKeys);
    if (config?.codexApiKeys) syncCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) syncClaudeConfigs(config.claudeApiKeys);
    if (config?.vertexApiKeys) syncVertexConfigs(config.vertexApiKeys);
    if (config?.openaiCompatibility) syncOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.interactionsApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.vertexApiKeys,
    config?.openaiCompatibility,
    syncClaudeConfigs,
    syncCodexConfigs,
    syncGeminiKeys,
    syncInteractionsKeys,
    syncOpenaiProviders,
    syncVertexConfigs,
  ]);

  const handleRecentRequestsRefresh = useCallback(async () => {
    await refreshRecentRequests();
  }, [refreshRecentRequests]);

  useHeaderRefresh(handleRecentRequestsRefresh, isCurrentLayer);

  const openEditorDrawer = useCallback((kind: ProviderKind, editIndex: number | null) => {
    setDetailRowKey(null);
    setEditDrawerKind(kind);
    setEditDrawerIndex(editIndex);
  }, []);

  const closeEditorDrawer = useCallback(() => {
    setEditDrawerKind(null);
    setEditDrawerIndex(null);
  }, []);

  const handleDrawerSaved = useCallback(() => {
    void loadConfigs();
  }, [loadConfigs]);

  // Unified rows and derived data.
  const rows = useMemo(
    () =>
      buildProviderRows({
        gemini: geminiKeys,
        interactions: interactionsKeys,
        codex: codexConfigs,
        claude: claudeConfigs,
        vertex: vertexConfigs,
        openai: openaiProviders,
        usageByProvider,
      }),
    [
      claudeConfigs,
      codexConfigs,
      geminiKeys,
      interactionsKeys,
      openaiProviders,
      usageByProvider,
      vertexConfigs,
    ]
  );

  const allModelNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((row) => {
      row.modelNames.forEach((name) => names.add(name));
    });
    return Array.from(names).sort();
  }, [rows]);

  useEffect(() => {
    // Remove model filters that no longer exist after configuration changes.
    setSelectedModels((prev) => {
      if (prev.size === 0) return prev;

      const availableModels = new Set(allModelNames);
      const next = new Set(Array.from(prev).filter((name) => availableModels.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [allModelNames]);

  const visibleRows = useMemo(
    () =>
      filterAndSortProviderRows(rows, {
        kind: kindFilter,
        searchText,
        selectedModels,
        sortOption,
        sortDirection,
      }),
    [kindFilter, rows, searchText, selectedModels, sortDirection, sortOption]
  );

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedRows = visibleRows.slice(pageStart, pageStart + pageSize);
  const pageStartItem = visibleRows.length === 0 ? 0 : pageStart + 1;
  const pageEndItem = Math.min(visibleRows.length, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [kindFilter, searchText, selectedModels, sortDirection, sortOption]);

  useEffect(() => {
    if (page === currentPage) return;
    setPage(currentPage);
  }, [currentPage, page]);

  const kindCounts = useMemo(() => {
    const counts: Record<ProviderKindFilter, number> = {
      all: rows.length,
      gemini: 0,
      interactions: 0,
      codex: 0,
      claude: 0,
      vertex: 0,
      openai: 0,
    };
    rows.forEach((row) => {
      counts[row.kind] += 1;
    });
    return counts;
  }, [rows]);

  const detailRow = useMemo(
    () => (detailRowKey ? (rows.find((row) => row.key === detailRowKey) ?? null) : null),
    [detailRowKey, rows]
  );

  const filtersActive = kindFilter !== 'all' || searchText.trim() !== '' || selectedModels.size > 0;

  const clearFilters = () => {
    setKindFilter('all');
    setSearchText('');
    setSelectedModels(new Set());
  };

  const showUpdateFailure = (error: unknown) => {
    const message = getErrorMessage(error);
    showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
  };

  const enqueueGeminiListEntryWrite = (
    identity: ApiKeyProviderIdentity,
    buildNext: (current: GeminiKeyConfig[], index: number) => GeminiKeyConfig[] | null,
    onSuccess?: () => void,
    onError: (error: unknown) => void = showUpdateFailure
  ) =>
    enqueueLatestProviderListEntryWrite(providerWriteQueue, {
      getCurrent: () => geminiKeysRef.current,
      apply: applyGeminiKeys,
      locate: (current) => findApiKeyProviderIndex(current, identity),
      buildNext,
      save: async (next) => {
        await providersApi.saveGeminiKeys(next);
      },
      onSuccess,
      onError,
    });

  const enqueueInteractionsListEntryWrite = (
    identity: ApiKeyProviderIdentity,
    buildNext: (current: GeminiKeyConfig[], index: number) => GeminiKeyConfig[] | null,
    onSuccess?: () => void,
    onError: (error: unknown) => void = showUpdateFailure,
    save: (next: GeminiKeyConfig[], index: number) => Promise<void> = async (next) => {
      await providersApi.saveInteractionsKeys(next);
    }
  ) =>
    enqueueLatestProviderListEntryWrite(providerWriteQueue, {
      getCurrent: () => interactionsKeysRef.current,
      apply: applyInteractionsKeys,
      locate: (current) => findApiKeyProviderIndex(current, identity),
      buildNext,
      save,
      onSuccess,
      onError,
    });

  const saveInteractionsFromDrawer = useCallback(
    async (payload: GeminiKeyConfig, original?: GeminiKeyConfig) => {
      let saveError: unknown;
      const sharedOptions = {
        getCurrent: () => interactionsKeysRef.current,
        apply: applyInteractionsKeys,
        value: payload,
        save: async (next: GeminiKeyConfig[]) => {
          await providersApi.saveInteractionsKeys(next);
        },
        onError: (error: unknown) => {
          saveError = error;
        },
      };
      const result = original
        ? await enqueueLatestProviderListUpsert(providerWriteQueue, {
            ...sharedOptions,
            locate: (current) =>
              findApiKeyProviderIndex(current, getApiKeyProviderIdentity(original)),
          })
        : await enqueueLatestProviderListUpsert(providerWriteQueue, sharedOptions);

      if (result) return;
      if (saveError) throw saveError;
      throw new Error(t('common.invalid_provider_index'));
    },
    [applyInteractionsKeys, providerWriteQueue, t]
  );

  const enqueueProviderKeyListEntryWrite = (
    provider: 'codex' | 'claude' | 'vertex',
    identity: ProviderKeyIdentity,
    buildNext: (current: ProviderKeyConfig[], index: number) => ProviderKeyConfig[] | null,
    onSuccess?: () => void,
    onError: (error: unknown) => void = showUpdateFailure
  ) =>
    enqueueLatestProviderListEntryWrite(providerWriteQueue, {
      getCurrent: () =>
        provider === 'codex'
          ? codexConfigsRef.current
          : provider === 'claude'
            ? claudeConfigsRef.current
            : vertexConfigsRef.current,
      apply:
        provider === 'codex'
          ? applyCodexConfigs
          : provider === 'claude'
            ? applyClaudeConfigs
            : applyVertexConfigs,
      locate: (current) => findProviderKeyIndex(current, identity),
      buildNext,
      save: async (next) => {
        if (provider === 'codex') {
          await providersApi.saveCodexConfigs(next);
        } else if (provider === 'claude') {
          await providersApi.saveClaudeConfigs(next);
        } else {
          await providersApi.saveVertexConfigs(next);
        }
      },
      onSuccess,
      onError,
    });

  const enqueueOpenAIListEntryWrite = (
    identity: OpenAIProviderIdentity,
    buildNext: (current: OpenAIProviderConfig[], index: number) => OpenAIProviderConfig[] | null,
    save: (next: OpenAIProviderConfig[], index: number) => Promise<void>,
    onSuccess?: () => void,
    onError: (error: unknown) => void = showUpdateFailure
  ) =>
    enqueueLatestProviderListEntryWrite(providerWriteQueue, {
      getCurrent: () => openaiProvidersRef.current,
      apply: applyOpenaiProviders,
      locate: (current) => findOpenAIProviderIndex(current, identity),
      buildNext,
      save,
      onSuccess,
      onError,
    });

  const applyProviderEnabledActions = async (
    actions: Map<string, ProviderHealthCheckApplyAction>
  ) => {
    if (actions.size === 0) return;

    const rowByKey = new Map(rows.map((row) => [getProviderHealthCheckProviderKey(row), row]));
    const targets: ProviderEnabledTarget[] = [];
    actions.forEach((action, providerKey) => {
      const row = rowByKey.get(providerKey);
      if (!row) return;

      const enabled = action === 'enable';
      if (row.kind === 'openai') {
        targets.push({ kind: row.kind, identity: getOpenAIProviderIdentity(row.raw), enabled });
      } else if (row.kind === 'gemini' || row.kind === 'interactions') {
        targets.push({ kind: row.kind, identity: getApiKeyProviderIdentity(row.raw), enabled });
      } else {
        targets.push({ kind: row.kind, identity: getProviderKeyIdentity(row.raw), enabled });
      }
    });
    if (targets.length === 0) {
      showNotification(t('ai_providers.health_check_no_changes'), 'success');
      return;
    }

    let failedCount = 0;
    let firstError: unknown;
    const onError = (error: unknown) => {
      if (failedCount === 0) firstError = error;
      failedCount += 1;
    };
    const writes = targets.map((target) => {
      if (target.kind === 'openai') {
        return enqueueOpenAIListEntryWrite(
          target.identity,
          (current, index) => {
            const item = current[index];
            if (!item || Boolean(item.disabled) === !target.enabled) return null;
            return current.map((entry, itemIndex) =>
              itemIndex === index ? { ...entry, disabled: !target.enabled } : entry
            );
          },
          async (_next, index) => {
            await providersApi.updateOpenAIProviderDisabled(index, !target.enabled);
          },
          undefined,
          onError
        );
      }

      const buildNext = <T extends GeminiKeyConfig | ProviderKeyConfig>(
        current: T[],
        index: number
      ) => {
        const item = current[index];
        if (!item || isProviderKeyEnabled(item) === target.enabled) return null;
        const excludedModels = target.enabled
          ? withoutDisableAllModelsRule(item.excludedModels)
          : withDisableAllModelsRule(item.excludedModels);
        return current.map((entry, itemIndex) =>
          itemIndex === index ? { ...entry, excludedModels } : entry
        );
      };

      if (target.kind === 'gemini') {
        return enqueueGeminiListEntryWrite(target.identity, buildNext, undefined, onError);
      }
      if (target.kind === 'interactions') {
        return enqueueInteractionsListEntryWrite(target.identity, buildNext, undefined, onError);
      }
      return enqueueProviderKeyListEntryWrite(
        target.kind,
        target.identity,
        buildNext,
        undefined,
        onError
      );
    });

    const results = await Promise.all(writes);
    const successCount = results.filter(Boolean).length;
    if (successCount > 0 && failedCount > 0) {
      showNotification(
        t('ai_providers.health_check_apply_partial', {
          success: successCount,
          failed: failedCount,
        }),
        'warning'
      );
    } else if (failedCount > 0) {
      showUpdateFailure(firstError);
    } else if (successCount > 0) {
      showNotification(t('ai_providers.health_check_apply_success'), 'success');
    } else {
      showNotification(t('ai_providers.health_check_no_changes'), 'success');
    }
  };

  const setHealthCheckProviderEnabled = async (providerKey: string, enabled: boolean) => {
    await applyProviderEnabledActions(new Map([[providerKey, enabled ? 'enable' : 'disable']]));
  };

  const setConfigEnabled = (
    provider: Exclude<ProviderKind, 'openai'>,
    identity: ProviderKeyIdentity | ApiKeyProviderIdentity,
    enabled: boolean
  ) => {
    const onSuccess = () =>
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    const buildNext = <T extends GeminiKeyConfig | ProviderKeyConfig>(
      current: T[],
      index: number
    ) => {
      const item = current[index];
      if (!item || isProviderKeyEnabled(item) === enabled) return null;
      const excludedModels = enabled
        ? withoutDisableAllModelsRule(item.excludedModels)
        : withDisableAllModelsRule(item.excludedModels);
      return current.map((entry, itemIndex) =>
        itemIndex === index ? { ...entry, excludedModels } : entry
      );
    };

    if (provider === 'gemini') {
      return enqueueGeminiListEntryWrite(identity as ApiKeyProviderIdentity, buildNext, onSuccess);
    }

    if (provider === 'interactions') {
      return enqueueInteractionsListEntryWrite(
        identity as ApiKeyProviderIdentity,
        buildNext,
        onSuccess
      );
    }

    return enqueueProviderKeyListEntryWrite(
      provider,
      identity as ProviderKeyIdentity,
      buildNext,
      onSuccess
    );
  };

  const setOpenAIProviderEnabled = (identity: OpenAIProviderIdentity, enabled: boolean) =>
    enqueueOpenAIListEntryWrite(
      identity,
      (current, index) => {
        const item = current[index];
        if (!item || Boolean(item.disabled) === !enabled) return null;
        return current.map((entry, itemIndex) =>
          itemIndex === index ? { ...entry, disabled: !enabled } : entry
        );
      },
      async (_next, index) => {
        await providersApi.updateOpenAIProviderDisabled(index, !enabled);
      },
      () =>
        showNotification(
          enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
          'success'
        )
    );

  const setProviderWebsocketsEnabled = (
    provider: 'codex' | 'claude',
    identity: ProviderKeyIdentity,
    enabled: boolean
  ) =>
    enqueueProviderKeyListEntryWrite(
      provider,
      identity,
      (current, index) => {
        const item = current[index];
        if (!item || item.websockets === enabled) return null;
        return current.map((entry, itemIndex) =>
          itemIndex === index ? { ...entry, websockets: enabled } : entry
        );
      },
      () =>
        showNotification(
          t(
            provider === 'codex'
              ? 'notification.codex_config_updated'
              : 'notification.claude_config_updated'
          ),
          'success'
        )
    );

  const setProviderCloakEnabled = (
    provider: 'codex' | 'claude',
    identity: ProviderKeyIdentity,
    enabled: boolean
  ) =>
    enqueueProviderKeyListEntryWrite(
      provider,
      identity,
      (current, index) => {
        const item = current[index];
        if (!item || Boolean(item.cloak) === enabled) return null;
        const nextItem: ProviderKeyConfig = enabled
          ? { ...item, cloak: { ...DEFAULT_CLOAK_CONFIG, sensitiveWords: [] } }
          : { ...item };
        if (!enabled) delete nextItem.cloak;
        return current.map((entry, itemIndex) => (itemIndex === index ? nextItem : entry));
      },
      () =>
        showNotification(
          t(
            provider === 'codex'
              ? 'notification.codex_config_updated'
              : 'notification.claude_config_updated'
          ),
          'success'
        )
    );

  const setProviderDisableCoolingEnabled = (row: ProviderRow, enabled: boolean) => {
    if (row.kind === 'gemini' || row.kind === 'interactions') {
      const identity = getApiKeyProviderIdentity(row.raw);
      const enqueueWrite =
        row.kind === 'gemini' ? enqueueGeminiListEntryWrite : enqueueInteractionsListEntryWrite;
      return enqueueWrite(
        identity,
        (current, index) => {
          const item = current[index];
          if (!item || item.disableCooling === enabled) return null;
          return current.map((entry, itemIndex) =>
            itemIndex === index ? { ...entry, disableCooling: enabled } : entry
          );
        },
        () =>
          showNotification(
            t(
              row.kind === 'gemini'
                ? 'notification.gemini_key_updated'
                : 'notification.interactions_key_updated'
            ),
            'success'
          )
      );
    }

    if (row.kind === 'openai') {
      const identity = getOpenAIProviderIdentity(row.raw);
      return enqueueOpenAIListEntryWrite(
        identity,
        (current, index) => {
          const item = current[index];
          if (!item || item.disableCooling === enabled) return null;
          return current.map((entry, itemIndex) =>
            itemIndex === index ? { ...entry, disableCooling: enabled } : entry
          );
        },
        async (next) => {
          await providersApi.saveOpenAIProviders(next);
        },
        () => showNotification(t('notification.openai_provider_updated'), 'success')
      );
    }

    const identity = getProviderKeyIdentity(row.raw);
    return enqueueProviderKeyListEntryWrite(
      row.kind,
      identity,
      (current, index) => {
        const item = current[index];
        if (!item || item.disableCooling === enabled) return null;
        return current.map((entry, itemIndex) =>
          itemIndex === index ? { ...entry, disableCooling: enabled } : entry
        );
      },
      () =>
        showNotification(
          t(
            row.kind === 'codex'
              ? 'notification.codex_config_updated'
              : 'notification.claude_config_updated'
          ),
          'success'
        )
    );
  };

  const setProviderPriority = (row: ProviderRow, priority: number) => {
    const nextPriority = Math.trunc(priority);
    const buildNext = <T extends GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig>(
      current: T[],
      index: number
    ) => {
      const item = current[index];
      if (!item || item.priority === nextPriority) return null;
      return current.map((entry, itemIndex) =>
        itemIndex === index ? { ...entry, priority: nextPriority } : entry
      );
    };

    if (row.kind === 'gemini' || row.kind === 'interactions') {
      const identity = getApiKeyProviderIdentity(row.raw);
      const enqueueWrite =
        row.kind === 'gemini' ? enqueueGeminiListEntryWrite : enqueueInteractionsListEntryWrite;
      return enqueueWrite(identity, buildNext, () =>
        showNotification(
          t(
            row.kind === 'gemini'
              ? 'notification.gemini_key_updated'
              : 'notification.interactions_key_updated'
          ),
          'success'
        )
      );
    }

    if (row.kind === 'openai') {
      const identity = getOpenAIProviderIdentity(row.raw);
      return enqueueOpenAIListEntryWrite(
        identity,
        buildNext,
        async (next) => {
          await providersApi.saveOpenAIProviders(next);
        },
        () => showNotification(t('notification.openai_provider_updated'), 'success')
      );
    }

    const identity = getProviderKeyIdentity(row.raw);
    return enqueueProviderKeyListEntryWrite(row.kind, identity, buildNext, () =>
      showNotification(
        t(
          row.kind === 'codex'
            ? 'notification.codex_config_updated'
            : row.kind === 'claude'
              ? 'notification.claude_config_updated'
              : 'notification.vertex_config_updated'
        ),
        'success'
      )
    );
  };

  // Delete by provider while preserving the existing API contracts.
  const deleteGemini = (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.gemini_delete_title', { defaultValue: 'Delete Gemini Key' }),
      message: t('ai_providers.gemini_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteGeminiKey(entry.apiKey, entry.baseUrl);
          const next = geminiKeys.filter((_, idx) => idx !== index);
          applyGeminiKeys(next);
          showNotification(t('notification.gemini_key_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteInteractions = (index: number) => {
    const entry = interactionsKeys[index];
    if (!entry) return;
    const identity = getApiKeyProviderIdentity(entry);
    showConfirmation({
      title: t('ai_providers.interactions_delete_title'),
      message: t('ai_providers.interactions_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        await enqueueInteractionsListEntryWrite(
          identity,
          (current, currentIndex) => current.filter((_, itemIndex) => itemIndex !== currentIndex),
          () => showNotification(t('notification.interactions_key_deleted'), 'success'),
          (err) => {
            const message = getErrorMessage(err);
            showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
          },
          async () => {
            await providersApi.deleteInteractionsKey(identity.apiKey, identity.baseUrl);
          }
        );
      },
    });
  };

  const deleteProviderEntry = (type: 'codex' | 'claude', index: number) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    const entry = source[index];
    if (!entry) return;
    showConfirmation({
      title: t(`ai_providers.${type}_delete_title`, {
        defaultValue: `Delete ${type === 'codex' ? 'Codex' : 'Claude'} Config`,
      }),
      message: t(`ai_providers.${type}_delete_confirm`),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          if (type === 'codex') {
            await providersApi.deleteCodexConfig(entry.apiKey, entry.baseUrl);
            const next = codexConfigs.filter((_, idx) => idx !== index);
            applyCodexConfigs(next);
            showNotification(t('notification.codex_config_deleted'), 'success');
          } else {
            await providersApi.deleteClaudeConfig(entry.apiKey, entry.baseUrl);
            const next = claudeConfigs.filter((_, idx) => idx !== index);
            applyClaudeConfigs(next);
            showNotification(t('notification.claude_config_deleted'), 'success');
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteVertex = (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.vertex_delete_title', { defaultValue: 'Delete Vertex Config' }),
      message: t('ai_providers.vertex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteVertexConfig(entry.apiKey, entry.baseUrl);
          const next = vertexConfigs.filter((_, idx) => idx !== index);
          applyVertexConfigs(next);
          showNotification(t('notification.vertex_config_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteOpenai = (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.openai_delete_title', { defaultValue: 'Delete OpenAI Provider' }),
      message: t('ai_providers.openai_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteOpenAIProvider(entry.name);
          const next = openaiProviders.filter((_, idx) => idx !== index);
          applyOpenaiProviders(next);
          showNotification(t('notification.openai_provider_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  // Row-level callback dispatch.
  const handleRowToggle = (row: ProviderRow, enabled: boolean) => {
    if (row.kind === 'openai') {
      void setOpenAIProviderEnabled(getOpenAIProviderIdentity(row.raw), enabled);
    } else if (row.kind === 'gemini' || row.kind === 'interactions') {
      void setConfigEnabled(row.kind, getApiKeyProviderIdentity(row.raw), enabled);
    } else {
      void setConfigEnabled(row.kind, getProviderKeyIdentity(row.raw), enabled);
    }
  };

  const handleRowWebsocketsToggle = (row: ProviderRow, enabled: boolean) => {
    if (row.kind !== 'codex' && row.kind !== 'claude') return;
    void setProviderWebsocketsEnabled(row.kind, getProviderKeyIdentity(row.raw), enabled);
  };

  const handleRowCloakToggle = (row: ProviderRow, enabled: boolean) => {
    if (row.kind !== 'codex' && row.kind !== 'claude') return;
    void setProviderCloakEnabled(row.kind, getProviderKeyIdentity(row.raw), enabled);
  };

  const handleRowDisableCoolingToggle = (row: ProviderRow, enabled: boolean) => {
    if (
      row.kind !== 'gemini' &&
      row.kind !== 'interactions' &&
      row.kind !== 'codex' &&
      row.kind !== 'claude' &&
      row.kind !== 'openai'
    ) {
      return;
    }
    void setProviderDisableCoolingEnabled(row, enabled);
  };

  const handleRowPriorityChange = (row: ProviderRow, priority: number) => {
    void setProviderPriority(row, priority);
  };

  const handleRowEdit = (row: ProviderRow) => {
    setDetailRowKey(null);
    openEditorDrawer(row.kind, row.originalIndex);
  };

  const handleRowDelete = (row: ProviderRow) => {
    setDetailRowKey(null);
    if (row.kind === 'gemini') {
      deleteGemini(row.originalIndex);
    } else if (row.kind === 'interactions') {
      deleteInteractions(row.originalIndex);
    } else if (row.kind === 'codex' || row.kind === 'claude') {
      deleteProviderEntry(row.kind, row.originalIndex);
    } else if (row.kind === 'vertex') {
      deleteVertex(row.originalIndex);
    } else {
      deleteOpenai(row.originalIndex);
    }
  };

  const handleAdd = (kind: ProviderKind) => {
    openEditorDrawer(kind, null);
  };

  const handlePageSizeChange = (value: string) => {
    const nextSize = Number.parseInt(value, 10);
    if (!Number.isFinite(nextSize) || nextSize <= 0) return;
    setPageSize(nextSize);
    setPage(1);
  };

  const emptyState =
    rows.length > 0 && kindFilter !== 'all' && kindCounts[kindFilter] === 0 ? (
      // Offer a direct add action when the selected provider kind has no configurations.
      <EmptyState
        title={t('ai_providers.kind_empty_title', { name: PROVIDER_KIND_LABELS[kindFilter] })}
        action={
          <Button size="sm" onClick={() => handleAdd(kindFilter)} disabled={actionsDisabled}>
            {t('ai_providers.add_kind_button', { name: PROVIDER_KIND_LABELS[kindFilter] })}
          </Button>
        }
      />
    ) : rows.length > 0 && filtersActive ? (
      <EmptyState
        title={t('ai_providers.table_filtered_empty_title')}
        description={t('ai_providers.table_filtered_empty_desc')}
        action={
          <Button variant="secondary" size="sm" onClick={clearFilters} disabled={actionsDisabled}>
            {t('ai_providers.clear_filters')}
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={t('ai_providers.table_empty_title')}
        description={t('ai_providers.table_empty_desc')}
      />
    );

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <div>
          <ProviderToolbar
            kind={kindFilter}
            kindCounts={kindCounts}
            onKindChange={setKindFilter}
            searchText={searchText}
            onSearchTextChange={setSearchText}
            allModelNames={allModelNames}
            selectedModels={selectedModels}
            onSelectedModelsChange={setSelectedModels}
            sortOption={sortOption}
            onSortOptionChange={setSortOption}
            sortDirection={sortDirection}
            onSortDirectionChange={setSortDirection}
            disabled={actionsDisabled}
            resolvedTheme={resolvedTheme}
            onAdd={handleAdd}
            onHealthCheck={() => setHealthCheckOpen(true)}
            healthCheckDisabled={visibleRows.length === 0}
          />

          <Card>
            <ProviderTable
              rows={pagedRows}
              loading={loading}
              actionsDisabled={actionsDisabled}
              toggleDisabled={actionsDisabled}
              resolvedTheme={resolvedTheme}
              emptyState={emptyState}
              onShowDetail={(row) => setDetailRowKey(row.key)}
              onEdit={handleRowEdit}
              onDelete={handleRowDelete}
              onToggle={handleRowToggle}
              onPriorityChange={handleRowPriorityChange}
            />
            {visibleRows.length > 0 &&
              (visibleRows.length > PROVIDER_TABLE_DEFAULT_PAGE_SIZE ||
                pageSize !== PROVIDER_TABLE_DEFAULT_PAGE_SIZE) && (
                <div className={styles.paginationBar}>
                  <div className={styles.paginationInfo}>
                    {t('monitoring.pagination_info', {
                      current: currentPage,
                      total: totalPages,
                      start: pageStartItem,
                      end: pageEndItem,
                      count: visibleRows.length,
                    })}
                  </div>
                  <div className={styles.paginationControls}>
                    <div className={styles.pageSizeField}>
                      <span>{t('monitoring.page_size_label')}</span>
                      <Select
                        value={String(pageSize)}
                        options={PROVIDER_TABLE_PAGE_SIZE_OPTIONS.map((size) => ({
                          value: String(size),
                          label: t('monitoring.page_size_option', { count: size }),
                        }))}
                        onChange={handlePageSizeChange}
                        disabled={loading}
                        fullWidth={false}
                        ariaLabel={t('monitoring.page_size_label')}
                        className={styles.pageSizeSelect}
                        triggerClassName={styles.pageSizeSelectTrigger}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setPage(Math.max(1, currentPage - 1))}
                      disabled={loading || currentPage <= 1}
                    >
                      {t('monitoring.pagination_prev')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                      disabled={loading || currentPage >= totalPages}
                    >
                      {t('monitoring.pagination_next')}
                    </Button>
                  </div>
                </div>
              )}
          </Card>
        </div>
      </div>

      <ProviderDetailDrawer
        row={detailRow}
        open={detailRowKey !== null}
        usageByProvider={usageByProvider}
        resolvedTheme={resolvedTheme}
        actionsDisabled={actionsDisabled}
        toggleDisabled={actionsDisabled}
        onClose={() => setDetailRowKey(null)}
        onEdit={handleRowEdit}
        onDelete={handleRowDelete}
        onToggle={handleRowToggle}
        onToggleWebsockets={handleRowWebsocketsToggle}
        onToggleCloak={handleRowCloakToggle}
        onToggleDisableCooling={handleRowDisableCoolingToggle}
      />
      <ProviderHealthCheckDrawer
        open={healthCheckOpen}
        rows={visibleRows}
        actionsDisabled={actionsDisabled}
        onClose={() => setHealthCheckOpen(false)}
        onApplyResultActions={applyProviderEnabledActions}
        onSetProviderEnabled={setHealthCheckProviderEnabled}
      />
      <GeminiEditDrawer
        open={editDrawerKind === 'gemini'}
        editIndex={editDrawerIndex}
        disabled={actionsDisabled}
        onClose={closeEditorDrawer}
        onSaved={handleDrawerSaved}
      />
      <GeminiEditDrawer
        open={editDrawerKind === 'interactions'}
        editIndex={editDrawerIndex}
        disabled={actionsDisabled}
        onClose={closeEditorDrawer}
        onSaved={handleDrawerSaved}
        onSave={saveInteractionsFromDrawer}
        providerKind="interactions"
      />
      <CodexEditDrawer
        open={editDrawerKind === 'codex'}
        editIndex={editDrawerIndex}
        disabled={actionsDisabled}
        onClose={closeEditorDrawer}
        onSaved={handleDrawerSaved}
      />
      <VertexEditDrawer
        open={editDrawerKind === 'vertex'}
        editIndex={editDrawerIndex}
        disabled={actionsDisabled}
        onClose={closeEditorDrawer}
        onSaved={handleDrawerSaved}
      />
      <ClaudeEditDrawer
        open={editDrawerKind === 'claude'}
        editIndex={editDrawerIndex}
        disabled={actionsDisabled}
        onClose={closeEditorDrawer}
        onSaved={handleDrawerSaved}
      />
      <OpenAIEditDrawer
        open={editDrawerKind === 'openai'}
        editIndex={editDrawerIndex}
        disabled={actionsDisabled}
        onClose={closeEditorDrawer}
        onSaved={handleDrawerSaved}
      />
    </div>
  );
}
