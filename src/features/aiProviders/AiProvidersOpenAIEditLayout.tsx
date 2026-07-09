import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { providersApi } from '@/services/api';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useOpenAIEditDraftStore,
} from '@/stores';
import { modelsToEntries } from '@/components/ui/modelInputListUtils';
import type { OpenAIProviderConfig } from '@/types';
import type { ModelInfo } from '@/utils/models';
import { headersToEntries } from '@/utils/headers';
import { areKeyValueEntriesEqual, areModelEntriesEqual } from '@/utils/compare';
import { buildApiKeyEntry } from '@/components/providers/utils';
import {
  areNormalizedOpenAIApiKeyEntriesEqual,
  buildOpenAIBaseline,
  buildOpenAIProviderPayload,
  normalizeOpenAIApiKeyEntries,
  normalizeOpenAIModelEntries,
  parseOpenAIWeightInput,
} from '@/features/aiProviders/model/openaiProviderForm';
import {
  buildProviderDraftKey,
  parseProviderIndexParam,
} from '@/features/aiProviders/model/routeParams';
import type { ModelEntry, OpenAIFormState } from '@/components/providers/types';
import type { KeyTestStatus } from '@/stores/useOpenAIEditDraftStore';

type LocationState = { fromAiProviders?: boolean } | null;

export type OpenAIEditOutletContext = {
  hasIndexParam: boolean;
  editIndex: number | null;
  invalidIndexParam: boolean;
  invalidIndex: boolean;
  disableControls: boolean;
  loading: boolean;
  saving: boolean;
  form: OpenAIFormState;
  setForm: Dispatch<SetStateAction<OpenAIFormState>>;
  testModel: string;
  setTestModel: Dispatch<SetStateAction<string>>;
  testStatus: 'idle' | 'loading' | 'success' | 'error';
  setTestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>>;
  testMessage: string;
  setTestMessage: Dispatch<SetStateAction<string>>;
  keyTestStatuses: KeyTestStatus[];
  setDraftKeyTestStatus: (keyIndex: number, status: KeyTestStatus) => void;
  setDraftKeyTestStatuses: (statuses: KeyTestStatus[]) => void;
  resetDraftKeyTestStatuses: (count: number) => void;
  availableModels: string[];
  handleBack: () => void;
  handleSave: () => Promise<void>;
  mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void;
};

