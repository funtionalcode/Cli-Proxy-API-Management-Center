import { describe, expect, it } from 'vitest';
import type { ManagerConfig } from '@/services/api/usageService';
import {
  resolveManagerServiceBase,
  resolveManagerCPAConnection,
  resolveManagerBindingStatus,
  resolveManagerFormDirty,
  resolveManagerRequestAuthKey,
  resolveManagerSaveState,
  shouldShowManagerTab,
} from './ConfigPage';

const buildManagerConfig = (overrides: Partial<ManagerConfig> = {}): ManagerConfig => ({
  cpaConnection: {
    cpaBaseUrl: 'http://cpa.local:8317',
    managementKey: 'management-key',
  },
  collector: {
    enabled: true,
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
  ...overrides,
});

describe('shouldShowManagerTab', () => {
  it('shows Manager config for external CPA panels even before a Manager address is stored', () => {
    expect(
      shouldShowManagerTab({
        panelHostedByUsageService: false,
        usageServiceEnabled: false,
        usageServiceBase: '',
      })
    ).toBe(true);
  });
});

describe('resolveManagerServiceBase', () => {
  it('uses the editable external Manager address for CPA-hosted panels', () => {
    expect(
      resolveManagerServiceBase({
        panelHostedByUsageService: false,
        detectedPanelBase: 'http://cpa.local:8317',
        usageServiceEnabled: false,
        usageServiceBase: '',
        externalServiceBaseInput: ' http://manager.local:18317/ ',
      })
    ).toBe('http://manager.local:18317');
  });

  it('keeps using the same-origin panel base for Manager-hosted panels', () => {
    expect(
      resolveManagerServiceBase({
        panelHostedByUsageService: true,
        detectedPanelBase: 'http://manager.local:18317/',
        usageServiceEnabled: false,
        usageServiceBase: '',
        externalServiceBaseInput: 'http://ignored.local:18317',
      })
    ).toBe('http://manager.local:18317');
  });
});

describe('resolveManagerRequestAuthKey', () => {
  it('uses the login key for same-origin Manager Server panels', () => {
    expect(
      resolveManagerRequestAuthKey({
        panelHostedByUsageService: true,
        managementKey: ' cpa-or-admin-key ',
      })
    ).toBe('cpa-or-admin-key');
  });

  it('uses the login key for external Manager config requests', () => {
    expect(
      resolveManagerRequestAuthKey({
        panelHostedByUsageService: false,
        managementKey: ' cpa-management-key ',
      })
    ).toBe('cpa-management-key');
  });
});

describe('resolveManagerCPAConnection', () => {
  it('keeps the saved embedded CPA URL and key when no new key is submitted', () => {
    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: true,
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://saved-cpa.local:8317',
            managementKey: 'old-cpa-key',
          },
        }),
      })
    ).toEqual({
      cpaBaseUrl: 'http://saved-cpa.local:8317',
      managementKey: 'old-cpa-key',
    });
  });

  it('updates only the saved embedded CPA key when a new key is submitted', () => {
    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: true,
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://saved-cpa.local:8317',
            managementKey: 'old-cpa-key',
          },
        }),
        managementKeyInput: ' new-cpa-key ',
      })
    ).toEqual({
      cpaBaseUrl: 'http://saved-cpa.local:8317',
      managementKey: 'new-cpa-key',
    });
  });

  it('updates the embedded CPA URL when a new URL is submitted', () => {
    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: true,
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://saved-cpa.local:8317',
            managementKey: 'old-cpa-key',
          },
        }),
        cpaBaseUrlInput: ' http://next-cpa.local:9009 ',
      })
    ).toEqual({
      cpaBaseUrl: 'http://next-cpa.local:9009',
      managementKey: 'old-cpa-key',
    });
  });

  it('updates both embedded CPA URL and key when both are submitted', () => {
    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: true,
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://saved-cpa.local:8317',
            managementKey: 'old-cpa-key',
          },
        }),
        cpaBaseUrlInput: ' http://next-cpa.local:9009 ',
        managementKeyInput: ' next-cpa-key ',
      })
    ).toEqual({
      cpaBaseUrl: 'http://next-cpa.local:9009',
      managementKey: 'next-cpa-key',
    });
  });

  it('returns an empty connection when embedded Manager config is not loaded yet', () => {
    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: true,
        managerConfig: null,
      })
    ).toEqual({
      cpaBaseUrl: '',
      managementKey: '',
    });
  });

  it('allows external panel connections to be updated from the form', () => {
    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: false,
        managerConfig: buildManagerConfig(),
        cpaBaseUrlInput: ' http://next-cpa.local:9009 ',
        managementKeyInput: ' next-key ',
      })
    ).toEqual({
      cpaBaseUrl: 'http://next-cpa.local:9009',
      managementKey: 'next-key',
    });

    expect(
      resolveManagerCPAConnection({
        panelHostedByUsageService: false,
        managerConfig: null,
      })
    ).toEqual({
      cpaBaseUrl: '',
      managementKey: '',
    });
  });
});

