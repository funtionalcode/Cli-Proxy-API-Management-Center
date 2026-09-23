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

const apiClientSetConfig = vi.fn();
const fetchConfigMock = vi.fn();
const clearConfigCacheMock = vi.fn();
const clearModelsCacheMock = vi.fn();
const usageServiceGetManagerConfigMock = vi.fn();

vi.mock('@/services/api/client', () => ({
  apiClient: {
    setConfig: apiClientSetConfig,
  },
}));

vi.mock('./useConfigStore', () => ({
  useConfigStore: {
    getState: () => ({
      fetchConfig: fetchConfigMock,
      clearCache: clearConfigCacheMock,
    }),
  },
}));

vi.mock('./useModelsStore', () => ({
  useModelsStore: {
    getState: () => ({
      clearCache: clearModelsCacheMock,
    }),
  },
}));

vi.mock('@/services/api/usageService', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/usageService')>(
    '@/services/api/usageService'
  );
  return {
    ...actual,
    usageServiceApi: {
      ...actual.usageServiceApi,
      getManagerConfig: usageServiceGetManagerConfigMock,
    },
  };
});

const createStubWindow = (host = 'cpa.local:8317') => {
  const listeners = new Map<string, Set<EventListener>>();

  return {
    location: { host },
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatchEvent: vi.fn((event: Event) => {
      const set = listeners.get(event.type);
      if (set) {
        set.forEach((listener) => listener(event));
      }
      return true;
    }),
  };
};

describe('useAuthStore logout', () => {
  let storage: StorageLike;

  beforeEach(() => {
    vi.resetModules();
    apiClientSetConfig.mockClear();
    fetchConfigMock.mockReset();
    clearConfigCacheMock.mockClear();
    clearModelsCacheMock.mockClear();
    usageServiceGetManagerConfigMock.mockReset();
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', createStubWindow('cpa.local:8317'));
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('clears usage service config and resets api client credentials', async () => {
    const { useAuthStore } = await import('./useAuthStore');
    const { useUsageServiceStore } = await import('./useUsageServiceStore');

    useUsageServiceStore.getState().setUsageServiceConfig(
      {
        enabled: true,
        serviceBase: 'http://manager.local:18317/',
      },
      {
        panelBase: 'http://panel.local:8317',
        panelHostMode: 'external_panel',
      }
    );
    useAuthStore.setState({
      isAuthenticated: true,
      apiBase: 'http://cpa.local:8317',
      managementKey: 'management-key',
      serverVersion: 'v7.2.93',
      serverCommit: '5bffd151',
      serverBuildDate: '2026-08-17',
      connectionStatus: 'connected',
    });
    storage.setItem('isLoggedIn', 'true');

    useAuthStore.getState().logout();

    expect(useUsageServiceStore.getState()).toMatchObject({
      enabled: false,
      serviceBase: '',
      panelBase: '',
      panelHostMode: '',
    });
    expect(apiClientSetConfig).toHaveBeenCalledWith({ apiBase: '', managementKey: '' });
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      serverVersion: null,
      serverCommit: null,
      serverBuildDate: null,
      connectionStatus: 'disconnected',
    });
    expect(storage.getItem('isLoggedIn')).toBeNull();
  });
});

