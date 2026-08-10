import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { normalizeProviderKey, type AuthFileModelItem } from '@/features/authFiles/constants';
import {
  getAuthFilePatchTarget,
  getAuthFileSelectionKey,
} from '@/features/authFiles/model/authFilesPageModel';
import { getHttpStatusCode } from '@/features/authFiles/oauthAliasValidation';

type ModelsError = 'unsupported' | 'failed' | null;
type ModelDefinitionsError = 'unsupported' | 'failed' | null;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message.trim() : '';

const isUnsupportedEndpointError = (error: unknown, includeBadRequest = false): boolean => {
  const status = getHttpStatusCode(error);
  if (status === 404 || status === 405 || (includeBadRequest && status === 400)) return true;
  return /(?:404|405|not found|unsupported|unknown channel)/i.test(getErrorMessage(error));
};

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsRefreshing: boolean;
  modelsList: AuthFileModelItem[];
  modelDefinitions: AuthFileModelItem[];
  modelDefinitionsLoading: boolean;
  modelDefinitionsError: ModelDefinitionsError;
  modelsFileName: string;
  modelsFileType: string;
  modelsSelectionKey: string;
  modelsError: ModelsError;
  showModels: (item: AuthFileItem) => Promise<void>;
  refreshModels: (item?: AuthFileItem) => Promise<void>;
  invalidateModels: (item: AuthFileItem) => void;
  closeModelsModal: () => void;
};

export type UseAuthFilesModelsOptions = {
  connectionKey?: string | null;
};

type CurrentModelsTarget = {
  connectionKey: string;
  item: AuthFileItem;
};

const getScopedModelsKey = (connectionKey: string, item: AuthFileItem): string =>
  `${connectionKey}\u0000${getAuthFileSelectionKey(item)}`;

const getScopedDefinitionsKey = (connectionKey: string, channel: string): string =>
  `${connectionKey}\u0000${channel}`;

