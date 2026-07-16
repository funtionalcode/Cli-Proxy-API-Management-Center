import type {
  ApiKeyEntry,
  AuthFileItem,
  Config,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';

export type ProxyConfigScope = 'global' | 'provider' | 'auth-file';
export type ProxyConfigStatus = 'override' | 'inherit' | 'direct' | 'unset' | 'invalid';
export type ProxyConfigEnabledState = 'enabled' | 'disabled';
export type ProxyConfigEnabledFilter = ProxyConfigEnabledState | 'all';
export type ProviderProxyKind = 'gemini' | 'codex' | 'claude' | 'vertex' | 'openai';

export const DEFAULT_PROXY_CONFIG_ENABLED_FILTER: ProxyConfigEnabledFilter = 'enabled';

export type ProxyConfigTarget =
  | { type: 'global' }
  | { type: 'provider'; provider: Exclude<ProviderProxyKind, 'openai'>; index: number }
  | { type: 'openai-entry'; providerIndex: number; entryIndex: number }
  | { type: 'auth-file'; name: string; authIndex?: string | number | null };

export type ParsedProxyURL = {
  raw: string;
  normalized: string;
  empty: boolean;
  direct: boolean;
  valid: boolean;
  scheme: string;
  host: string;
  port: string;
  username: string;
  passwordMasked: string;
};

export type ProxyConfigRow = {
  id: string;
  scope: ProxyConfigScope;
  provider: string;
  name: string;
  detail: string;
  proxyUrl: string;
  parsed: ParsedProxyURL;
  status: ProxyConfigStatus;
  enabledState: ProxyConfigEnabledState;
  target: ProxyConfigTarget;
  searchText: string;
};

type ProviderConfigLists = {
  gemini: GeminiKeyConfig[];
  codex: ProviderKeyConfig[];
  claude: ProviderKeyConfig[];
  vertex: ProviderKeyConfig[];
  openai: OpenAIProviderConfig[];
};

export type BuildProxyConfigRowsInput = {
  config: Config | null;
  providers: ProviderConfigLists;
  authFiles: AuthFileItem[];
};

const DIRECT_PROXY_VALUES = new Set(['direct', 'none']);
const DEFAULT_MASK = '••••••';

const decodeURLPart = (value: string): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseProxyURL = (value: unknown): ParsedProxyURL => {
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalized = raw.toLowerCase();

  if (!raw) {
    return {
      raw,
      normalized: '',
      empty: true,
      direct: false,
      valid: true,
      scheme: '',
      host: '',
      port: '',
      username: '',
      passwordMasked: '',
    };
  }

  if (DIRECT_PROXY_VALUES.has(normalized)) {
    return {
      raw,
      normalized,
      empty: false,
      direct: true,
      valid: true,
      scheme: normalized,
      host: '',
      port: '',
      username: '',
      passwordMasked: '',
    };
  }

  try {
    const parsed = new URL(raw);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const host = parsed.hostname;

    return {
      raw,
      normalized: raw,
      empty: false,
      direct: false,
      valid: Boolean(scheme && host),
      scheme,
      host,
      port: parsed.port,
      username: decodeURLPart(parsed.username),
      passwordMasked: parsed.password ? DEFAULT_MASK : '',
    };
  } catch {
    return {
      raw,
      normalized: raw,
      empty: false,
      direct: false,
      valid: false,
      scheme: '',
      host: '',
      port: '',
      username: '',
      passwordMasked: '',
    };
  }
};

export const maskProxyURL = (value: unknown): string => {
  const parsed = parseProxyURL(value);
  if (parsed.empty) return '';
  if (parsed.direct || !parsed.valid) return parsed.raw;

  try {
    const url = new URL(parsed.raw);
    if (url.password) {
      url.password = DEFAULT_MASK;
    }
    return url.toString();
  } catch {
    return parsed.raw;
  }
};

const readString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const readAuthIndex = (value: {
  authIndex?: string | number | null;
  [key: string]: unknown;
}): string | number | null | undefined => {
  const raw = value.authIndex ?? value.auth_index ?? value['auth-index'];
  if (raw === undefined || raw === null) return raw;
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  return String(raw);
};

const normalizeProviderName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'openai') return 'OpenAI';
  if (trimmed.toLowerCase() === 'xai') return 'xAI';
  if (trimmed.toLowerCase() === 'iflow') return 'iFlow';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const maskCredential = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}...`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const buildIdentity = (
  item: { apiKey?: string; authIndex?: string | number | null; prefix?: string; baseUrl?: string },
  fallback: string
): string => {
  const authIndex = readAuthIndex(item);
  if (authIndex !== undefined && authIndex !== null && String(authIndex).trim()) {
    return `auth-index ${String(authIndex).trim()}`;
  }
  if (item.prefix?.trim()) return item.prefix.trim();
  if (item.apiKey?.trim()) return maskCredential(item.apiKey);
  if (item.baseUrl?.trim()) return item.baseUrl.trim();
  return fallback;
};

const getProxyStatus = (proxyUrl: string, hasGlobalProxy: boolean): ProxyConfigStatus => {
  const parsed = parseProxyURL(proxyUrl);
  if (!parsed.valid) return 'invalid';
  if (parsed.direct) return 'direct';
  if (parsed.empty) return hasGlobalProxy ? 'inherit' : 'unset';
  return 'override';
};

const createRow = (
  row: Omit<ProxyConfigRow, 'parsed' | 'status' | 'searchText'>,
  hasGlobalProxy: boolean
): ProxyConfigRow => {
  const parsed = parseProxyURL(row.proxyUrl);
  const status = getProxyStatus(row.proxyUrl, hasGlobalProxy);
  const searchText = [
    row.scope,
    row.provider,
    row.name,
    row.detail,
    maskProxyURL(row.proxyUrl),
    parsed.scheme,
    parsed.host,
    parsed.port,
    parsed.username,
    status,
  ]
    .join('\n')
    .toLowerCase();

  return {
    ...row,
    parsed,
    status,
    searchText,
  };
};

const providerLabels: Record<ProviderProxyKind, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  vertex: 'Vertex',
  openai: 'OpenAI compatible',
};

const addProviderRows = <T extends GeminiKeyConfig | ProviderKeyConfig>(
  rows: ProxyConfigRow[],
  provider: Exclude<ProviderProxyKind, 'openai'>,
  items: T[],
  hasGlobalProxy: boolean
) => {
  items.forEach((item, index) => {
    rows.push(
      createRow(
        {
          id: `provider:${provider}:${index}`,
          scope: 'provider',
          provider: providerLabels[provider],
          name: buildIdentity(item, `${providerLabels[provider]} #${index + 1}`),
          detail: item.baseUrl?.trim() || item.prefix?.trim() || '',
          proxyUrl: item.proxyUrl?.trim() || '',
          enabledState: 'enabled',
          target: { type: 'provider', provider, index },
        },
        hasGlobalProxy
      )
    );
  });
};

