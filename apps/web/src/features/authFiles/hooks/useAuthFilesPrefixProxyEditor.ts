import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, type AuthFileFieldsPatch } from '@/services/api';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import { normalizeOAuthAliasEntries } from '@/features/authFiles/oauthAliasValidation';
import { useNotificationStore } from '@/stores';
import {
  applyAuthFileWebsockets,
  normalizeProviderKey,
  parsePriorityValue,
  readAuthFileWebsockets,
  supportsAuthFileWebsockets,
  supportsAuthFileUsingApi,
} from '@/features/authFiles/constants';
import { getAuthFilePatchTarget } from '@/features/authFiles/model/authFilesPageModel';
import { resolveAuthFileStatusMutationTarget } from '@/utils/authFileStatusMutation';

type AuthFileHeaders = Record<string, string>;
type AuthFileHeadersErrorKey =
  | 'auth_files.headers_invalid_json'
  | 'auth_files.headers_invalid_object'
  | 'auth_files.headers_invalid_value';
type AuthFileModelAliasesErrorKey =
  | 'auth_files.model_aliases_invalid_json'
  | 'auth_files.model_aliases_invalid_array'
  | 'auth_files.model_aliases_invalid_entry'
  | 'auth_files.model_aliases_same_as_name'
  | 'auth_files.model_aliases_duplicate';
type AuthFileContentErrorKey =
  | 'auth_files.prefix_proxy_invalid_json'
  | 'auth_files.prefix_proxy_html_challenge';

export type PrefixProxyEditorField =
  | 'prefix'
  | 'proxyUrl'
  | 'priority'
  | 'weight'
  | 'websockets'
  | 'usingApi'
  | 'note'
  | 'headersText'
  | 'modelAliasesText';

export type PrefixProxyEditorFieldValue = string | boolean;

export type PrefixProxyEditorState = {
  authFile: AuthFileItem;
  fileName: string;
  fileInfoText: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  originalText: string;
  rawText: string;
  invalidContentPreview: string;
  json: Record<string, unknown> | null;
  providerKey: string;
  prefix: string;
  proxyUrl: string;
  priority: string;
  weight: string;
  websockets: boolean;
  websocketsTouched: boolean;
  usingApi: boolean;
  usingApiTouched: boolean;
  note: string;
  noteTouched: boolean;
  headersText: string;
  headersTouched: boolean;
  headersError: string | null;
  modelAliasesText: string;
  modelAliasesTouched: boolean;
  modelAliasesError: string | null;
};

export type UseAuthFilesPrefixProxyEditorOptions = {
  disableControls: boolean;
  loadFiles: () => Promise<void>;
};

export type UseAuthFilesPrefixProxyEditorResult = {
  prefixProxyEditor: PrefixProxyEditorState | null;
  prefixProxyUpdatedText: string;
  prefixProxyDirty: boolean;
  openPrefixProxyEditor: (file: AuthFileItem) => Promise<void>;
  closePrefixProxyEditor: () => void;
  handlePrefixProxyChange: (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => void;
  handlePrefixProxySave: () => Promise<void>;
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateHeadersValue = (value: unknown): AuthFileHeadersErrorKey | null => {
  if (!isRecordObject(value)) {
    return 'auth_files.headers_invalid_object';
  }
  return Object.values(value).every((item) => typeof item === 'string')
    ? null
    : 'auth_files.headers_invalid_value';
};

const parseHeadersText = (
  text: string
): { value: AuthFileHeaders | null; errorKey: AuthFileHeadersErrorKey | null } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, errorKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { value: null, errorKey: 'auth_files.headers_invalid_json' };
  }

  const errorKey = validateHeadersValue(parsed);
  if (errorKey) {
    return { value: null, errorKey };
  }

  return { value: parsed as AuthFileHeaders, errorKey: null };
};


const emptyModelAliasEntry = (): OAuthModelAliasEntry => ({ name: '', alias: '', fork: false });