export function useAuthFilesModels(
  options: UseAuthFilesModelsOptions = {}
): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const normalizedConnectionKey = String(options.connectionKey ?? '');
  const connectionKeyRef = useRef(normalizedConnectionKey);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsRefreshing, setModelsRefreshing] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelDefinitions, setModelDefinitions] = useState<AuthFileModelItem[]>([]);
  const [modelDefinitionsLoading, setModelDefinitionsLoading] = useState(false);
  const [modelDefinitionsError, setModelDefinitionsError] = useState<ModelDefinitionsError>(null);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsSelectionKey, setModelsSelectionKey] = useState('');
  const [modelsConnectionKey, setModelsConnectionKey] = useState(normalizedConnectionKey);
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const modelsCacheRef = useRef<Map<string, AuthFileModelItem[]>>(new Map());
  const modelDefinitionsCacheRef = useRef<Map<string, AuthFileModelItem[]>>(new Map());
  const staleModelsRef = useRef<Set<string>>(new Set());
  const requestIdRef = useRef(0);
  const currentItemRef = useRef<CurrentModelsTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    connectionKeyRef.current = normalizedConnectionKey;
    requestIdRef.current += 1;
    currentItemRef.current = null;
    queueMicrotask(() => {
      if (cancelled) return;
      setModelsModalOpen(false);
      setModelsLoading(false);
      setModelsRefreshing(false);
      setModelsList([]);
      setModelDefinitions([]);
      setModelDefinitionsLoading(false);
      setModelDefinitionsError(null);
      setModelsFileName('');
      setModelsFileType('');
      setModelsSelectionKey('');
      setModelsConnectionKey(normalizedConnectionKey);
      setModelsError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [normalizedConnectionKey]);

  const closeModelsModal = useCallback(() => {
    setModelsModalOpen(false);
  }, []);

  const loadModels = useCallback(
    async (item: AuthFileItem, force: boolean) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const requestConnectionKey = normalizedConnectionKey;
      const selectionKey = getAuthFileSelectionKey(item);
      const cacheKey = getScopedModelsKey(requestConnectionKey, item);
      const patchTarget = getAuthFilePatchTarget(item);
      const selector = String(patchTarget.runtimeId ?? '').trim() || item.name;
      const provider = normalizeProviderKey(String(item.type ?? item.provider ?? ''));
      // CPA runtime identifies Gemini OAuth credentials as `gemini-cli`, while
      // the static model-definition endpoint exposes that catalog as `gemini`.
      const definitionsChannel = provider === 'gemini-cli' ? 'gemini' : provider;
      const definitionsCacheKey = definitionsChannel
        ? getScopedDefinitionsKey(requestConnectionKey, definitionsChannel)
        : '';
      currentItemRef.current = { connectionKey: requestConnectionKey, item };
      setModelsConnectionKey(requestConnectionKey);
      setModelsSelectionKey(selectionKey);
      setModelsFileName(item.name);
      setModelsFileType(provider);
      setModelsError(null);
      setModelsModalOpen(true);
      setModelsRefreshing(force);

      const cachedModels = modelsCacheRef.current.get(cacheKey);
      const cachedDefinitions = definitionsChannel
        ? modelDefinitionsCacheRef.current.get(definitionsCacheKey)
        : [];
      const shouldLoadModels = force || staleModelsRef.current.has(cacheKey) || !cachedModels;
      const shouldLoadDefinitions = Boolean(definitionsChannel) && (force || !cachedDefinitions);

      if (cachedModels) setModelsList(cachedModels);
      else setModelsList([]);
      if (cachedDefinitions) setModelDefinitions(cachedDefinitions);
      else setModelDefinitions([]);

      setModelsLoading(shouldLoadModels);
      setModelDefinitionsLoading(shouldLoadDefinitions);
      setModelDefinitionsError(null);

      const modelsPromise = shouldLoadModels
        ? authFilesApi.getModelsForAuthFile(selector)
        : Promise.resolve(cachedModels ?? []);
      const definitionsPromise = shouldLoadDefinitions
        ? authFilesApi.getModelDefinitions(definitionsChannel)
        : Promise.resolve(cachedDefinitions ?? []);

      const [modelsResult, definitionsResult] = await Promise.allSettled([
        modelsPromise,
        definitionsPromise,
      ]);
      if (requestIdRef.current !== requestId || connectionKeyRef.current !== requestConnectionKey) {
        return;
      }

      if (modelsResult.status === 'fulfilled') {
        modelsCacheRef.current.set(cacheKey, modelsResult.value);
        staleModelsRef.current.delete(cacheKey);
        setModelsList(modelsResult.value);
      } else {
        const errorMessage = getErrorMessage(modelsResult.reason);
        if (isUnsupportedEndpointError(modelsResult.reason)) {
          setModelsError('unsupported');
        } else {
          setModelsError('failed');
          showNotification(
            `${t('notification.load_failed')}: ${errorMessage || t('common.unknown_error')}`,
            'error'
          );
        }
      }

      if (definitionsResult.status === 'fulfilled') {
        if (definitionsChannel) {
          modelDefinitionsCacheRef.current.set(definitionsCacheKey, definitionsResult.value);
        }
        setModelDefinitions(definitionsResult.value);
      } else {
        setModelDefinitionsError(
          isUnsupportedEndpointError(definitionsResult.reason, true) ? 'unsupported' : 'failed'
        );
      }

      setModelsLoading(false);
      setModelsRefreshing(false);
      setModelDefinitionsLoading(false);
    },
    [normalizedConnectionKey, showNotification, t]
  );

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      await loadModels(item, false);
    },
    [loadModels]
  );

  const refreshModels = useCallback(
    async (item?: AuthFileItem) => {
      const currentTarget = currentItemRef.current;
      const target =
        item ??
        (currentTarget?.connectionKey === normalizedConnectionKey ? currentTarget.item : null);
      if (!target) return;
      await loadModels(target, true);
    },
    [loadModels, normalizedConnectionKey]
  );

  const invalidateModels = useCallback(
    (item: AuthFileItem) => {
      staleModelsRef.current.add(getScopedModelsKey(normalizedConnectionKey, item));
    },
    [normalizedConnectionKey]
  );

  const hasCurrentConnection = modelsConnectionKey === normalizedConnectionKey;

  return {
    modelsModalOpen: hasCurrentConnection && modelsModalOpen,
    modelsLoading: hasCurrentConnection && modelsLoading,
    modelsRefreshing: hasCurrentConnection && modelsRefreshing,
    modelsList: hasCurrentConnection ? modelsList : [],
    modelDefinitions: hasCurrentConnection ? modelDefinitions : [],
    modelDefinitionsLoading: hasCurrentConnection && modelDefinitionsLoading,
    modelDefinitionsError: hasCurrentConnection ? modelDefinitionsError : null,
    modelsFileName: hasCurrentConnection ? modelsFileName : '',
    modelsFileType: hasCurrentConnection ? modelsFileType : '',
    modelsSelectionKey: hasCurrentConnection ? modelsSelectionKey : '',
    modelsError: hasCurrentConnection ? modelsError : null,
    showModels,
    refreshModels,
    invalidateModels,
    closeModelsModal,
  };
}
