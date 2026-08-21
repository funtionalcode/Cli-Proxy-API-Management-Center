import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { CoolingPolicySelect } from '@/components/providers/CoolingPolicySelect';

const authState = vi.hoisted(() => ({
  serverVersion: 'v7.2.93' as string | null,
  serverCommit: null as string | null,
}));

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

const mocks = vi.hoisted(() => ({
  getOpenAIProviders: vi.fn(),
  fetchModelsViaApiCall: vi.fn(),
  updateConfigValue: vi.fn(),
  showNotification: vi.fn(),
  updateOpenAIProvider: vi.fn(),
  createOpenAIProvider: vi.fn(),
}));

vi.mock('@/stores', () => ({
  useConfigStore: (selector: (state: unknown) => unknown) =>
    selector({
      config: { openaiCompatibility: [] },
      updateConfigValue: mocks.updateConfigValue,
    }),
  useNotificationStore: () => ({ showNotification: mocks.showNotification }),
}));

vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: ReactNode;
    footer?: ReactNode;
  }) => (open ? createElement('div', null, children, footer) : null),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', null, children) : null,
}));

vi.mock('@/services/api', () => ({
  apiCallApi: { request: vi.fn() },
  getApiCallErrorDetails: vi.fn(() => ''),
  modelsApi: { fetchModelsViaApiCall: mocks.fetchModelsViaApiCall },
  providersApi: {
    createOpenAIProvider: mocks.createOpenAIProvider,
    getOpenAIProviders: mocks.getOpenAIProviders,
    updateOpenAIProvider: mocks.updateOpenAIProvider,
  },
}));

import { OpenAIEditDrawer } from './OpenAIEditDrawer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const findModelsFetchButton = (root: ReactTestInstance) =>
  root
    .findAllByType('button')
    .find((button) =>
      button.findAllByType('span').some((span) => span.children.join('').includes('/models'))
    );

const findSaveButton = (root: ReactTestInstance) =>
  root
    .findAllByType('button')
    .filter((button) => String(button.props.className ?? '').includes('btn-primary'))
    .slice(-1)[0];

describe('OpenAIEditDrawer model discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.serverVersion = 'v7.2.93';
    mocks.fetchModelsViaApiCall.mockResolvedValue([]);
    mocks.updateOpenAIProvider.mockResolvedValue(undefined);
    mocks.createOpenAIProvider.mockResolvedValue(undefined);
  });

  it('uses the proxy from the first valid credential when an earlier row is empty', async () => {
    mocks.getOpenAIProviders.mockResolvedValueOnce([
      {
        name: 'openai-example',
        baseUrl: 'https://api.example.com/v1',
        apiKeyEntries: [
          { apiKey: '' },
          {
            apiKey: 'second-key',
            authIndex: 'auth-second',
            proxyUrl: 'socks5://proxy.example:1080',
          },
        ],
        models: [],
      },
    ]);

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <OpenAIEditDrawer open editIndex={0} disabled={false} onClose={vi.fn()} onSaved={vi.fn()} />
      );
    });

    const fetchButton = findModelsFetchButton(renderer!.root);
    expect(fetchButton).toBeDefined();

    await act(async () => {
      fetchButton!.props.onClick();
    });

    expect(mocks.fetchModelsViaApiCall).toHaveBeenCalledWith(
      'https://api.example.com/v1',
      'second-key',
      {},
      'auth-second',
      'socks5://proxy.example:1080'
    );

    act(() => renderer!.unmount());
  });

  it.each([
    [true, 'enabled', false],
    [true, 'inherit', null],
  ] as const)(
    'saves cooling %j -> %s as disable-cooling %j',
    async (initialOverride, nextPolicy, expectedOverride) => {
      const provider = {
        name: 'openai-example',
        baseUrl: 'https://api.example.com/v1',
        apiKeyEntries: [{ apiKey: 'openai-key' }],
        models: [],
        disableCooling: initialOverride,
      };
      mocks.getOpenAIProviders.mockResolvedValue([provider]);
      const onSaved = vi.fn();
      let renderer: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <OpenAIEditDrawer
            open
            editIndex={0}
            disabled={false}
            onClose={vi.fn()}
            onSaved={onSaved}
          />
        );
      });

      act(() => renderer!.root.findByType(CoolingPolicySelect).props.onChange(nextPolicy));
      const saveButton = findSaveButton(renderer!.root);
      expect(saveButton?.props.disabled).not.toBe(true);

      await act(async () => {
        await saveButton?.props.onClick();
      });

      expect(mocks.updateOpenAIProvider).toHaveBeenCalledWith(
        'openai-example',
        0,
        expect.objectContaining({ disableCooling: expectedOverride })
      );
      expect(onSaved).toHaveBeenCalledTimes(1);

      act(() => renderer!.unmount());
    }
  );
});
