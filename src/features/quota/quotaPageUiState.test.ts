import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  QUOTA_PAGE_UI_STATE_STORAGE_KEY,
  getDefaultQuotaPageUiState,
  normalizeQuotaAccountDisplayMode,
  normalizeQuotaPageUiState,
  normalizeQuotaSectionType,
  normalizeQuotaSectionViewMode,
  normalizeQuotaSortMode,
  readQuotaPageUiState,
  writeQuotaPageUiState,
} from './quotaPageUiState';

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

describe('quotaPageUiState', () => {
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

  it('normalizes enum-like fields', () => {
    expect(normalizeQuotaSortMode('plan-desc')).toBe('plan-desc');
    expect(normalizeQuotaSortMode('unknown')).toBe('default');
    expect(normalizeQuotaSectionViewMode('all')).toBe('all');
    expect(normalizeQuotaSectionViewMode('bad')).toBe('paged');
    expect(normalizeQuotaAccountDisplayMode('full')).toBe('full');
    expect(normalizeQuotaAccountDisplayMode('visible')).toBe('full');
    expect(normalizeQuotaSectionType('xai')).toBe('xai');
    expect(normalizeQuotaSectionType('bad')).toBeNull();
  });

  it('normalizes page state and drops unknown sections', () => {
    expect(normalizeQuotaPageUiState(null)).toEqual(getDefaultQuotaPageUiState());
    expect(
      normalizeQuotaPageUiState({
        searchQuery: 'pro',
        sortMode: 'name-asc',
        sectionViewModes: {
          codex: 'all',
          claude: 'bad',
          unknown: 'all',
        },
        accountDisplayModes: {
          codex: 'full',
          claude: 'bad',
          unknown: 'full',
        },
      })
    ).toEqual({
      searchQuery: 'pro',
      sortMode: 'name-asc',
      sectionViewModes: {
        codex: 'all',
        claude: 'paged',
      },
      accountDisplayModes: {
        codex: 'full',
        claude: 'full',
      },
    });
  });

  it('persists and reads page state via localStorage', () => {
    writeQuotaPageUiState({
      searchQuery: 'plus',
      sortMode: 'plan-desc',
      sectionViewModes: {
        codex: 'all',
        kimi: 'paged',
      },
      accountDisplayModes: {
        codex: 'full',
        kimi: 'masked',
      },
    });

    expect(JSON.parse(storage.getItem(QUOTA_PAGE_UI_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      searchQuery: 'plus',
      sortMode: 'plan-desc',
      sectionViewModes: {
        codex: 'all',
        kimi: 'paged',
      },
      accountDisplayModes: {
        codex: 'full',
        kimi: 'masked',
      },
    });
    expect(readQuotaPageUiState()).toEqual({
      searchQuery: 'plus',
      sortMode: 'plan-desc',
      sectionViewModes: {
        codex: 'all',
        kimi: 'paged',
      },
      accountDisplayModes: {
        codex: 'full',
        kimi: 'masked',
      },
    });
  });

  it('returns defaults when stored payload is invalid JSON', () => {
    storage.setItem(QUOTA_PAGE_UI_STATE_STORAGE_KEY, '{not json');
    expect(readQuotaPageUiState()).toEqual(getDefaultQuotaPageUiState());
  });
});
