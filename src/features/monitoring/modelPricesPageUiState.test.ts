import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MODEL_PRICES_PAGE_UI_STATE_STORAGE_KEY,
  getDefaultModelPricesPageUiState,
  normalizeModelPriceFilter,
  normalizeModelPricesPageUiState,
  readModelPricesPageUiState,
  writeModelPricesPageUiState,
} from './modelPricesPageUiState';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const createMemoryStorage = (): StorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

const originalWindow = (globalThis as { window?: unknown }).window;

describe('modelPricesPageUiState', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = createMemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('normalizes filter values', () => {
    expect(normalizeModelPriceFilter('missing')).toBe('missing');
    expect(normalizeModelPriceFilter('candidates')).toBe('candidates');
    expect(normalizeModelPriceFilter('bad')).toBe('all');
  });

  it('normalizes page state from arbitrary input', () => {
    expect(normalizeModelPricesPageUiState(null)).toEqual(getDefaultModelPricesPageUiState());
    expect(
      normalizeModelPricesPageUiState({
        search: 'gpt',
        filter: 'saved',
      })
    ).toEqual({
      search: 'gpt',
      filter: 'saved',
    });
    expect(
      normalizeModelPricesPageUiState({
        search: 123,
        filter: 'unknown',
      })
    ).toEqual(getDefaultModelPricesPageUiState());
  });

  it('persists and reads ui state via localStorage', () => {
    writeModelPricesPageUiState({ search: 'claude', filter: 'missing' });
    expect(JSON.parse(storage.getItem(MODEL_PRICES_PAGE_UI_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      search: 'claude',
      filter: 'missing',
    });
    expect(readModelPricesPageUiState()).toEqual({ search: 'claude', filter: 'missing' });
  });

  it('returns defaults when stored payload is invalid JSON', () => {
    storage.setItem(MODEL_PRICES_PAGE_UI_STATE_STORAGE_KEY, '{not json');
    expect(readModelPricesPageUiState()).toEqual(getDefaultModelPricesPageUiState());
  });
});
