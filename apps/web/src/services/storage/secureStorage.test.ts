import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('secureStorage / obfuscatedStorage', () => {
  let storage: StorageLike;

  beforeEach(() => {
    vi.resetModules();
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', {
      location: {
        host: 'localhost:8317',
      },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes new items using enc::v2:: prefix and reads them back correctly', async () => {
    const { obfuscatedStorage } = await import('./secureStorage');

    obfuscatedStorage.setItem('test-key', { user: 'admin', quota: 100 });
    const raw = storage.getItem('test-key');

    expect(raw).toBeTruthy();
    expect(raw!.startsWith('enc::v2::')).toBe(true);

    const retrieved = obfuscatedStorage.getItem<{ user: string; quota: number }>('test-key');
    expect(retrieved).toEqual({ user: 'admin', quota: 100 });
  });

  it('reads historical enc::v1:: items without corrupting them', async () => {
    // Manually place a v1 ciphertext
    // Key derived with salt + host + ua
    // Placed directly in raw storage
    const v1Raw =
      'enc::v1::GE4IXRkwDgscD1tSAVkDFVhaRllKEksPGhEEQUlMXENWRUleDhEPTwsKDgQCTnNWSBVGbxsfGhhBAEtYR14NQygYTlFWTEIfB1VHZA0GAAhFIxUKQSNxXQ==';
    storage.setItem('legacy-key', v1Raw);

    // With matching UA and host (configured in beforeEach):
    // Host in fixture was cpa.local:8317
    vi.stubGlobal('window', {
      location: { host: 'cpa.local:8317' },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
    });
    vi.resetModules();
    const { obfuscatedStorage: reloadedStorage } = await import('./secureStorage');

    const result = reloadedStorage.getItem<{ apiBase: string; managementKey: string }>('legacy-key');
    expect(result).toEqual({
      apiBase: 'http://cpa.local:8317',
      managementKey: 'test-admin-key-888-long-credential',
    });
  });

  describe('migratePlaintextKeys', () => {
    it('does not double-obfuscate enc::v2:: values', async () => {
      const { obfuscatedStorage } = await import('./secureStorage');

      obfuscatedStorage.setItem('apiBase', 'http://cpa.local:8317');
      const rawBefore = storage.getItem('apiBase');
      expect(rawBefore!.startsWith('enc::v2::')).toBe(true);

      obfuscatedStorage.migratePlaintextKeys(['apiBase']);
      const rawAfter = storage.getItem('apiBase');

      // Byte-for-byte identical, never double-obfuscated
      expect(rawAfter).toBe(rawBefore);
    });

    it('does not rewrite existing enc::v1:: values during plaintext migration', async () => {
      const { obfuscatedStorage } = await import('./secureStorage');

      const v1Value = 'enc::v1::some-existing-v1-ciphertext';
      storage.setItem('managementKey', v1Value);

      obfuscatedStorage.migratePlaintextKeys(['managementKey']);
      const rawAfter = storage.getItem('managementKey');

      expect(rawAfter).toBe(v1Value);
    });

    it('migrates unencrypted plaintext keys to enc::v2::', async () => {
      const { obfuscatedStorage } = await import('./secureStorage');

      storage.setItem('plainKey', JSON.stringify({ token: 'abc' }));
      obfuscatedStorage.migratePlaintextKeys(['plainKey']);

      const raw = storage.getItem('plainKey');
      expect(raw!.startsWith('enc::v2::')).toBe(true);

      const parsed = obfuscatedStorage.getItem<{ token: string }>('plainKey');
      expect(parsed).toEqual({ token: 'abc' });
    });
  });

  it('exposes secureStorage alias pointing to obfuscatedStorage', async () => {
    const { secureStorage, obfuscatedStorage } = await import('./secureStorage');
    expect(secureStorage).toBe(obfuscatedStorage);
  });
});