const buildEmptyForm = (): OpenAIFormState => ({
  name: '',
  weight: undefined,
  priority: undefined,
  prefix: '',
  baseUrl: '',
  headers: [],
  apiKeyEntries: [buildApiKeyEntry()],
  modelEntries: [{ name: '', alias: '' }],
  testModel: undefined,
});

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export function AiProvidersOpenAIEditLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();

  const params = useParams<{ index?: string }>();
  const hasIndexParam = typeof params.index === 'string';
  const editIndex = useMemo(() => parseProviderIndexParam(params.index), [params.index]);
  const invalidIndexParam = hasIndexParam && editIndex === null;

  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const [providers, setProviders] = useState<OpenAIProviderConfig[]>(
    () => config?.openaiCompatibility ?? []
  );
  const [loading, setLoading] = useState(() => !isCacheValid('openai-compatibility'));
  const [saving, setSaving] = useState(false);

  const draftKey = useMemo(() => {
    return buildProviderDraftKey('openai', editIndex, invalidIndexParam, params.index);
  }, [editIndex, invalidIndexParam, params.index]);

  const draft = useOpenAIEditDraftStore((state) => state.drafts[draftKey]);
  const acquireDraft = useOpenAIEditDraftStore((state) => state.acquireDraft);
  const releaseDraft = useOpenAIEditDraftStore((state) => state.releaseDraft);
  const initDraft = useOpenAIEditDraftStore((state) => state.initDraft);
  const setDraftBaseline = useOpenAIEditDraftStore((state) => state.setDraftBaseline);
  const setDraftForm = useOpenAIEditDraftStore((state) => state.setDraftForm);
  const setDraftTestModel = useOpenAIEditDraftStore((state) => state.setDraftTestModel);
  const setDraftTestStatus = useOpenAIEditDraftStore((state) => state.setDraftTestStatus);
  const setDraftTestMessage = useOpenAIEditDraftStore((state) => state.setDraftTestMessage);
  const setDraftKeyTestStatus = useOpenAIEditDraftStore((state) => state.setDraftKeyTestStatus);
  const setDraftKeyTestStatuses = useOpenAIEditDraftStore((state) => state.setDraftKeyTestStatuses);
  const resetDraftKeyTestStatuses = useOpenAIEditDraftStore(
    (state) => state.resetDraftKeyTestStatuses
  );

  const form = draft?.form ?? buildEmptyForm();
  const testModel = draft?.testModel ?? '';
  const testStatus = draft?.testStatus ?? 'idle';
  const testMessage = draft?.testMessage ?? '';
  const keyTestStatuses = draft?.keyTestStatuses ?? [];

  const setForm: Dispatch<SetStateAction<OpenAIFormState>> = useCallback(
    (action) => {
      setDraftForm(draftKey, action);
    },
    [draftKey, setDraftForm]
  );

  const setTestModel: Dispatch<SetStateAction<string>> = useCallback(
    (action) => {
      setDraftTestModel(draftKey, action);
    },
    [draftKey, setDraftTestModel]
  );

  const setTestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>> =
    useCallback(
      (action) => {
        setDraftTestStatus(draftKey, action);
      },
      [draftKey, setDraftTestStatus]
    );

  const setTestMessage: Dispatch<SetStateAction<string>> = useCallback(
    (action) => {
      setDraftTestMessage(draftKey, action);
    },
    [draftKey, setDraftTestMessage]
  );

  const handleSetDraftKeyTestStatus = useCallback(
    (keyIndex: number, status: KeyTestStatus) => {
      setDraftKeyTestStatus(draftKey, keyIndex, status);
    },
    [draftKey, setDraftKeyTestStatus]
  );

  const handleSetDraftKeyTestStatuses = useCallback(
    (statuses: KeyTestStatus[]) => {
      setDraftKeyTestStatuses(draftKey, statuses);
    },
    [draftKey, setDraftKeyTestStatuses]
  );

  const handleResetDraftKeyTestStatuses = useCallback(
    (count: number) => {
      resetDraftKeyTestStatuses(draftKey, count);
    },
    [draftKey, resetDraftKeyTestStatuses]
  );

  const initialData = useMemo(() => {
    if (editIndex === null) return undefined;
    return providers[editIndex];
  }, [editIndex, providers]);

  const invalidIndex = editIndex !== null && !initialData;

  const availableModels = useMemo(
    () => form.modelEntries.map((entry) => entry.name.trim()).filter(Boolean),
    [form.modelEntries]
  );

  useEffect(() => {
    acquireDraft(draftKey);
    return () => releaseDraft(draftKey);
  }, [acquireDraft, draftKey, releaseDraft]);

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAiProviders) {
      navigate(-1);
      return;
    }
    navigate('/ai-providers', { replace: true });
  }, [location.state, navigate]);

  useEffect(() => {
    let cancelled = false;
    const hasValidCache = isCacheValid('openai-compatibility');
    if (!hasValidCache) {
      setLoading(true);
    }

    providersApi
      .getOpenAIProviders()
      .then((value) => {
        if (cancelled) return;
        const nextProviders = value || [];
        setProviders(nextProviders);
        updateConfigValue('openai-compatibility', nextProviders);
      })
      .catch(async (err: unknown) => {
        if (cancelled) return;
        try {
          const fallback = await fetchConfig('openai-compatibility');
          if (cancelled) return;
          setProviders(Array.isArray(fallback) ? (fallback as OpenAIProviderConfig[]) : []);
        } catch {
          if (cancelled) return;
          const message = getErrorMessage(err) || t('notification.refresh_failed');
          showNotification(`${t('notification.load_failed')}: ${message}`, 'error');
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchConfig, isCacheValid, showNotification, t, updateConfigValue]);

  useEffect(() => {
    if (loading) return;
    if (draft?.initialized) return;

    if (initialData) {
      const modelEntries = modelsToEntries(initialData.models);
      const seededForm: OpenAIFormState = {
        name: initialData.name,
        weight: initialData.weight,
        priority: initialData.priority,
        prefix: initialData.prefix ?? '',
        baseUrl: initialData.baseUrl,
        headers: headersToEntries(initialData.headers),
        testModel: initialData.testModel,
        modelEntries,
        apiKeyEntries: initialData.apiKeyEntries?.length
          ? initialData.apiKeyEntries
          : [buildApiKeyEntry()],
        disableCooling: initialData.disableCooling,
      };

      const available = modelEntries.map((entry) => entry.name.trim()).filter(Boolean);
      const initialTestModel =
        initialData.testModel && available.includes(initialData.testModel)
          ? initialData.testModel
          : available[0] || '';
      const baseline = buildOpenAIBaseline(seededForm, initialTestModel);
      initDraft(draftKey, {
        baseline,
        form: seededForm,
        testModel: initialTestModel,
        testStatus: 'idle',
        testMessage: '',
        keyTestStatuses: [],
      });
    } else {
      const emptyForm = buildEmptyForm();
      initDraft(draftKey, {
        baseline: buildOpenAIBaseline(emptyForm, ''),
        form: emptyForm,
        testModel: '',
        testStatus: 'idle',
        testMessage: '',
        keyTestStatuses: [],
      });
    }
  }, [draft?.initialized, draftKey, initDraft, initialData, loading]);

  useEffect(() => {
    if (loading) return;

    if (availableModels.length === 0) {
      if (testModel) {
        setTestModel('');
        setTestStatus('idle');
        setTestMessage('');
      }
      return;
    }

    if (!testModel || !availableModels.includes(testModel)) {
      setTestModel(availableModels[0]);
      setTestStatus('idle');
      setTestMessage('');
    }
  }, [availableModels, loading, setTestMessage, setTestModel, setTestStatus, testModel]);

  const mergeDiscoveredModels = useCallback(
    (selectedModels: ModelInfo[]) => {
      if (!selectedModels.length) return;

      let addedCount = 0;
      setForm((prev) => {
        const mergedMap = new Map<string, ModelEntry>();
        prev.modelEntries.forEach((entry) => {
          const name = entry.name.trim();
          if (!name) return;
          mergedMap.set(name.toLowerCase(), {
            ...entry,
            name,
            alias: entry.alias?.trim() || '',
          });
        });

        selectedModels.forEach((model) => {
          const name = model.name.trim();
          const key = name.toLowerCase();
          if (!name || mergedMap.has(key)) return;
          mergedMap.set(key, { name, alias: model.alias ?? '' });
          addedCount += 1;
        });

        const mergedEntries = Array.from(mergedMap.values());
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });

      if (addedCount > 0) {
        showNotification(
          t('ai_providers.openai_models_fetch_added', { count: addedCount }),
          'success'
        );
      }
    },
    [setForm, showNotification, t]
  );

  const resolvedLoading = !draft?.initialized;
  const baseline = draft?.baseline ?? null;
  const normalizedHeaders = useMemo(
    () => buildOpenAIBaseline(form, testModel).headers,
    [form, testModel]
  );
  const normalizedModels = useMemo(
    () => normalizeOpenAIModelEntries(form.modelEntries),
    [form.modelEntries]
  );
  const normalizedApiKeyEntries = useMemo(
    () => normalizeOpenAIApiKeyEntries(form.apiKeyEntries),
    [form.apiKeyEntries]
  );
  const normalizedWeight = useMemo(
    () => parseOpenAIWeightInput(form.weight) ?? null,
    [form.weight]
  );
  const normalizedPriority = useMemo(() => {
    return form.priority !== undefined && Number.isFinite(form.priority)
      ? Math.trunc(form.priority)
      : null;
  }, [form.priority]);
  const normalizedTestModel = useMemo(() => String(testModel ?? '').trim(), [testModel]);
  const isHeadersDirty = useMemo(() => {
    if (!baseline) return false;
    return !areKeyValueEntriesEqual(baseline.headers, normalizedHeaders);
  }, [baseline, normalizedHeaders]);
  const isModelsDirty = useMemo(() => {
    if (!baseline) return false;
    return !areModelEntriesEqual(baseline.models, normalizedModels);
  }, [baseline, normalizedModels]);
  const isApiKeyEntriesDirty = useMemo(() => {
    if (!baseline) return false;
    return !areNormalizedOpenAIApiKeyEntriesEqual(baseline.apiKeyEntries, normalizedApiKeyEntries);
  }, [baseline, normalizedApiKeyEntries]);
  const isDirty =
    Boolean(draft?.initialized) &&
    baseline !== null &&
    (baseline.name !== form.name.trim() ||
      baseline.weight !== normalizedWeight ||
      baseline.priority !== normalizedPriority ||
      baseline.prefix !== form.prefix.trim() ||
      baseline.baseUrl !== form.baseUrl.trim() ||
      baseline.disableCooling !== Boolean(form.disableCooling) ||
      baseline.testModel !== normalizedTestModel ||
      isHeadersDirty ||
      isApiKeyEntriesDirty ||
      isModelsDirty);
  const editorRootPath = useMemo(() => {
    if (hasIndexParam) {
      return `/ai-providers/openai/${params.index ?? ''}`;
    }
    return '/ai-providers/openai/new';
  }, [hasIndexParam, params.index]);
  const canGuard = !resolvedLoading && !saving && !invalidIndexParam && !invalidIndex;

  const { allowNextNavigation } = useUnsavedChangesGuard({
    enabled: canGuard,
    shouldBlock: ({ nextLocation }) => {
      const nextPath = nextLocation.pathname;
      const isWithinRoot = nextPath === editorRootPath || nextPath.startsWith(`${editorRootPath}/`);
      return isDirty && !isWithinRoot;
    },
    dialog: {
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
      variant: 'danger',
    },
  });

  const handleSave = useCallback(async () => {
    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim();

    if (!name || !baseUrl) {
      showNotification(t('notification.openai_provider_required'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = buildOpenAIProviderPayload(form, {
        disabled: initialData?.disabled,
        testModel,
      });

      const nextList =
        editIndex !== null
          ? providers.map((item, idx) => (idx === editIndex ? payload : item))
          : [...providers, payload];

      await providersApi.saveOpenAIProviders(nextList);

      let syncedProviders = nextList;
      try {
        syncedProviders = await providersApi.getOpenAIProviders();
      } catch {
        // 保存成功后刷新失败时，回退到本地计算结果，避免页面数据为空或回退
      }

      setProviders(syncedProviders);
      updateConfigValue('openai-compatibility', syncedProviders);
      showNotification(
        editIndex !== null
          ? t('notification.openai_provider_updated')
          : t('notification.openai_provider_added'),
        'success'
      );
      allowNextNavigation();
      setDraftBaseline(draftKey, buildOpenAIBaseline(form, testModel));
      handleBack();
    } catch (err: unknown) {
      showNotification(`${t('notification.update_failed')}: ${getErrorMessage(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowNextNavigation,
    draftKey,
    editIndex,
    form,
    handleBack,
    initialData?.disabled,
    providers,
    setDraftBaseline,
    showNotification,
    t,
    testModel,
    updateConfigValue,
  ]);

  return (
    <Outlet
      context={
        {
          hasIndexParam,
          editIndex,
          invalidIndexParam,
          invalidIndex,
          disableControls,
          loading: resolvedLoading,
          saving,
          form,
          setForm,
          testModel,
          setTestModel,
          testStatus,
          setTestStatus,
          testMessage,
          setTestMessage,
          keyTestStatuses,
          setDraftKeyTestStatus: handleSetDraftKeyTestStatus,
          setDraftKeyTestStatuses: handleSetDraftKeyTestStatuses,
          resetDraftKeyTestStatuses: handleResetDraftKeyTestStatuses,
          availableModels,
          handleBack,
          handleSave,
          mergeDiscoveredModels,
        } satisfies OpenAIEditOutletContext
      }
    />
  );
}
