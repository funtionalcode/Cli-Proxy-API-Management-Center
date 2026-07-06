import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ManagerConfig } from '@/services/api/usageService';
import { usageServiceApi } from '@/services/api/usageService';
import { useAuthStore, useUsageServiceStore } from '@/stores';
import {
  buildPanelManagerServiceCandidates,
  managerConfigMatchesPanel,
  resolvePanelFeatureAvailability,
  usePanelFeatureAvailability,
} from './usePanelFeatureAvailability';

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
    enabled: true,
    serviceBase: 'http://manager.local:18317',
  },
  ...overrides,
});

const createMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

describe('panel feature availability', () => {
  it('uses the current embedded Manager Server as the only Docker-mode candidate', () => {
    expect(
      buildPanelManagerServiceCandidates({
        panelHostedByUsageService: true,
        panelBase: 'http://manager.local:18317',
      })
    ).toEqual(['http://manager.local:18317']);
  });

  it('builds external Manager Server candidates for CPA-hosted panels', () => {
    expect(
      buildPanelManagerServiceCandidates({
        panelHostedByUsageService: false,
        panelBase: 'http://panel.local:5174',
        apiBase: 'http://cpa.local:8317',
        usageServiceEnabled: true,
        usageServiceBase: 'http://manager.local:18317',
      })
    ).toEqual([
      'http://manager.local:18317',
      'http://cpa.local:18317',
      'http://panel.local:18317',
      'http://cpa.local:8317',
      'http://panel.local:5174',
    ]);
  });

  it('tries the default same-host Manager Server port for external CPA panels', () => {
    expect(
      buildPanelManagerServiceCandidates({
        panelHostedByUsageService: false,
        panelBase: 'http://192.168.2.5:8317',
        apiBase: 'http://192.168.2.5:8317',
        usageServiceEnabled: false,
        usageServiceBase: '',
      })
    ).toEqual(['http://192.168.2.5:18317', 'http://192.168.2.5:8317']);
  });

  it('only accepts Manager config for same-origin Manager Server panels', () => {
    expect(
      managerConfigMatchesPanel({
        panelHostedByUsageService: true,
        apiBase: 'http://manager.local:18317',
        config: buildManagerConfig(),
      })
    ).toBe(true);

    expect(
      managerConfigMatchesPanel({
        panelHostedByUsageService: false,
        apiBase: 'http://other-cpa.local:8317',
        config: buildManagerConfig(),
      })
    ).toBe(false);

    expect(
      managerConfigMatchesPanel({
        panelHostedByUsageService: false,
        apiBase: 'http://cpa.local:8317',
        managerServiceBase: 'http://manager.local:18317',
        config: buildManagerConfig(),
      })
    ).toBe(true);

    expect(
      managerConfigMatchesPanel({
        panelHostedByUsageService: false,
        apiBase: 'http://cpa.local:8317',
        managerServiceBase: 'http://manager.local:18317',
        config: buildManagerConfig({
          externalUsageService: { enabled: false, serviceBase: '' },
        }),
      })
    ).toBe(false);
  });

  it('accepts loopback Manager bindings for same-host external CPA panels', () => {
    expect(
      managerConfigMatchesPanel({
        panelHostedByUsageService: false,
        apiBase: 'http://192.168.2.5:8317',
        managerServiceBase: 'http://192.168.2.5:18317',
        config: buildManagerConfig({
          cpaConnection: {
            cpaBaseUrl: 'http://127.0.0.1:8317',
            managementKey: 'management-key',
          },
          externalUsageService: {
            enabled: true,
            serviceBase: 'http://127.0.0.1:18317',
          },
        }),
      })
    ).toBe(true);
  });

  it('marks Manager-only features available while separately gating request monitoring', () => {
    const availability = resolvePanelFeatureAvailability({
      panelHostedByUsageService: true,
      panelBase: 'http://manager.local:18317',
      managerServiceBase: 'http://manager.local:18317',
      managerConfig: buildManagerConfig({
        collector: {
          ...buildManagerConfig().collector,
          enabled: false,
        },
      }),
      hasManagerCandidate: true,
      managementKey: 'management-key',
    });

    expect(availability.managerServiceAvailable).toBe(true);
    expect(availability.modelPricesAvailable).toBe(true);
    expect(availability.serverCodexInspectionAvailable).toBe(true);
    expect(availability.requestMonitoringAvailable).toBe(false);
    expect(availability.reason).toBe('monitoring_disabled');
  });

  it('marks features available for CPA-hosted panels with matching external Manager config', () => {
    const availability = resolvePanelFeatureAvailability({
      panelHostedByUsageService: false,
      panelBase: 'http://cpa.local:8317',
      managerServiceBase: 'http://manager.local:18317',
      managerConfig: buildManagerConfig(),
      hasManagerCandidate: true,
      managementKey: 'management-key',
    });

    expect(availability.managerServiceAvailable).toBe(true);
    expect(availability.modelPricesAvailable).toBe(true);
    expect(availability.serverCodexInspectionAvailable).toBe(true);
    expect(availability.requestMonitoringAvailable).toBe(true);
    expect(availability.externalManagerConfigAvailable).toBe(true);
    expect(availability.reason).toBe('');
  });

  it('shares one feature detection request across concurrent hook consumers', async () => {
    const getInfoSpy = vi.spyOn(usageServiceApi, 'getInfo').mockImplementation(async (base) => ({
      service: base === 'http://manager.local:18317' ? 'cpa-manager-plus' : 'cli-proxy-api',
    }));
    const getManagerConfigSpy = vi
      .spyOn(usageServiceApi, 'getManagerConfig')
      .mockResolvedValue({ config: buildManagerConfig(), source: 'db' });
    let renderer: ReactTestRenderer | null = null;
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        hostname: 'panel.local',
        host: 'panel.local:5174',
        port: '5174',
      },
    });
    vi.stubGlobal('navigator', { userAgent: 'vitest' });
    vi.stubGlobal('localStorage', createMemoryStorage());

    try {
      useAuthStore.setState({
        apiBase: 'http://cpa.local:8317',
        managementKey: 'management-key',
      });
      useUsageServiceStore.setState({
        enabled: true,
        serviceBase: 'http://manager.local:18317',
        panelBase: 'http://panel.local:5174',
        panelHostMode: 'external_panel',
        revision: 1,
      });

      function HookConsumer() {
        usePanelFeatureAvailability();
        return null;
      }

      await act(async () => {
        renderer = create(
          createElement('div', null, createElement(HookConsumer), createElement(HookConsumer))
        );
      });

      expect(getInfoSpy).toHaveBeenCalledTimes(1);
      expect(getInfoSpy).toHaveBeenNthCalledWith(1, 'http://manager.local:18317');
      expect(getManagerConfigSpy).toHaveBeenCalledTimes(1);
      expect(getManagerConfigSpy).toHaveBeenCalledWith(
        'http://manager.local:18317',
        'management-key'
      );
    } finally {
      act(() => {
        renderer?.unmount();
      });
      getInfoSpy.mockRestore();
      getManagerConfigSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
