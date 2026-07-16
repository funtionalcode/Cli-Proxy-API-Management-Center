import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ManagerConfig } from '@/services/api/usageService';
import { usageServiceApi } from '@/services/api/usageService';
import { useAuthStore } from '@/stores';
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

  it('does not build Manager Server candidates for CPA-hosted panels', () => {
    expect(
      buildPanelManagerServiceCandidates({
        panelHostedByUsageService: false,
        panelBase: 'http://cpa.local:8317',
      })
    ).toEqual([]);
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
        config: buildManagerConfig({
          externalUsageService: { enabled: false, serviceBase: '' },
        }),
      })
    ).toBe(false);
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

  it('keeps Manager-only features unavailable for CPA-hosted panels even with stale Manager config', () => {
    const availability = resolvePanelFeatureAvailability({
      panelHostedByUsageService: false,
      panelBase: 'http://cpa.local:8317',
      managerServiceBase: 'http://manager.local:18317',
      managerConfig: buildManagerConfig(),
      hasManagerCandidate: true,
      managementKey: 'management-key',
    });

    expect(availability.managerServiceAvailable).toBe(false);
    expect(availability.modelPricesAvailable).toBe(false);
    expect(availability.serverCodexInspectionAvailable).toBe(false);
    expect(availability.requestMonitoringAvailable).toBe(false);
    expect(availability.externalManagerConfigAvailable).toBe(false);
    expect(availability.reason).toBe('service_not_configured');
  });

  it('shares one feature detection request across concurrent hook consumers', async () => {
    const getInfoSpy = vi
      .spyOn(usageServiceApi, 'getInfo')
      .mockImplementation(async (base) => ({
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

      function HookConsumer() {
        usePanelFeatureAvailability();
        return null;
      }

      await act(async () => {
        renderer = create(
          createElement(
            'div',
            null,
            createElement(HookConsumer),
            createElement(HookConsumer)
          )
        );
      });

      expect(getInfoSpy).toHaveBeenCalledTimes(1);
      expect(getInfoSpy).toHaveBeenNthCalledWith(1, 'http://panel.local:5174');
      expect(getManagerConfigSpy).not.toHaveBeenCalled();
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
