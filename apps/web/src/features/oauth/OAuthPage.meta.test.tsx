import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { OAuthPage } from './OAuthPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mocks } = vi.hoisted(() => ({
  mocks: {
    apiBase: 'http://cpa-a.local:8317',
    managementKey: 'key-a',
    startAuth: vi.fn(),
    getAuthStatus: vi.fn(),
    submitCallback: vi.fn(),
    cancelSession: vi.fn(),
    authFilesList: vi.fn(async () => ({ files: [] })),
    pluginList: vi.fn(async () => ({ plugins: [] })),
    vertexImport: vi.fn(),
    showNotification: vi.fn(),
    navigate: vi.fn(),
    recordMutationMarker: vi.fn(),
    publishMutationRevision: vi.fn(),
    copyToClipboard: vi.fn(async (_text?: string) => true),
    intervalCallbacks: [] as Array<() => void | Promise<void>>,
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ hash: '', search: '' }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/stores', () => {
  const readAuthState = () => ({
    apiBase: mocks.apiBase,
    managementKey: mocks.managementKey,
    connectionStatus: 'connected' as const,
    supportsPlugin: false,
  });
  return {
    publishAccountCredentialMutationRevision: mocks.publishMutationRevision,
    useAuthStore: Object.assign(
      (selector: (state: Record<string, unknown>) => unknown) => selector(readAuthState()),
      { getState: readAuthState }
    ),
    useNotificationStore: (
      selector?: (state: { showNotification: typeof mocks.showNotification }) => unknown
    ) => {
      const state = { showNotification: mocks.showNotification };
      return selector ? selector(state) : state;
    },
    useThemeStore: (selector: (state: { resolvedTheme: 'light' }) => unknown) =>
      selector({ resolvedTheme: 'light' }),
  };
});

vi.mock('@/services/api', () => ({
  oauthApi: {
    startAuth: mocks.startAuth,
    getAuthStatus: mocks.getAuthStatus,
    submitCallback: mocks.submitCallback,
    cancelSession: mocks.cancelSession,
  },
  authFilesApi: {
    list: mocks.authFilesList,
  },
  pluginsApi: {
    list: mocks.pluginList,
  },
}));

vi.mock('@/services/api/vertex', () => ({
  vertexApi: {
    importCredential: mocks.vertexImport,
  },
}));

vi.mock('@/features/monitoring/codexInspection', () => ({
  createCodexInspectionConnectionFingerprint: (apiBase: string, managementKey: string) =>
    apiBase && managementKey ? `${apiBase}:${managementKey}` : null,
}));

vi.mock('@/features/accounts/model/accountCredentialMutationMarker', () => ({
  createAccountCredentialMutationBaseline: (_files: unknown[], provider: string) => ({
    provider,
    credentials: [],
  }),
  recordAccountCredentialMutationMarker: mocks.recordMutationMarker,
}));

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: (text: string) => mocks.copyToClipboard(text),
}));

vi.mock('@/features/plugins/pluginResources', () => ({
  getPluginTitle: (plugin: { id: string }) => plugin.id,
  resolvePluginAssetURL: () => '',
}));

const textContent = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('');

const getMetaCard = (renderer: ReactTestRenderer): ReactTestInstance => {
  const card = renderer.root.find((node) => node.props?.id === 'oauth-provider-meta');
  if (!card) throw new Error('Meta provider card not found');
  return card;
};

const queryMetaButton = (renderer: ReactTestRenderer, text: string): ReactTestInstance | undefined => {
  const card = getMetaCard(renderer);
  return card
    .findAllByType(Button)
    .find((candidate) => textContent(candidate) === text);
};

const findMetaLoginButton = (renderer: ReactTestRenderer): ReactTestInstance => {
  const button =
    queryMetaButton(renderer, 'auth_login.meta_oauth_button') ||
    queryMetaButton(renderer, 'auth_login.login_another_account');
  if (!button) throw new Error('Meta login button not found');
  return button;
};

const mountedRenderers = new Set<ReactTestRenderer>();

const renderOAuthPage = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<OAuthPage />);
    await Promise.resolve();
  });
  mountedRenderers.add(renderer);
  return renderer;
};

const tickInterval = async (index = 0) => {
  const callback = mocks.intervalCallbacks[index];
  if (!callback) throw new Error(`Interval callback not found at index ${index}`);
  await act(async () => {
    await callback();
    await Promise.resolve();
  });
};

