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