describe('useAuthStore manager embedded login recovery', () => {
  let storage: StorageLike;

  beforeEach(() => {
    vi.resetModules();
    apiClientSetConfig.mockClear();
    fetchConfigMock.mockReset();
    clearConfigCacheMock.mockClear();
    clearModelsCacheMock.mockClear();
    usageServiceGetManagerConfigMock.mockReset();
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', createStubWindow('manager.local:18317'));
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('allows Manager Server admin login to recover when the saved CPA key can no longer fetch CPA config', async () => {
    fetchConfigMock.mockRejectedValue(new Error('invalid management key'));
    usageServiceGetManagerConfigMock.mockResolvedValue({
      config: {
        cpaConnection: {
          cpaBaseUrl: 'http://cpa.local:8317',
          managementKey: 'old-cpa-key',
        },
        collector: {
          enabled: false,
          collectorMode: 'auto',
          queue: 'usage',
          popSide: 'right',
          batchSize: 100,
          pollIntervalMs: 500,
          queryLimit: 50000,
        },
        externalUsageService: {
          enabled: false,
          serviceBase: '',
        },
      },
      source: 'db',
    });

    const { useAuthStore } = await import('./useAuthStore');
    const { useUsageServiceStore } = await import('./useUsageServiceStore');

    useAuthStore.setState({
      serverVersion: 'v9.9.9',
      serverCommit: 'stale-commit',
      serverBuildDate: '2025-01-01',
    });

    const result = await useAuthStore.getState().login({
      apiBase: 'http://manager.local:18317',
      managementKey: 'manager-admin-key',
      rememberPassword: true,
      sessionMode: 'manager_embedded',
      sessionPanelBase: 'http://manager.local:18317',
    });

    expect(result).toEqual({ recoveryMode: 'manager_config' });
    expect(usageServiceGetManagerConfigMock).toHaveBeenCalledWith(
      'http://manager.local:18317',
      'manager-admin-key'
    );
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      apiBase: 'http://manager.local:18317',
      managementKey: 'manager-admin-key',
      sessionMode: 'manager_embedded',
      serverVersion: null,
      serverCommit: null,
      serverBuildDate: null,
      connectionStatus: 'connected',
    });
    expect(useUsageServiceStore.getState()).toMatchObject({
      enabled: true,
      serviceBase: 'http://manager.local:18317',
      panelBase: 'http://manager.local:18317',
      panelHostMode: 'manager_embedded',
    });
    expect(storage.getItem('isLoggedIn')).toBe('true');
    expect(clearConfigCacheMock).toHaveBeenCalled();
  });

  it('does not recover regular CPA panel logins through Manager Server config', async () => {
    fetchConfigMock.mockRejectedValue(new Error('invalid management key'));

    const { useAuthStore } = await import('./useAuthStore');

    await expect(
      useAuthStore.getState().login({
        apiBase: 'http://cpa.local:8317',
        managementKey: 'bad-cpa-key',
        sessionMode: 'external_panel',
      })
    ).rejects.toThrow('invalid management key');

    expect(usageServiceGetManagerConfigMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      connectionStatus: 'error',
    });
  });
});

