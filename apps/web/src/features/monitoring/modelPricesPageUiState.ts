import type { ModelPriceFilter } from './model/modelPricesPageModel';

export type ModelPricesPageUiState = {
  search: string;
  filter: ModelPriceFilter;
};

export const MODEL_PRICES_PAGE_UI_STATE_STORAGE_KEY = 'modelPricesPage.uiState';

const MODEL_PRICE_FILTER_SET = new Set<ModelPriceFilter>([
  'all',
  'missing',
  'candidates',
  'saved',
]);

export const getDefaultModelPricesPageUiState = (): ModelPricesPageUiState => ({
  search: '',
  filter: 'all',
});

export const normalizeModelPriceFilter = (value: unknown): ModelPriceFilter =>
  typeof value === 'string' && MODEL_PRICE_FILTER_SET.has(value as ModelPriceFilter)
    ? (value as ModelPriceFilter)
    : 'all';

export const normalizeModelPricesPageUiState = (value: unknown): ModelPricesPageUiState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return getDefaultModelPricesPageUiState();
  }

  const record = value as Record<string, unknown>;
  return {
    search: typeof record.search === 'string' ? record.search : '',
    filter: normalizeModelPriceFilter(record.filter),
  };
};

export const readModelPricesPageUiState = (): ModelPricesPageUiState => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return getDefaultModelPricesPageUiState();
  }

  try {
    const raw = window.localStorage.getItem(MODEL_PRICES_PAGE_UI_STATE_STORAGE_KEY);
    if (raw) {
      return normalizeModelPricesPageUiState(JSON.parse(raw));
    }
  } catch {
    // Ignore storage failures and fall back to defaults.
  }

  return getDefaultModelPricesPageUiState();
};

export const writeModelPricesPageUiState = (state: ModelPricesPageUiState) => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;

  try {
    window.localStorage.setItem(
      MODEL_PRICES_PAGE_UI_STATE_STORAGE_KEY,
      JSON.stringify(normalizeModelPricesPageUiState(state))
    );
  } catch {
    // Ignore storage failures and keep runtime state only.
  }
};
