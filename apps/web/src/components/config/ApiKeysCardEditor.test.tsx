import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { ApiKeysCardEditor } from './ApiKeysCardEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getApiKeyAliases: vi.fn(),
  showNotification: vi.fn(),
  showConfirmation: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/usePanelFeatureAvailability', () => ({
  usePanelFeatureAvailability: () => ({
    checking: false,
    panelHostMode: 'external_panel',
    panelBase: 'http://cpa.local:8317',
    managerServiceBase: 'http://manager.local:18317',
    managerServiceAvailable: true,
    requestMonitoringAvailable: true,
    modelPricesAvailable: true,
    serverCodexInspectionAvailable: true,
    dockerSetupAvailable: false,
    externalManagerConfigAvailable: true,
    reason: '',
  }),
}));

vi.mock('@/services/api/usageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/usageService')>();
  return {
    ...actual,
    usageServiceApi: {
      ...actual.usageServiceApi,
      getApiKeyAliases: mocks.getApiKeyAliases,
    },
  };
});

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: { managementKey: string }) => unknown) =>
    selector({ managementKey: 'cpa-management-key' }),
  useNotificationStore: (
    selector: (state: {
      showNotification: typeof mocks.showNotification;
      showConfirmation: typeof mocks.showConfirmation;
    }) => unknown
  ) =>
    selector({
      showNotification: mocks.showNotification,
      showConfirmation: mocks.showConfirmation,
    }),
}));

const readText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(readText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return readText((value as { children?: unknown }).children);
  }
  return '';
};

describe('ApiKeysCardEditor aliases', () => {
  beforeEach(() => {
    mocks.getApiKeyAliases.mockReset();
    mocks.getApiKeyAliases.mockResolvedValue({ items: [] });
  });

  it('enables alias actions when a CPA-hosted panel resolves its external Manager Server', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiKeysCardEditor value="sk-test-key" onChange={vi.fn()} />
      );
      await Promise.resolve();
    });

    const aliasButton = renderer.root
      .findAllByType(Button)
      .find((button) =>
        readText(button.props.children).includes('config_management.visual.api_keys.alias_action')
      );

    expect(mocks.getApiKeyAliases).toHaveBeenCalledWith(
      'http://manager.local:18317',
      'cpa-management-key'
    );
    expect(aliasButton?.props.disabled).toBe(false);

    act(() => renderer.unmount());
  });
});
