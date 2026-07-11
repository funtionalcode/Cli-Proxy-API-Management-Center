import { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Select } from '@/components/ui/Select';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import { ProxyConfigsPage } from './ProxyConfigsPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    fetchConfig: vi.fn(async () => ({})),
    updateConfigValue: vi.fn(),
    showNotification: vi.fn(),
    getGeminiKeys: vi.fn(async () => []),
    getCodexConfigs: vi.fn(async () => []),
    getClaudeConfigs: vi.fn(async () => []),
    getVertexConfigs: vi.fn(async () => []),
    getOpenAIProviders: vi.fn(async () => []),
    listAuthFiles: vi.fn(async () => ({
      files: [
        { name: 'enabled.json', type: 'codex' },
        { name: 'disabled.json', type: 'codex', disabled: true },
      ],
    })),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/useHeaderRefresh', () => ({
  useHeaderRefresh: () => {},
}));

vi.mock('@/services/api', () => ({
  authFilesApi: {
    list: mocks.listAuthFiles,
    patchFields: vi.fn(),
    patchFieldsForAuthIndexes: vi.fn(),
  },
  configApi: {
    clearProxyUrl: vi.fn(),
    updateProxyUrl: vi.fn(),
  },
  providersApi: {
    getGeminiKeys: mocks.getGeminiKeys,
    getCodexConfigs: mocks.getCodexConfigs,
    getClaudeConfigs: mocks.getClaudeConfigs,
    getVertexConfigs: mocks.getVertexConfigs,
    getOpenAIProviders: mocks.getOpenAIProviders,
    saveGeminiKeys: vi.fn(),
    saveCodexConfigs: vi.fn(),
    saveClaudeConfigs: vi.fn(),
    saveVertexConfigs: vi.fn(),
    saveOpenAIProviders: vi.fn(),
  },
}));

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: { connectionStatus: 'connected' }) => unknown) =>
    selector({ connectionStatus: 'connected' }),
  useConfigStore: (
    selector: (state: {
      config: Record<string, never>;
      fetchConfig: typeof mocks.fetchConfig;
      updateConfigValue: typeof mocks.updateConfigValue;
    }) => unknown
  ) =>
    selector({
      config: {},
      fetchConfig: mocks.fetchConfig,
      updateConfigValue: mocks.updateConfigValue,
    }),
  useNotificationStore: (
    selector: (state: { showNotification: typeof mocks.showNotification }) => unknown
  ) => selector({ showNotification: mocks.showNotification }),
}));

const getText = (node: ReactTestInstance): string =>
  node.children
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return getText(child);
    })
    .join('');

const findEnabledStateSelect = (renderer: ReactTestRenderer) => {
  const select = renderer.root
    .findAllByType(Select)
    .find((node) => node.props.id === 'proxy-config-enabled-state');
  if (!select) throw new Error('Enabled-state filter not found');
  return select;
};

const renderPage = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ProxyConfigsPage />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
};

describe('ProxyConfigsPage enabled-state filter', () => {
  beforeEach(() => {
    mocks.fetchConfig.mockClear();
    mocks.updateConfigValue.mockClear();
    mocks.showNotification.mockClear();
    mocks.getGeminiKeys.mockClear();
    mocks.getCodexConfigs.mockClear();
    mocks.getClaudeConfigs.mockClear();
    mocks.getVertexConfigs.mockClear();
    mocks.getOpenAIProviders.mockClear();
    mocks.listAuthFiles.mockClear();
  });

  it('defaults to enabled rows and can show disabled or all rows', async () => {
    const renderer = await renderPage();

    const enabledStateSelect = findEnabledStateSelect(renderer);
    expect(enabledStateSelect.props.value).toBe('enabled');
    expect(enabledStateSelect.props.options).toEqual([
      { value: 'enabled', label: 'proxy_configs.enabled_filter_enabled' },
      { value: 'disabled', label: 'proxy_configs.enabled_filter_disabled' },
      { value: 'all', label: 'proxy_configs.enabled_filter_all' },
    ]);
    expect(getText(renderer.root)).toContain('enabled.json');
    expect(getText(renderer.root)).not.toContain('disabled.json');

    act(() => {
      enabledStateSelect.props.onChange('disabled');
    });
    expect(getText(renderer.root)).not.toContain('enabled.json');
    expect(getText(renderer.root)).toContain('disabled.json');

    act(() => {
      findEnabledStateSelect(renderer).props.onChange('all');
    });
    expect(getText(renderer.root)).toContain('enabled.json');
    expect(getText(renderer.root)).toContain('disabled.json');
  });

  it('provides labels for the enabled-state filter in every supported locale', () => {
    for (const locale of [en, zhCN, zhTW, ru]) {
      expect(locale.proxy_configs.enabled_filter_label).toBeTruthy();
      expect(locale.proxy_configs.enabled_filter_enabled).toBeTruthy();
      expect(locale.proxy_configs.enabled_filter_disabled).toBeTruthy();
      expect(locale.proxy_configs.enabled_filter_all).toBeTruthy();
    }
  });
});
