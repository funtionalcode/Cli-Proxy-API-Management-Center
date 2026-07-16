import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { normalizeUsageServiceBase } from '@/services/api/usageService';
import type { PanelHostMode } from '@/hooks/usePanelFeatureAvailability';

export interface UsageServiceStoreContext {
  panelBase?: string;
  panelHostMode?: PanelHostMode;
}

export interface UsageServiceStoreState {
  enabled: boolean;
  serviceBase: string;
  panelBase: string;
  panelHostMode: PanelHostMode | '';
  revision: number;
  setUsageServiceConfig: (
    config: { enabled: boolean; serviceBase: string },
    context?: UsageServiceStoreContext
  ) => void;
  clearUsageServiceConfig: () => void;
}

export const useUsageServiceStore = create<UsageServiceStoreState>()(
  persist(
    (set) => ({
      enabled: false,
      serviceBase: '',
      panelBase: '',
      panelHostMode: '',
      revision: 0,
      setUsageServiceConfig: ({ enabled, serviceBase }, context) => {
        set((state) => ({
          enabled,
          serviceBase: enabled ? normalizeUsageServiceBase(serviceBase) : '',
          panelBase: context?.panelBase
            ? normalizeUsageServiceBase(context.panelBase)
            : state.panelBase,
          panelHostMode: context?.panelHostMode ?? state.panelHostMode,
          revision: state.revision + 1,
        }));
      },
      clearUsageServiceConfig: () =>
        set((state) => ({
          enabled: false,
          serviceBase: '',
          panelBase: '',
          panelHostMode: '',
          revision: state.revision + 1,
        })),
    }),
    {
      name: 'cli-proxy-usage-service',
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = obfuscatedStorage.getItem<UsageServiceStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          obfuscatedStorage.setItem(name, JSON.parse(value));
        },
        removeItem: (name) => {
          obfuscatedStorage.removeItem(name);
        },
      })),
      partialize: (state) => ({
        enabled: state.enabled,
        serviceBase: state.serviceBase,
        panelBase: state.panelBase,
        panelHostMode: state.panelHostMode,
      }),
    }
  )
);
