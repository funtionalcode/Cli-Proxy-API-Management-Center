import type { QuotaSortMode } from '@/components/quota/quotaConfigs';

export type QuotaSectionType =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'kimi'
  | 'xai';
export type QuotaSectionViewMode = 'paged' | 'all';
export type QuotaAccountDisplayMode = 'masked' | 'full';

export type QuotaPageUiState = {
  searchQuery: string;
  sortMode: QuotaSortMode;
  sectionViewModes: Partial<Record<QuotaSectionType, QuotaSectionViewMode>>;
  accountDisplayModes: Partial<Record<QuotaSectionType, QuotaAccountDisplayMode>>;
};

export const QUOTA_PAGE_UI_STATE_STORAGE_KEY = 'quotaPage.uiState';
export const DEFAULT_QUOTA_ACCOUNT_DISPLAY_MODE: QuotaAccountDisplayMode = 'full';

const QUOTA_SORT_MODE_SET = new Set<QuotaSortMode>([
  'default',
  'name-asc',
  'plan-desc',
  'plan-asc',
]);
const QUOTA_SECTION_TYPE_SET = new Set<QuotaSectionType>([
  'antigravity',
  'claude',
  'codex',
  'kimi',
  'xai',
]);
const QUOTA_ACCOUNT_DISPLAY_MODE_SET = new Set<QuotaAccountDisplayMode>(['masked', 'full']);

export const getDefaultQuotaPageUiState = (): QuotaPageUiState => ({
  searchQuery: '',
  sortMode: 'default',
  sectionViewModes: {},
  accountDisplayModes: {},
});

export const normalizeQuotaSortMode = (value: unknown): QuotaSortMode =>
  typeof value === 'string' && QUOTA_SORT_MODE_SET.has(value as QuotaSortMode)
    ? (value as QuotaSortMode)
    : 'default';

export const normalizeQuotaSectionViewMode = (value: unknown): QuotaSectionViewMode =>
  value === 'all' ? 'all' : 'paged';

export const normalizeQuotaAccountDisplayMode = (value: unknown): QuotaAccountDisplayMode =>
  typeof value === 'string' &&
  QUOTA_ACCOUNT_DISPLAY_MODE_SET.has(value as QuotaAccountDisplayMode)
    ? (value as QuotaAccountDisplayMode)
    : DEFAULT_QUOTA_ACCOUNT_DISPLAY_MODE;

export const normalizeQuotaSectionType = (value: unknown): QuotaSectionType | null =>
  typeof value === 'string' && QUOTA_SECTION_TYPE_SET.has(value as QuotaSectionType)
    ? (value as QuotaSectionType)
    : null;

const normalizeSectionViewModes = (
  value: unknown
): Partial<Record<QuotaSectionType, QuotaSectionViewMode>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Partial<Record<QuotaSectionType, QuotaSectionViewMode>> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, mode]) => {
    const sectionType = normalizeQuotaSectionType(key);
    if (!sectionType) return;
    result[sectionType] = normalizeQuotaSectionViewMode(mode);
  });
  return result;
};

const normalizeAccountDisplayModes = (
  value: unknown
): Partial<Record<QuotaSectionType, QuotaAccountDisplayMode>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Partial<Record<QuotaSectionType, QuotaAccountDisplayMode>> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, mode]) => {
    const sectionType = normalizeQuotaSectionType(key);
    if (!sectionType) return;
    result[sectionType] = normalizeQuotaAccountDisplayMode(mode);
  });
  return result;
};

export const normalizeQuotaPageUiState = (value: unknown): QuotaPageUiState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return getDefaultQuotaPageUiState();
  }

  const record = value as Record<string, unknown>;
  return {
    searchQuery: typeof record.searchQuery === 'string' ? record.searchQuery : '',
    sortMode: normalizeQuotaSortMode(record.sortMode),
    sectionViewModes: normalizeSectionViewModes(record.sectionViewModes),
    accountDisplayModes: normalizeAccountDisplayModes(record.accountDisplayModes),
  };
};

export const readQuotaPageUiState = (): QuotaPageUiState => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return getDefaultQuotaPageUiState();
  }

  try {
    const raw = window.localStorage.getItem(QUOTA_PAGE_UI_STATE_STORAGE_KEY);
    if (raw) {
      return normalizeQuotaPageUiState(JSON.parse(raw));
    }
  } catch {
    // Ignore storage failures and fall back to defaults.
  }

  return getDefaultQuotaPageUiState();
};

export const writeQuotaPageUiState = (state: QuotaPageUiState) => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;

  try {
    window.localStorage.setItem(
      QUOTA_PAGE_UI_STATE_STORAGE_KEY,
      JSON.stringify(normalizeQuotaPageUiState(state))
    );
  } catch {
    // Ignore storage failures and keep runtime state only.
  }
};