const readModelAliases = (value: unknown): OAuthModelAliasEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return emptyModelAliasEntry();
      }
      const entry = item as Record<string, unknown>;
      return {
        name: typeof entry.name === 'string' ? entry.name : '',
        alias: typeof entry.alias === 'string' ? entry.alias : '',
        fork: entry.fork === true,
        ...(entry.forceMapping === true || entry.force_mapping === true
          ? { forceMapping: true }
          : {}),
      } satisfies OAuthModelAliasEntry;
    })
    .filter((entry) => entry.name || entry.alias || entry.fork || entry.forceMapping);
};

const serializeModelAliasesText = (entries: OAuthModelAliasEntry[]): string => {
  if (!entries.length) return '';
  return JSON.stringify(
    entries.map((entry) => ({
      name: entry.name,
      alias: entry.alias,
      ...(entry.fork === true ? { fork: true } : {}),
      ...(entry.forceMapping === true ? { forceMapping: true } : {}),
    })),
    null,
    2
  );
};

const parseModelAliasesText = (
  text: string
): {
  value: OAuthModelAliasEntry[] | null;
  errorKey: AuthFileModelAliasesErrorKey | null;
  errorParams?: Record<string, string>;
} => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: [], errorKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { value: null, errorKey: 'auth_files.model_aliases_invalid_json' };
  }
  if (!Array.isArray(parsed)) {
    return { value: null, errorKey: 'auth_files.model_aliases_invalid_array' };
  }

  const draft: OAuthModelAliasEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { value: null, errorKey: 'auth_files.model_aliases_invalid_entry' };
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== 'string' || typeof entry.alias !== 'string') {
      return { value: null, errorKey: 'auth_files.model_aliases_invalid_entry' };
    }
    draft.push({
      name: entry.name,
      alias: entry.alias,
      ...(entry.fork === true ? { fork: true } : {}),
      ...(entry.forceMapping === true || entry.force_mapping === true
        ? { forceMapping: true }
        : {}),
    });
  }

  const normalization = normalizeOAuthAliasEntries(draft);
  const firstIssue = normalization.issues[0];
  if (firstIssue) {
    if (firstIssue.code === 'same_as_name') {
      return { value: null, errorKey: 'auth_files.model_aliases_same_as_name' };
    }
    if (firstIssue.code === 'duplicate_alias') {
      return {
        value: null,
        errorKey: 'auth_files.model_aliases_duplicate',
        errorParams: { alias: firstIssue.alias ?? '' },
      };
    }
    return { value: null, errorKey: 'auth_files.model_aliases_invalid_entry' };
  }
  // Refuse partial drafts where rows are incomplete after the user entered something.
  if (normalization.incompleteCount > 0) {
    return { value: null, errorKey: 'auth_files.model_aliases_invalid_entry' };
  }
  return { value: normalization.accepted, errorKey: null };
};

const modelAliasesEqual = (left: OAuthModelAliasEntry[], right: OAuthModelAliasEntry[]): boolean =>
  serializeModelAliasesText(left) === serializeModelAliasesText(right);

const normalizeTextField = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const INVALID_CONTENT_PREVIEW_LIMIT = 1000;