describe('resolveManagerFormDirty', () => {
  const cleanForm = {
    cpaBaseUrlInput: 'http://cpa.local:8317',
    managementKeyInput: '',
    requestMonitoringEnabled: true,
    collectorMode: 'auto',
    pollIntervalMs: '500',
    batchSize: '100',
    queryLimit: '50000',
  };

  it('does not mark a freshly loaded Manager config as dirty when the key input is empty', () => {
    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig(),
        ...cleanForm,
      })
    ).toBe(false);
  });

  it('treats an empty CPA key input as keeping the saved key', () => {
    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://cpa.local:8317',
            managementKey: 'saved-key',
          },
        }),
        ...cleanForm,
        managementKeyInput: '   ',
      })
    ).toBe(false);
  });

  it('marks the form dirty only when a submitted CPA key differs from the saved key', () => {
    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://cpa.local:8317',
            managementKey: 'saved-key',
          },
        }),
        ...cleanForm,
        managementKeyInput: ' next-key ',
      })
    ).toBe(true);

    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://cpa.local:8317',
            managementKey: 'saved-key',
          },
        }),
        ...cleanForm,
        managementKeyInput: ' saved-key ',
      })
    ).toBe(false);
  });

  it('normalizes CPA base URLs and numeric inputs before comparing dirty state', () => {
    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig(),
        ...cleanForm,
        cpaBaseUrlInput: ' http://cpa.local:8317/ ',
        pollIntervalMs: '0500',
      })
    ).toBe(false);
  });

  it('marks changed monitoring fields and invalid numeric input as dirty', () => {
    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig(),
        ...cleanForm,
        requestMonitoringEnabled: false,
      })
    ).toBe(true);

    expect(
      resolveManagerFormDirty({
        managerConfig: buildManagerConfig(),
        ...cleanForm,
        pollIntervalMs: '',
      })
    ).toBe(true);
  });
});

describe('resolveManagerBindingStatus', () => {
  it('treats same-origin Manager Server panels as matched', () => {
    expect(
      resolveManagerBindingStatus({
        panelHostedByUsageService: true,
      })
    ).toBe('matched');
  });

  it('treats all CPA-hosted panels as unconfigured for Manager binding', () => {
    expect(
      resolveManagerBindingStatus({
        panelHostedByUsageService: false,
      })
    ).toBe('unconfigured');
  });
});

describe('resolveManagerSaveState', () => {
  it('allows saving dirty Manager config', () => {
    expect(
      resolveManagerSaveState({
        panelHostedByUsageService: true,
        managerDirty: true,
      })
    ).toEqual({
      adminKeyLoadPending: false,
      adminKeyOnlyPending: false,
      hasPendingSave: true,
      canSave: true,
    });
  });

  it('does not create pending saves for clean same-origin Manager Server config', () => {
    expect(
      resolveManagerSaveState({
        panelHostedByUsageService: true,
        managerDirty: false,
      })
    ).toEqual({
      adminKeyLoadPending: false,
      adminKeyOnlyPending: false,
      hasPendingSave: false,
      canSave: false,
    });
  });

  it('allows Manager config saves from CPA-hosted panels with an external service base', () => {
    expect(
      resolveManagerSaveState({
        panelHostedByUsageService: false,
        managerDirty: true,
      })
    ).toEqual({
      adminKeyLoadPending: false,
      adminKeyOnlyPending: false,
      hasPendingSave: true,
      canSave: true,
    });
  });

  it('does not allow Manager config saves while host mode is unknown', () => {
    expect(
      resolveManagerSaveState({
        panelHostedByUsageService: null,
        managerDirty: true,
      })
    ).toEqual({
      adminKeyLoadPending: false,
      adminKeyOnlyPending: false,
      hasPendingSave: false,
      canSave: false,
    });
  });
});