const addOpenAIRows = (
  rows: ProxyConfigRow[],
  providers: OpenAIProviderConfig[],
  hasGlobalProxy: boolean
) => {
  providers.forEach((provider, providerIndex) => {
    const entries = Array.isArray(provider.apiKeyEntries) ? provider.apiKeyEntries : [];
    entries.forEach((entry: ApiKeyEntry, entryIndex) => {
      rows.push(
        createRow(
          {
            id: `provider:openai:${providerIndex}:${entryIndex}`,
            scope: 'provider',
            provider: provider.name?.trim() || providerLabels.openai,
            name: buildIdentity(entry, `${provider.name || providerLabels.openai} #${entryIndex + 1}`),
            detail: provider.baseUrl?.trim() || '',
            proxyUrl: entry.proxyUrl?.trim() || '',
            enabledState: provider.disabled === true ? 'disabled' : 'enabled',
            target: { type: 'openai-entry', providerIndex, entryIndex },
          },
          hasGlobalProxy
        )
      );
    });
  });
};

const readAuthFileProxyURL = (file: AuthFileItem): string =>
  readString(file as Record<string, unknown>, ['proxy_url', 'proxyUrl', 'proxy-url']);

const readAuthFileAccount = (file: AuthFileItem): string => {
  const record = file as Record<string, unknown>;
  return readString(record, [
    'email',
    'account',
    'account_id',
    'accountId',
    'user',
    'username',
    'note',
  ]);
};

const addAuthFileRows = (
  rows: ProxyConfigRow[],
  files: AuthFileItem[],
  hasGlobalProxy: boolean
) => {
  files.forEach((file, index) => {
    const authIndex = readAuthIndex(file);
    const provider = normalizeProviderName(String(file.type ?? file.provider ?? 'unknown'));
    const account = readAuthFileAccount(file);
    const authIndexText =
      authIndex !== undefined && authIndex !== null && String(authIndex).trim()
        ? `auth-index ${String(authIndex).trim()}`
        : '';

    rows.push(
      createRow(
        {
          id: `auth-file:${file.name}:${String(authIndex ?? index)}`,
          scope: 'auth-file',
          provider,
          name: file.name,
          detail: [authIndexText, account].filter(Boolean).join(' · '),
          proxyUrl: readAuthFileProxyURL(file),
          enabledState: file.disabled === true ? 'disabled' : 'enabled',
          target: { type: 'auth-file', name: file.name, authIndex },
        },
        hasGlobalProxy
      )
    );
  });
};

export const buildProxyConfigRows = ({
  config,
  providers,
  authFiles,
}: BuildProxyConfigRowsInput): ProxyConfigRow[] => {
  const rows: ProxyConfigRow[] = [];
  const globalProxyURL = config?.proxyUrl?.trim() || '';
  const hasGlobalProxy = Boolean(globalProxyURL);

  rows.push(
    createRow(
      {
        id: 'global',
        scope: 'global',
        provider: 'Global',
        name: 'config.yaml',
        detail: 'proxy-url',
        proxyUrl: globalProxyURL,
        enabledState: 'enabled',
        target: { type: 'global' },
      },
      hasGlobalProxy
    )
  );

  addProviderRows(rows, 'gemini', providers.gemini, hasGlobalProxy);
  addProviderRows(rows, 'codex', providers.codex, hasGlobalProxy);
  addProviderRows(rows, 'claude', providers.claude, hasGlobalProxy);
  addProviderRows(rows, 'vertex', providers.vertex, hasGlobalProxy);
  addOpenAIRows(rows, providers.openai, hasGlobalProxy);
  addAuthFileRows(rows, authFiles, hasGlobalProxy);

  return rows;
};

export const filterProxyConfigRows = (
  rows: ProxyConfigRow[],
  scope: ProxyConfigScope | 'all',
  enabledFilter: ProxyConfigEnabledFilter,
  search: string
): ProxyConfigRow[] => {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (scope !== 'all' && row.scope !== scope) return false;
    if (enabledFilter !== 'all' && row.enabledState !== enabledFilter) return false;
    if (!query) return true;
    return row.searchText.includes(query);
  });
};