const buildInvalidContentPreview = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= INVALID_CONTENT_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, INVALID_CONTENT_PREVIEW_LIMIT)}\n...`;
};

const getAuthFileContentErrorKey = (text: string): AuthFileContentErrorKey => {
  const head = text.trimStart().slice(0, 4096).toLowerCase();
  const looksLikeHtml =
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<head') ||
    head.includes('<body');
  const looksLikeChallenge =
    head.includes('cf_chl') ||
    head.includes('__cf_chl_tk') ||
    head.includes('challenge-platform') ||
    head.includes('cloudflare');

  return looksLikeHtml || looksLikeChallenge
    ? 'auth_files.prefix_proxy_html_challenge'
    : 'auth_files.prefix_proxy_invalid_json';
};

const buildInvalidAuthFileContentState = (
  text: string,
  resolveError: (key: AuthFileContentErrorKey) => string
): Pick<
  PrefixProxyEditorState,
  'loading' | 'error' | 'rawText' | 'originalText' | 'invalidContentPreview'
> => ({
  loading: false,
  error: resolveError(getAuthFileContentErrorKey(text)),
  rawText: text,
  originalText: text,
  invalidContentPreview: buildInvalidContentPreview(text),
});

const hasKeys = (value: Record<string, unknown> | AuthFileFieldsPatch | null): boolean =>
  Boolean(value && Object.keys(value).length > 0);

const normalizeHeaders = (value: unknown): AuthFileHeaders => {
  if (!isRecordObject(value)) return {};

  return Object.entries(value).reduce<AuthFileHeaders>((result, [key, rawValue]) => {
    if (typeof rawValue !== 'string') return result;
    const name = key.trim();
    const headerValue = rawValue.trim();
    if (!name || !headerValue) return result;
    result[name] = headerValue;
    return result;
  }, {});
};

const buildHeadersPatch = (
  originalHeaders: AuthFileHeaders,
  nextHeaders: AuthFileHeaders
): AuthFileHeaders | undefined => {
  const patch: AuthFileHeaders = {};
  const nextNames = new Set(Object.keys(nextHeaders));

  Object.entries(nextHeaders).forEach(([name, value]) => {
    if (originalHeaders[name] !== value) {
      patch[name] = value;
    }
  });

  Object.keys(originalHeaders).forEach((name) => {
    if (!nextNames.has(name)) {
      patch[name] = '';
    }
  });

  return Object.keys(patch).length > 0 ? patch : undefined;
};

const applyHeadersPatch = (
  value: Record<string, unknown>,
  headersPatch: AuthFileHeaders | undefined
) => {
  if (!headersPatch) return;

  const nextHeaders = normalizeHeaders(value.headers);
  Object.entries(headersPatch).forEach(([name, rawValue]) => {
    const headerName = name.trim();
    if (!headerName) return;
    const headerValue = rawValue.trim();
    if (!headerValue) {
      delete nextHeaders[headerName];
      return;
    }
    nextHeaders[headerName] = headerValue;
  });

  if (Object.keys(nextHeaders).length > 0) {
    value.headers = nextHeaders;
  } else {
    delete value.headers;
  }
};

const buildAuthFileFieldsPatch = (
  editor: PrefixProxyEditorState,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string,
  resolveModelAliasesError: (
    key: AuthFileModelAliasesErrorKey,
    params?: Record<string, string>
  ) => string = (key) => key
): AuthFileFieldsPatch => {
  const original = editor.json ?? {};
  const patch: AuthFileFieldsPatch = {};

  const originalPrefix = normalizeTextField(original.prefix);
  const nextPrefix = editor.prefix.trim();
  if (nextPrefix !== originalPrefix) {
    patch.prefix = nextPrefix;
  }

  const originalProxyURL = normalizeTextField(original.proxy_url);
  const nextProxyURL = editor.proxyUrl.trim();
  if (nextProxyURL !== originalProxyURL) {
    patch.proxy_url = nextProxyURL;
  }

  const originalPriority = parsePriorityValue(original.priority);
  const priorityText = editor.priority.trim();
  const nextPriority = parsePriorityValue(priorityText);
  if (!priorityText) {
    if (originalPriority !== undefined && originalPriority !== 0) {
      patch.priority = 0;
    }
  } else if (nextPriority !== undefined) {
    if (nextPriority === 0) {
      if (originalPriority !== undefined && originalPriority !== 0) {
        patch.priority = 0;
      }
    } else if (nextPriority !== originalPriority) {
      patch.priority = nextPriority;
    }
  }

  // weight is only meaningful when > 0; empty/0/negative clears it (backend treats <=0 as absent).
  const originalWeight = parsePriorityValue(original.weight);
  const weightText = editor.weight.trim();
  const nextWeight = parsePriorityValue(weightText);
  if (!weightText) {
    if (originalWeight !== undefined && originalWeight > 0) {
      patch.weight = 0;
    }
  } else if (nextWeight !== undefined) {
    if (nextWeight <= 0) {
      if (originalWeight !== undefined && originalWeight > 0) {
        patch.weight = 0;
      }
    } else if (nextWeight !== originalWeight) {
      patch.weight = nextWeight;
    }
  }

  if (editor.noteTouched) {
    const originalNote = normalizeTextField(original.note);
    const nextNote = editor.note.trim();
    if (nextNote !== originalNote) {
      patch.note = nextNote;
    }
  }

  if (editor.headersTouched) {
    const { value: parsedHeaders, errorKey } = parseHeadersText(editor.headersText);
    if (errorKey) {
      throw new Error(resolveHeadersError(errorKey));
    }
    const headersPatch = buildHeadersPatch(
      normalizeHeaders(original.headers),
      normalizeHeaders(parsedHeaders ?? {})
    );
    if (headersPatch) {
      patch.headers = headersPatch;
    }
  }

  if (supportsAuthFileWebsockets(editor.providerKey) && editor.websocketsTouched) {
    const originalWebsockets = readAuthFileWebsockets(original);
    const nextWebsockets = Boolean(editor.websockets);
    if (nextWebsockets !== originalWebsockets) {
      patch.websockets = nextWebsockets;
    }
  }
  if (supportsAuthFileUsingApi(editor.providerKey) && editor.usingApiTouched) {
    const originalUsingApi = original.using_api === true;
    if (editor.usingApi !== originalUsingApi) patch.using_api = editor.usingApi;
  }

  if (editor.modelAliasesTouched) {
    const { value: nextAliases, errorKey, errorParams } = parseModelAliasesText(
      editor.modelAliasesText
    );
    if (errorKey) {
      throw new Error(resolveModelAliasesError(errorKey, errorParams));
    }
    const originalAliases = readModelAliases(
      original.model_aliases ?? original['model-aliases']
    );
    const normalizedNext = nextAliases ?? [];
    if (!modelAliasesEqual(originalAliases, normalizedNext)) {
      // Empty array clears the per-account aliases field on the auth file.
      patch.model_aliases = normalizedNext;
    }
  }

  return patch;
};

const buildPrefixProxyUpdatedText = (
  editor: PrefixProxyEditorState | null,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string,
  resolveModelAliasesError: (
    key: AuthFileModelAliasesErrorKey,
    params?: Record<string, string>
  ) => string = (key) => key
): string => {
  if (!editor?.json) return editor?.rawText ?? '';
  const patch = buildAuthFileFieldsPatch(editor, resolveHeadersError, resolveModelAliasesError);
  let next: Record<string, unknown> = { ...editor.json };
  if (patch.prefix !== undefined) {
    if (patch.prefix) {
      next.prefix = patch.prefix;
    } else {
      delete next.prefix;
    }
  }
  if (patch.proxy_url !== undefined) {
    if (patch.proxy_url) {
      next.proxy_url = patch.proxy_url;
    } else {
      delete next.proxy_url;
    }
  }

  if (patch.priority !== undefined) {
    if (patch.priority === 0) {
      delete next.priority;
    } else {
      next.priority = patch.priority;
    }
  }

  if (patch.weight !== undefined) {
    if (patch.weight <= 0) {
      delete next.weight;
    } else {
      next.weight = patch.weight;
    }
  }

  if (patch.note !== undefined) {
    if (patch.note) {
      next.note = patch.note;
    } else if ('note' in next) {
      delete next.note;
    }
  }

  applyHeadersPatch(next, patch.headers);

  if (patch.websockets !== undefined) {
    next = applyAuthFileWebsockets(next, patch.websockets);
  }
  if (patch.using_api !== undefined) next.using_api = patch.using_api;

  if (patch.model_aliases !== undefined) {
    if (patch.model_aliases && patch.model_aliases.length > 0) {
      next.model_aliases = patch.model_aliases;
      if ('model-aliases' in next) {
        delete next['model-aliases'];
      }
    } else {
      delete next.model_aliases;
      if ('model-aliases' in next) {
        delete next['model-aliases'];
      }
    }
  }

  return JSON.stringify(next);
};

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls, loadFiles } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);

  const hasBlockingValidationError = Boolean(
    (prefixProxyEditor?.headersTouched && prefixProxyEditor.headersError) ||
      (prefixProxyEditor?.modelAliasesTouched && prefixProxyEditor.modelAliasesError)
  );
  const resolveModelAliasesError = (
    key: AuthFileModelAliasesErrorKey,
    params?: Record<string, string>
  ) => t(key, params);
  const prefixProxyUpdatedText =
    prefixProxyEditor && !hasBlockingValidationError
      ? buildPrefixProxyUpdatedText(prefixProxyEditor, (key) => t(key), resolveModelAliasesError)
      : '';

  const prefixProxyPatch =
    prefixProxyEditor?.json && !hasBlockingValidationError
      ? buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key), resolveModelAliasesError)
      : null;

  const prefixProxyDirty = hasKeys(prefixProxyPatch);

  const closePrefixProxyEditor = () => {
    setPrefixProxyEditor(null);
  };

  const openPrefixProxyEditor = async (file: AuthFileItem) => {
    const name = file.name;
    const fileProviderKey = normalizeProviderKey(String(file.type ?? file.provider ?? ''));

    if (disableControls) return;
    if (prefixProxyEditor?.fileName === name) {
      setPrefixProxyEditor(null);
      return;
    }

    setPrefixProxyEditor({
      authFile: file,
      fileName: name,
      fileInfoText: JSON.stringify(file, null, 2),
      loading: true,
      saving: false,
      error: null,
      originalText: '',
      rawText: '',
      invalidContentPreview: '',
      json: null,
      providerKey: fileProviderKey,
      prefix: '',
      proxyUrl: '',
      priority: '',
      weight: '',
      websockets: false,
      websocketsTouched: false,
      usingApi: false,
      usingApiTouched: false,
      note: '',
      noteTouched: false,
      headersText: '',
      headersTouched: false,
      headersError: null,
      modelAliasesText: '',
      modelAliasesTouched: false,
      modelAliasesError: null,
    });

    try {
      const rawText = await authFilesApi.downloadText(name);
      const trimmed = rawText.trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            ...buildInvalidAuthFileContentState(rawText, (key) => t(key)),
          };
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            ...buildInvalidAuthFileContentState(rawText, (key) => t(key)),
          };
        });
        return;
      }

      const json = { ...(parsed as Record<string, unknown>) };
      const originalText = JSON.stringify(json);
      const prefix = typeof json.prefix === 'string' ? json.prefix : '';
      const proxyUrl = typeof json.proxy_url === 'string' ? json.proxy_url : '';
      const priority = parsePriorityValue(json.priority);
      const weight = parsePriorityValue(json.weight);
      const providerKey = normalizeProviderKey(
        String(json.type ?? json.provider ?? file.type ?? file.provider ?? '')
      );
      const websockets = supportsAuthFileWebsockets(providerKey)
        ? readAuthFileWebsockets(json)
        : false;
      const usingApi = supportsAuthFileUsingApi(providerKey) && json.using_api === true;
      const note = typeof json.note === 'string' ? json.note : '';
      const headers = json.headers;
      let headersText = '';
      let headersError: string | null = null;
      if (headers !== undefined) {
        headersText = JSON.stringify(headers, null, 2);
        const { errorKey } = parseHeadersText(headersText);
        headersError = errorKey ? t(errorKey) : null;
      }

      const modelAliases = readModelAliases(json.model_aliases ?? json['model-aliases']);
      const modelAliasesText = serializeModelAliasesText(modelAliases);
      let modelAliasesError: string | null = null;
      if (modelAliasesText) {
        const parsedAliases = parseModelAliasesText(modelAliasesText);
        if (parsedAliases.errorKey) {
          modelAliasesError = t(parsedAliases.errorKey, parsedAliases.errorParams);
        }
      }

      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return {
          ...prev,
          loading: false,
          originalText,
          rawText: originalText,
          invalidContentPreview: '',
          json,
          providerKey,
          prefix,
          proxyUrl,
          priority: priority !== undefined ? String(priority) : '',
          weight: weight !== undefined && weight > 0 ? String(weight) : '',
          websockets,
          websocketsTouched: false,
          usingApi,
          usingApiTouched: false,
          note,
          noteTouched: false,
          headersText,
          headersTouched: false,
          headersError,
          modelAliasesText,
          modelAliasesTouched: false,
          modelAliasesError,
          error: null,
        };
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.download_failed');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, loading: false, error: errorMessage, rawText: '' };
      });
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  const handlePrefixProxyChange = (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => {
    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      if (field === 'prefix') return { ...prev, prefix: String(value) };
      if (field === 'proxyUrl') return { ...prev, proxyUrl: String(value) };
      if (field === 'priority') return { ...prev, priority: String(value) };
      if (field === 'weight') return { ...prev, weight: String(value) };
      if (field === 'websockets') {
        return { ...prev, websockets: Boolean(value), websocketsTouched: true };
      }
      if (field === 'usingApi') {
        return { ...prev, usingApi: Boolean(value), usingApiTouched: true };
      }
      if (field === 'note') return { ...prev, note: String(value), noteTouched: true };
      if (field === 'headersText') {
        const headersText = String(value);
        const { errorKey } = parseHeadersText(headersText);
        return {
          ...prev,
          headersText,
          headersTouched: true,
          headersError: errorKey ? t(errorKey) : null,
        };
      }
      if (field === 'modelAliasesText') {
        const modelAliasesText = String(value);
        const { errorKey, errorParams } = parseModelAliasesText(modelAliasesText);
        return {
          ...prev,
          modelAliasesText,
          modelAliasesTouched: true,
          modelAliasesError: errorKey ? t(errorKey, errorParams) : null,
        };
      }
      return prev;
    });
  };

  const handlePrefixProxySave = async () => {
    if (!prefixProxyEditor?.json) return;
    if (!prefixProxyDirty) return;

    const name = prefixProxyEditor.fileName;
    let payload: AuthFileFieldsPatch;
    try {
      payload = buildAuthFileFieldsPatch(
        prefixProxyEditor,
        (key) => t(key),
        (key, params) => t(key, params)
      );
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid format';
      showNotification(errorMessage, 'error');
      return;
    }
    if (!hasKeys(payload)) return;

    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== name) return prev;
      return { ...prev, saving: true };
    });

    try {
      const response = await authFilesApi.list();
      const currentFiles = Array.isArray(response.files) ? response.files : [];
      const resolution = resolveAuthFileStatusMutationTarget(
        currentFiles,
        getAuthFilePatchTarget(prefixProxyEditor.authFile)
      );
      if (!resolution.target || resolution.failure !== null || resolution.scope !== 'credential') {
        throw new Error(t('auth_files.status_mutation_scope_ambiguous', { name }));
      }
      await authFilesApi.patchFieldsWithPluginSourceFallback(
        getAuthFilePatchTarget(resolution.target),
        payload,
        currentFiles
          .filter((file) => file.name.trim() === resolution.target?.name.trim())
          .map(getAuthFilePatchTarget)
      );
      showNotification(t('auth_files.prefix_proxy_saved_success', { name }), 'success');
      await loadFiles();
      setPrefixProxyEditor(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, saving: false };
      });
    }
  };

  return {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  };
}