describe('useAuthStore v1 obfuscation persistence gate and v2 migration', () => {
  let storage: StorageLike;
  const TEST_HOST = 'cpa.local:8317';
  const TEST_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

  const createV1Blob = (host: string, ua: string, payload: unknown): string => {
    const encoder = new TextEncoder();
    const SECRET_SALT = 'cli-proxy-api-webui::secure-storage';
    const keyBytes = encoder.encode(`${SECRET_SALT}|${host}|${ua}`);
    const data = encoder.encode(JSON.stringify(payload));
    const encrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      encrypted[i] = data[i] ^ keyBytes[i % keyBytes.length];
    }
    let binary = '';
    for (let i = 0; i < encrypted.length; i++) {
      binary += String.fromCharCode(encrypted[i]);
    }
    return 'enc::v1::' + btoa(binary);
  };

  const createV1AuthState = (managementKey = 'correct-management-key') => ({
    state: {
      apiBase: 'http://cpa.local:8317',
      managementKey,
      rememberPassword: true,
      serverVersion: null,
      serverBuildDate: null,
      sessionMode: '',
      sessionPanelBase: '',
    },
    version: 0,
  });

  beforeEach(() => {
    vi.resetModules();
    apiClientSetConfig.mockClear();
    fetchConfigMock.mockReset();
    clearConfigCacheMock.mockClear();
    clearModelsCacheMock.mockClear();
    usageServiceGetManagerConfigMock.mockReset();
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', createStubWindow(TEST_HOST));
    vi.stubGlobal('navigator', {
      userAgent: TEST_UA,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('1. seamlessly restores and migrates valid v1 auth to v2 on successful server authentication', async () => {
    fetchConfigMock.mockResolvedValue({ models: [] });

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('correct-key-888'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');
    // Pre-populate standalone legacy keys to test cleanup
    storage.setItem('apiBase', 'http://cpa.local:8317');
    storage.setItem('apiUrl', 'http://cpa.local:8317');
    storage.setItem('managementKey', 'legacy-key-to-clean');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession();
    expect(result).not.toBe(false);

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      apiBase: 'http://cpa.local:8317',
      managementKey: 'correct-key-888',
      rememberPassword: true,
      connectionStatus: 'connected',
    });

    // Successfully migrated to enc::v2::
    const finalStoredAuth = storage.getItem('cli-proxy-auth');
    expect(finalStoredAuth).toBeTruthy();
    expect(finalStoredAuth!.startsWith('enc::v2::')).toBe(true);

    // Standalone legacy keys must be cleaned up
    expect(storage.getItem('apiBase')).toBeNull();
    expect(storage.getItem('apiUrl')).toBeNull();
    expect(storage.getItem('managementKey')).toBeNull();
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('2. preserves raw v1 auth byte-for-byte during transient network failures', async () => {
    fetchConfigMock.mockRejectedValue(new Error('NetworkError: Failed to fetch'));

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('correct-key-888'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession();
    expect(result).toBe(false);

    // Raw v1 ciphertext MUST remain completely untouched byte-for-byte
    const rawAfter = storage.getItem('cli-proxy-auth');
    expect(rawAfter).toBe(rawV1);
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('3. preserves raw v1 auth on 5xx server errors', async () => {
    const serverError = Object.assign(new Error('Server Error'), { status: 500 });
    fetchConfigMock.mockRejectedValue(serverError);

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('correct-key-888'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession();
    expect(result).toBe(false);

    expect(storage.getItem('cli-proxy-auth')).toBe(rawV1);
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('4. preserves raw v1 auth on 403 Forbidden without deleting or migrating it', async () => {
    const forbiddenError = Object.assign(new Error('Forbidden'), { status: 403 });
    fetchConfigMock.mockRejectedValue(forbiddenError);

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('correct-key-888'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession();
    expect(result).toBe(false);

    // 403 does not prove credential is invalid, must keep v1 untouched
    expect(storage.getItem('cli-proxy-auth')).toBe(rawV1);
  });

  it('5. clears remembered credentials and stops auto-login on definitive 401 Unauthorized', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), { status: 401 });
    fetchConfigMock.mockRejectedValue(unauthorizedError);

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('bad-stale-key'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');
    storage.setItem('managementKey', 'legacy-stale-key');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession();
    expect(result).toBe(false);

    // Must clear remembered credential and isLoggedIn
    expect(storage.getItem('isLoggedIn')).toBeNull();
    expect(storage.getItem('managementKey')).toBeNull();
    expect(useAuthStore.getState().managementKey).toBe('');
    expect(useAuthStore.getState().rememberPassword).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    // Future restoreSession must not attempt to auto-login the stale key
    fetchConfigMock.mockClear();
    vi.resetModules();
    const { useAuthStore: reloadedAuthStore } = await import('./useAuthStore');
    const secondResult = await reloadedAuthStore.getState().restoreSession();
    expect(secondResult).toBe(false);
    expect(fetchConfigMock).not.toHaveBeenCalled();
  });

  it('6. recovers from standalone legacy managementKey in v1 format and migrates to v2', async () => {
    fetchConfigMock.mockResolvedValue({ models: [] });

    // No cli-proxy-auth, only legacy standalone keys
    const rawLegacyKeyV1 = createV1Blob(TEST_HOST, TEST_UA, 'standalone-legacy-secret');
    storage.setItem('managementKey', rawLegacyKeyV1);
    storage.setItem('apiBase', 'http://cpa.local:8317');
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession();
    expect(result).not.toBe(false);

    expect(useAuthStore.getState().managementKey).toBe('standalone-legacy-secret');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Written to modern cli-proxy-auth with enc::v2::
    const finalStoredAuth = storage.getItem('cli-proxy-auth');
    expect(finalStoredAuth).toBeTruthy();
    expect(finalStoredAuth!.startsWith('enc::v2::')).toBe(true);

    // Standalone key removed
    expect(storage.getItem('managementKey')).toBeNull();
  });

  it('7. does not persist managementKey when rememberPassword is false', async () => {
    fetchConfigMock.mockResolvedValue({ models: [] });

    const { useAuthStore } = await import('./useAuthStore');
    const { obfuscatedStorage } = await import('@/services/storage/secureStorage');

    await useAuthStore.getState().login({
      apiBase: 'http://cpa.local:8317',
      managementKey: 'session-only-secret',
      rememberPassword: false,
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().managementKey).toBe('session-only-secret');
    expect(storage.getItem('isLoggedIn')).toBeNull();

    // Check raw persisted state in storage
    const persisted = obfuscatedStorage.getItem<{ state?: { managementKey?: string } }>(
      'cli-proxy-auth'
    );
    expect(persisted?.state?.managementKey).toBeUndefined();
  });

  it('8. logout cleans up standalone legacy credentials and prevents revival', async () => {
    storage.setItem('managementKey', 'standalone-secret');
    storage.setItem('apiBase', 'http://cpa.local:8317');
    storage.setItem('apiUrl', 'http://cpa.local:8317');
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    useAuthStore.getState().logout();

    expect(storage.getItem('managementKey')).toBeNull();
    expect(storage.getItem('apiBase')).toBeNull();
    expect(storage.getItem('apiUrl')).toBeNull();
    expect(storage.getItem('isLoggedIn')).toBeNull();

    // Subsequent restoreSession must not resurrect from legacy keys
    fetchConfigMock.mockClear();
    const restoreResult = await useAuthStore.getState().restoreSession();
    expect(restoreResult).toBe(false);
    expect(fetchConfigMock).not.toHaveBeenCalled();
  });

  it('9. preserves raw v1 auth byte-for-byte in Manager Embedded when first-stage CPA returns 401 and second-stage fallback suffers transient failure', async () => {
    // Stage 1: fetchConfig CPA 401, dispatches unauthorized event
    fetchConfigMock.mockImplementation(async () => {
      window.dispatchEvent(new Event('unauthorized'));
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });

    // Stage 2: Manager Server fallback fails with 500 / network error
    usageServiceGetManagerConfigMock.mockRejectedValue(
      Object.assign(new Error('Server Error'), { status: 500 })
    );

    const v1Payload = {
      state: {
        apiBase: 'http://manager.local:18317',
        managementKey: 'manager-admin-key',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: 'manager_embedded',
        sessionPanelBase: 'http://manager.local:18317',
      },
      version: 0,
    };

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, v1Payload);
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession({
      expectedMode: 'manager_embedded',
      expectedPanelBase: 'http://manager.local:18317',
    });

    expect(result).toBe(false);

    // Byte-for-byte identical: MUST NOT be erased by premature unauthorized logout, nor migrated to v2
    expect(storage.getItem('cli-proxy-auth')).toBe(rawV1);
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('10. migrates v1 auth to v2 in Manager Embedded when first-stage CPA returns 401 but manager fallback succeeds', async () => {
    // Stage 1: fetchConfig CPA 401, dispatches unauthorized event
    fetchConfigMock.mockImplementation(async () => {
      window.dispatchEvent(new Event('unauthorized'));
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });

    // Stage 2: Manager Server getManagerConfig succeeds with admin key
    usageServiceGetManagerConfigMock.mockResolvedValue({
      config: {
        cpaConnection: {
          cpaBaseUrl: 'http://cpa.local:8317',
          managementKey: 'stale-cpa-key',
        },
        collector: {
          enabled: false,
          collectorMode: 'auto',
          queue: 'usage',
          popSide: 'right',
          batchSize: 100,
          pollIntervalMs: 500,
          queryLimit: 50000,
        },
        externalUsageService: {
          enabled: false,
          serviceBase: '',
        },
      },
      source: 'db',
    });

    const v1Payload = {
      state: {
        apiBase: 'http://manager.local:18317',
        managementKey: 'manager-admin-key',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: 'manager_embedded',
        sessionPanelBase: 'http://manager.local:18317',
      },
      version: 0,
    };

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, v1Payload);
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');
    // Pre-populate standalone keys to verify cleanup
    storage.setItem('apiBase', 'http://manager.local:18317');
    storage.setItem('apiUrl', 'http://manager.local:18317');
    storage.setItem('managementKey', 'legacy-key-to-clean');

    const { useAuthStore } = await import('./useAuthStore');

    const result = await useAuthStore.getState().restoreSession({
      expectedMode: 'manager_embedded',
      expectedPanelBase: 'http://manager.local:18317',
    });

    expect(result).toEqual({ recoveryMode: 'manager_config' });

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      apiBase: 'http://manager.local:18317',
      managementKey: 'manager-admin-key',
      sessionMode: 'manager_embedded',
      connectionStatus: 'connected',
    });

    // Successfully migrated to enc::v2::
    const finalStoredAuth = storage.getItem('cli-proxy-auth');
    expect(finalStoredAuth).toBeTruthy();
    expect(finalStoredAuth!.startsWith('enc::v2::')).toBe(true);

    // Legacy standalone keys cleaned up
    expect(storage.getItem('apiBase')).toBeNull();
    expect(storage.getItem('apiUrl')).toBeNull();
    expect(storage.getItem('managementKey')).toBeNull();
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('11. ordinary authenticated v2 session logs out when unauthorized event is received', async () => {
    const { useAuthStore } = await import('./useAuthStore');

    useAuthStore.setState({
      isAuthenticated: true,
      apiBase: 'http://cpa.local:8317',
      managementKey: 'active-v2-key',
      connectionStatus: 'connected',
    });
    storage.setItem('isLoggedIn', 'true');

    // Dispatch global unauthorized event on regular authenticated session (deferAuthPersistence is false)
    window.dispatchEvent(new Event('unauthorized'));

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      connectionStatus: 'disconnected',
    });
    expect(storage.getItem('isLoggedIn')).toBeNull();
  });

  it('12. does not let a stale v1 401 overwrite a newer auth state written by another tab', async () => {
    let rejectFetch!: (error: unknown) => void;
    fetchConfigMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject;
        })
    );

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('stale-v1-key'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');
    const { obfuscateData } = await import('@/utils/encryption');

    // Tab A begins session restoration
    const restorePromise = useAuthStore.getState().restoreSession();

    // Verify fetchConfig is actually pending
    expect(fetchConfigMock).toHaveBeenCalled();

    // While Tab A request is in-flight, Tab B successfully authenticates and writes newer v2 state
    const newerV2Payload = {
      state: {
        apiBase: 'http://cpa.local:8317',
        managementKey: 'new-correct-key-from-tab-b',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: '',
        sessionPanelBase: '',
      },
      version: 0,
    };
    const newerRawV2 = obfuscateData(JSON.stringify(newerV2Payload));
    storage.setItem('cli-proxy-auth', newerRawV2);
    storage.setItem('isLoggedIn', 'true');

    // Tab A slow request finally rejects with 401
    rejectFetch(Object.assign(new Error('Unauthorized'), { status: 401 }));

    const result = await restorePromise;
    expect(result).toBe(false);

    // Stale 401 MUST NOT overwrite Tab B newer v2 ciphertext
    expect(storage.getItem('cli-proxy-auth')).toBe(newerRawV2);
    // Stale 401 MUST NOT delete Tab B active login state
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('13. does not let a stale v1 401 delete standalone legacy keys updated by another context during verification', async () => {
    let rejectFetch!: (error: unknown) => void;
    fetchConfigMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject;
        })
    );

    const rawLegacyKeyV1 = createV1Blob(TEST_HOST, TEST_UA, 'standalone-v1-key');
    storage.setItem('managementKey', rawLegacyKeyV1);
    storage.setItem('apiBase', 'http://cpa.local:8317');
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');

    // Tab A starts restoration with standalone key
    const restorePromise = useAuthStore.getState().restoreSession();
    expect(fetchConfigMock).toHaveBeenCalled();

    // Another context updates storage during the verification window
    storage.setItem('managementKey', 'updated-by-another-tab');

    // Tab A rejects with 401
    rejectFetch(Object.assign(new Error('Unauthorized'), { status: 401 }));

    const result = await restorePromise;
    expect(result).toBe(false);

    // Standalone key must remain untouched because storage changed during in-flight request
    expect(storage.getItem('managementKey')).toBe('updated-by-another-tab');
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('14. does not restore or overwrite when shared storage changes after hydration but before restoreSession', async () => {
    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('tab-a-old-v1-key'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    // Step 2: import store (Zustand hydrates v1-A, sets deferAuthPersistence=true, captures pendingLegacyAuthSnapshot)
    const { useAuthStore } = await import('./useAuthStore');

    // Step 3: Tab B successfully logs in before Tab A calls restoreSession
    const { obfuscateData } = await import('@/utils/encryption');
    const newerV2Payload = {
      state: {
        apiBase: 'http://cpa.local:8317',
        managementKey: 'new-key-from-tab-b',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: '',
        sessionPanelBase: '',
      },
      version: 0,
    };
    const newerRawV2 = obfuscateData(JSON.stringify(newerV2Payload));
    storage.setItem('cli-proxy-auth', newerRawV2);
    storage.setItem('isLoggedIn', 'true');

    // Step 4: Tab A finally calls restoreSession()
    const result = await useAuthStore.getState().restoreSession();

    expect(result).toBe(false);
    expect(storage.getItem('cli-proxy-auth')).toBe(newerRawV2);
    expect(storage.getItem('isLoggedIn')).toBe('true');
    expect(fetchConfigMock).not.toHaveBeenCalled();
  });

  it('15. does not commit stale successful auto-restore when shared storage changed in-flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchConfigMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('tab-a-old-key'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');
    const { obfuscateData } = await import('@/utils/encryption');

    // Tab A begins session restoration
    const restorePromise = useAuthStore.getState().restoreSession();
    expect(fetchConfigMock).toHaveBeenCalled();

    // While Tab A request is in-flight, Tab B updates shared storage with newer v2
    const newerV2Payload = {
      state: {
        apiBase: 'http://cpa.local:8317',
        managementKey: 'new-key-from-tab-b',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: '',
        sessionPanelBase: '',
      },
      version: 0,
    };
    const newerRawV2 = obfuscateData(JSON.stringify(newerV2Payload));
    storage.setItem('cli-proxy-auth', newerRawV2);
    storage.setItem('isLoggedIn', 'true');

    // Tab A in-flight request succeeds
    resolveFetch({ models: [] });

    const result = await restorePromise;
    expect(result).toBe(false);

    // Tab B's newer v2 must be preserved byte-for-byte
    expect(storage.getItem('cli-proxy-auth')).toBe(newerRawV2);
    expect(storage.getItem('isLoggedIn')).toBe('true');
  });

  it('16. does not commit stale Manager Embedded auto-restore when shared storage changed during fallback', async () => {
    // Stage 1: fetchConfig CPA 401, dispatches unauthorized event
    fetchConfigMock.mockImplementation(async () => {
      window.dispatchEvent(new Event('unauthorized'));
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });

    let resolveManagerConfig!: (value: unknown) => void;
    usageServiceGetManagerConfigMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveManagerConfig = resolve;
        })
    );

    const v1Payload = {
      state: {
        apiBase: 'http://manager.local:18317',
        managementKey: 'manager-admin-key',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: 'manager_embedded',
        sessionPanelBase: 'http://manager.local:18317',
      },
      version: 0,
    };

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, v1Payload);
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');
    const { obfuscateData } = await import('@/utils/encryption');

    const restorePromise = useAuthStore.getState().restoreSession({
      expectedMode: 'manager_embedded',
      expectedPanelBase: 'http://manager.local:18317',
    });

    // Wait for CPA 401 to trigger getManagerConfig
    await Promise.resolve();
    await Promise.resolve();
    expect(usageServiceGetManagerConfigMock).toHaveBeenCalled();

    // While fallback is in-flight, another tab logs in and writes newer v2
    const { obfuscatedStorage } = await import('@/services/storage/secureStorage');
    const newerV2Payload = {
      state: {
        apiBase: 'http://manager.local:18317',
        managementKey: 'new-key-from-tab-b',
        rememberPassword: true,
        serverVersion: null,
        serverBuildDate: null,
        sessionMode: 'manager_embedded',
        sessionPanelBase: 'http://manager.local:18317',
      },
      version: 0,
    };
    const newerRawV2 = obfuscateData(JSON.stringify(newerV2Payload));
    storage.setItem('cli-proxy-auth', newerRawV2);
    storage.setItem('isLoggedIn', 'true');

    const newerUsageServiceState = {
      state: {
        enabled: true,
        serviceBase: 'http://new-manager.local:18317',
        panelBase: 'http://new-manager.local:18317',
        panelHostMode: 'manager_embedded',
      },
      version: 0,
    };
    obfuscatedStorage.setItem('cli-proxy-usage-service', newerUsageServiceState);
    const newerUsageServiceRaw = storage.getItem('cli-proxy-usage-service');

    // Fallback succeeds
    resolveManagerConfig({
      config: {
        cpaConnection: {
          cpaBaseUrl: 'http://cpa.local:8317',
          hasManagementKey: true,
        },
      },
    });

    const result = await restorePromise;
    expect(result).toBe(false);

    // Stale success MUST NOT overwrite Tab B newer v2 nor its usage-service config
    expect(storage.getItem('cli-proxy-auth')).toBe(newerRawV2);
    expect(storage.getItem('isLoggedIn')).toBe('true');
    expect(storage.getItem('cli-proxy-usage-service')).toBe(newerUsageServiceRaw);
  });

  it('17. allows manual login to commit and overwrite even if stale legacy snapshot existed', async () => {
    fetchConfigMock.mockResolvedValue({ models: [] });

    const rawV1 = createV1Blob(TEST_HOST, TEST_UA, createV1AuthState('tab-a-old-v1-key'));
    storage.setItem('cli-proxy-auth', rawV1);
    storage.setItem('isLoggedIn', 'true');

    const { useAuthStore } = await import('./useAuthStore');
    const { obfuscateData, deobfuscateData } = await import('@/utils/encryption');

    // Tab B updates shared storage before Tab A calls restoreSession
    const newerRawV2 = obfuscateData(
      JSON.stringify({
        state: {
          apiBase: 'http://cpa.local:8317',
          managementKey: 'tab-b-key',
          rememberPassword: true,
        },
        version: 0,
      })
    );
    storage.setItem('cli-proxy-auth', newerRawV2);

    // Tab A restoreSession detects mismatch and aborts (stale, gate=true)
    const restoreResult = await useAuthStore.getState().restoreSession();
    expect(restoreResult).toBe(false);

    // User explicitly types new credentials and triggers manual login
    fetchConfigMock.mockClear();
    fetchConfigMock.mockResolvedValue({ models: [] });

    await useAuthStore.getState().login({
      apiBase: 'http://cpa.local:8317',
      managementKey: 'explicit-manual-key',
      rememberPassword: true,
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().managementKey).toBe('explicit-manual-key');
    expect(storage.getItem('isLoggedIn')).toBe('true');

    // The manual login successfully committed new v2
    const storedAuth = storage.getItem('cli-proxy-auth');
    expect(storedAuth).toBeTruthy();
    expect(storedAuth!.startsWith('enc::v2::')).toBe(true);
    const parsed = JSON.parse(deobfuscateData(storedAuth!));
    expect(parsed.state.managementKey).toBe('explicit-manual-key');
  });
});