describe('OAuthPage Meta/Muse Device Flow lifecycle', () => {
  beforeEach(() => {
    mocks.apiBase = 'http://cpa-a.local:8317';
    mocks.managementKey = 'key-a';
    mocks.intervalCallbacks = [];
    mocks.startAuth.mockReset();
    mocks.getAuthStatus.mockReset();
    mocks.submitCallback.mockReset();
    mocks.cancelSession.mockReset();
    mocks.authFilesList.mockReset();
    mocks.authFilesList.mockResolvedValue({ files: [] });
    mocks.showNotification.mockReset();
    mocks.navigate.mockReset();
    mocks.recordMutationMarker.mockReset();
    mocks.publishMutationRevision.mockReset();
    mocks.copyToClipboard.mockReset();
    mocks.copyToClipboard.mockResolvedValue(true);

    vi.stubGlobal('window', {
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setInterval: vi.fn((callback: () => void | Promise<void>) => {
        mocks.intervalCallbacks.push(callback);
        return mocks.intervalCallbacks.length;
      }),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 100),
      clearTimeout: vi.fn(),
      open: vi.fn(),
    });
  });

  afterEach(async () => {
    for (const renderer of mountedRenderers) {
      await act(async () => {
        renderer.unmount();
      });
    }
    mountedRenderers.clear();
    vi.unstubAllGlobals();
  });

  it('renders Meta/Muse provider card with login button', async () => {
    const renderer = await renderOAuthPage();
    const card = getMetaCard(renderer);
    expect(card).toBeDefined();
    const loginButton = findMetaLoginButton(renderer);
    expect(loginButton).toBeDefined();
    expect(textContent(loginButton)).toBe('auth_login.meta_oauth_button');
  });

  it('displays user_code and copy button when startAuth returns device flow payload', async () => {
    mocks.startAuth.mockResolvedValueOnce({
      url: 'https://auth.meta.com/device',
      state: 'state-meta-1',
      user_code: 'ABCD-EFGH',
      flow: 'device',
      expires_in: 600,
    });
    mocks.getAuthStatus.mockResolvedValue({ status: 'wait' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    const card = getMetaCard(renderer);
    expect(textContent(card)).toContain('ABCD-EFGH');
    expect(textContent(card)).toContain('auth_login.device_code_label');
    const copyButton = queryMetaButton(renderer, 'auth_login.device_code_copy');
    expect(copyButton).toBeDefined();
  });

  it('copies user_code when copy button is clicked', async () => {
    mocks.startAuth.mockResolvedValueOnce({
      url: 'https://auth.meta.com/device',
      state: 'state-meta-1',
      user_code: 'ABCD-EFGH',
    });
    mocks.getAuthStatus.mockResolvedValue({ status: 'wait' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    const copyButton = queryMetaButton(renderer, 'auth_login.device_code_copy');
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton!.props.onClick();
      await Promise.resolve();
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('ABCD-EFGH');
    expect(mocks.showNotification).toHaveBeenCalledWith('auth_login.device_code_copied', 'success');
  });

  it('does NOT render Devin callback URL input for Meta', async () => {
    mocks.startAuth.mockResolvedValueOnce({
      url: 'https://auth.meta.com/device',
      state: 'state-meta-1',
      user_code: 'ABCD-EFGH',
    });
    mocks.getAuthStatus.mockResolvedValue({ status: 'wait' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    const card = getMetaCard(renderer);
    const callbackInputs = card.findAllByType('input');
    expect(callbackInputs).toHaveLength(0);
    expect(queryMetaButton(renderer, 'auth_login.oauth_callback_button')).toBeUndefined();
    expect(queryMetaButton(renderer, 'auth_login.devin_oauth_cancel')).toBeUndefined();
  });

  it('clears user_code upon successful polling and records credential mutation marker', async () => {
    mocks.startAuth.mockResolvedValueOnce({
      url: 'https://auth.meta.com/device',
      state: 'state-meta-1',
      user_code: 'ABCD-EFGH',
    });
    mocks.getAuthStatus.mockResolvedValueOnce({ status: 'ok' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    const card = getMetaCard(renderer);
    expect(textContent(card)).toContain('ABCD-EFGH');

    // Trigger polling tick
    await tickInterval(0);

    // After success: status is success, userCode is cleared
    expect(textContent(card)).toContain('auth_login.meta_oauth_status_success');
    expect(textContent(card)).not.toContain('ABCD-EFGH');

    // Mutation marker and revision must be recorded for provider='meta'
    expect(mocks.recordMutationMarker).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionFingerprint: 'http://cpa-a.local:8317:key-a',
        provider: 'meta',
        requireObservedMutation: true,
      })
    );
    expect(mocks.publishMutationRevision).toHaveBeenCalledWith({
      connectionFingerprint: 'http://cpa-a.local:8317:key-a',
      provider: 'meta',
      kind: 'oauth',
    });
  });

  it('clears user_code and stops polling when polling returns error', async () => {
    mocks.startAuth.mockResolvedValueOnce({
      url: 'https://auth.meta.com/device',
      state: 'state-meta-1',
      user_code: 'ABCD-EFGH',
    });
    mocks.getAuthStatus.mockResolvedValueOnce({ status: 'error', error: 'Code expired' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    await tickInterval(0);

    const card = getMetaCard(renderer);
    expect(textContent(card)).toContain('auth_login.meta_oauth_status_error');
    expect(textContent(card)).not.toContain('ABCD-EFGH');
  });

  it('clears user_code and old attempt when starting a new auth attempt', async () => {
    mocks.startAuth
      .mockResolvedValueOnce({
        url: 'https://auth.meta.com/device-1',
        state: 'state-1',
        user_code: 'CODE-1111',
      })
      .mockResolvedValueOnce({
        url: 'https://auth.meta.com/device-2',
        state: 'state-2',
        user_code: 'CODE-2222',
      });
    mocks.getAuthStatus.mockResolvedValue({ status: 'wait' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    const card = getMetaCard(renderer);
    expect(textContent(card)).toContain('CODE-1111');

    // User restarts login
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(textContent(card)).toContain('CODE-2222');
    expect(textContent(card)).not.toContain('CODE-1111');
  });

  it('prevents stale poll response from completing a superseded Meta attempt', async () => {
    let resolveStalePoll!: (value: unknown) => void;
    const stalePollPromise = new Promise((resolve) => {
      resolveStalePoll = resolve;
    });

    mocks.startAuth
      .mockResolvedValueOnce({
        url: 'https://auth.meta.com/device-1',
        state: 'state-1',
        user_code: 'CODE-1111',
      })
      .mockResolvedValueOnce({
        url: 'https://auth.meta.com/device-2',
        state: 'state-2',
        user_code: 'CODE-2222',
      });

    mocks.getAuthStatus
      .mockReturnValueOnce(stalePollPromise)
      .mockResolvedValue({ status: 'wait' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    // Start polling on attempt 1 without hanging the act
    let pollingPromise!: Promise<void>;
    await act(async () => {
      pollingPromise = Promise.resolve(mocks.intervalCallbacks[0]?.());
      await Promise.resolve();
    });

    // User immediately restarts login, creating attempt 2
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    // Stale poll 1 returns 'ok'
    await act(async () => {
      resolveStalePoll({ status: 'ok' });
      await pollingPromise;
      await Promise.resolve();
    });

    // Attempt 1 must NOT complete attempt 2
    expect(mocks.recordMutationMarker).not.toHaveBeenCalled();
    const card = getMetaCard(renderer);
    expect(textContent(card)).toContain('CODE-2222');
  });

  it('discards attempts and clears states after connection switch', async () => {
    mocks.startAuth.mockResolvedValueOnce({
      url: 'https://auth.meta.com/device-1',
      state: 'state-1',
      user_code: 'CODE-1111',
    });
    mocks.getAuthStatus.mockResolvedValue({ status: 'wait' });

    const renderer = await renderOAuthPage();
    await act(async () => {
      findMetaLoginButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(textContent(getMetaCard(renderer))).toContain('CODE-1111');

    // Switch CPA connection
    mocks.apiBase = 'http://cpa-b.local:8317';
    await act(async () => {
      renderer.update(<OAuthPage />);
      await Promise.resolve();
    });

    // State must be cleanly reset
    const updatedCard = getMetaCard(renderer);
    expect(textContent(updatedCard)).not.toContain('CODE-1111');
    expect(textContent(updatedCard)).not.toContain('https://auth.meta.com/device-1');
  });
});
