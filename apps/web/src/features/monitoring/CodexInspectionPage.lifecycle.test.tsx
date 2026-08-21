import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { CodexInspectionLastRunState } from '@/features/monitoring/codexInspection';
import type { AuthFileItem } from '@/types';
import { CodexInspectionPage } from './CodexInspectionPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  authState: {
    apiBase: 'http://cpa-a.local:8317',
    managementKey: 'cpa-key-a',
    connectionStatus: 'connected' as const,
  },
  configState: {
    config: null,
  },
  executeActions: vi.fn(),
  loadLastRun: vi.fn(),
  lastCodexReauthProps: null as null | {
    open: boolean;
    requestScope?: { apiBase: string; managementKey: string };
  },
  showConfirmation: vi.fn(),
  showNotification: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
  useConfigStore: (selector: (state: typeof mocks.configState) => unknown) =>
    selector(mocks.configState),
  useNotificationStore: (
    selector: (state: {
      showConfirmation: typeof mocks.showConfirmation;
      showNotification: typeof mocks.showNotification;
    }) => unknown
  ) =>
    selector({
      showConfirmation: mocks.showConfirmation,
      showNotification: mocks.showNotification,
    }),
}));

vi.mock('@/features/monitoring/codexInspection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/monitoring/codexInspection')>();
  return {
    ...actual,
    executeCodexInspectionActions: mocks.executeActions,
    loadCodexInspectionLastRun: mocks.loadLastRun,
    saveCodexInspectionLastRun: vi.fn(),
  };
});

vi.mock('@/features/oauth/CodexReauthDialog', () => ({
  CodexReauthDialog: (props: {
    open: boolean;
    requestScope?: { apiBase: string; managementKey: string };
  }) => {
    mocks.lastCodexReauthProps = props;
    return props.open ? <div data-codex-reauth-open="true" /> : null;
  },
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const textContent = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('');

const fingerprint = (apiBase: string, managementKey: string) => {
  const input = `${apiBase}\u0000${managementKey}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }

  return `v1:${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
};

const file = (disabled: boolean): AuthFileItem => ({
  id: 'runtime-1',
  name: 'codex.json',
  type: 'codex',
  authIndex: 'auth-1',
  disabled,
  status: 'success',
});

const lastRun = (connectionFingerprint: string): CodexInspectionLastRunState => ({
  result: {
    settings: {
      baseUrl: '',
      token: '',
      targetTypes: ['codex'],
      targetType: 'codex',
      workers: 1,
      deleteWorkers: 1,
      timeout: 15_000,
      retries: 0,
      userAgent: 'test-agent',
      xaiInferenceUserAgent: 'test-xai-agent',
      xaiInferenceEnabled: false,
      xaiInferenceModel: 'grok-4',
      xaiInferencePrompt: 'ping',
      usedPercentThreshold: 100,
      sampleSize: 0,
    },
    files: [file(true)],
    results: [
      {
        key: 'codex.json::auth-1',
        runtimeId: 'runtime-1',
        fileName: 'codex.json',
        displayAccount: 'account@example.com',
        accountSnapshot: 'account@example.com',
        authIndex: 'auth-1',
        accountId: null,
        provider: 'codex',
        disabled: true,
        autoRecoverOwned: false,
        status: 'success',
        state: 'healthy',
        raw: file(true),
        action: 'enable',
        actionReason: 'quota recovered',
        statusCode: 200,
        usedPercent: 0,
        isQuota: false,
        autoRecoverEligible: true,
        error: '',
      },
    ],
    summary: {
      totalFiles: 1,
      probeSetCount: 1,
      sampledCount: 1,
      disabledCount: 1,
      enabledCount: 0,
      deleteCount: 0,
      disableCount: 0,
      enableCount: 1,
      reauthCount: 0,
      keepCount: 0,
      usedPercentThreshold: 100,
      sampled: false,
      plannedActionPreview: ['account@example.com -> enable'],
    },
    startedAt: 1_000,
    finishedAt: 2_000,
  },
  logs: [],
  logsCollapsed: false,
  actionFilter: 'all',
  connectionFingerprint,
  savedAt: 2_000,
});

const pendingActionButton = (renderer: ReactTestRenderer): ReactTestInstance | undefined =>
  renderer.root
    .findAllByType('button')
    .find((button) => textContent(button) === 'monitoring.codex_inspection_action_enable');

const isExecuting = (renderer: ReactTestRenderer): boolean =>
  renderer.root
    .findAllByType('button')
    .some((button) => textContent(button) === 'monitoring.codex_inspection_executing');

describe('CodexInspectionPage connection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.apiBase = 'http://cpa-a.local:8317';
    mocks.authState.managementKey = 'cpa-key-a';
    mocks.authState.connectionStatus = 'connected';
    mocks.lastCodexReauthProps = null;
    const firstFingerprint = fingerprint(mocks.authState.apiBase, mocks.authState.managementKey);
    const secondFingerprint = fingerprint('http://cpa-b.local:8317', 'cpa-key-b');
    mocks.loadLastRun.mockImplementation((connectionFingerprint?: string | null) =>
      connectionFingerprint === firstFingerprint || connectionFingerprint === secondFingerprint
        ? lastRun(connectionFingerprint)
        : null
    );
    mocks.showConfirmation.mockImplementation((options: { onConfirm: () => void }) => {
      options.onConfirm();
    });
  });

  it('ignores an old action completion after switching CPA scope', async () => {
    const oldActionRequest = deferred<Awaited<ReturnType<typeof mocks.executeActions>>>();
    const newActionRequest = deferred<Awaited<ReturnType<typeof mocks.executeActions>>>();
    mocks.executeActions
      .mockReturnValueOnce(oldActionRequest.promise)
      .mockReturnValueOnce(newActionRequest.promise);
    const onCredentialsChanged = vi.fn();
    const onSnapshotChange = vi.fn();

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <CodexInspectionPage
            onCredentialsChanged={onCredentialsChanged}
            onSnapshotChange={onSnapshotChange}
          />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const enableButton = pendingActionButton(renderer!);
    expect(enableButton).toBeDefined();

    await act(async () => {
      enableButton!.props.onClick();
      await Promise.resolve();
    });
    expect(mocks.executeActions).toHaveBeenCalledTimes(1);

    mocks.authState.apiBase = 'http://cpa-b.local:8317';
    mocks.authState.managementKey = 'cpa-key-b';
    await act(async () => {
      renderer!.update(
        <MemoryRouter>
          <CodexInspectionPage
            onCredentialsChanged={onCredentialsChanged}
            onSnapshotChange={onSnapshotChange}
          />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
    const newEnableButton = pendingActionButton(renderer!);
    expect(newEnableButton).toBeDefined();
    await act(async () => {
      newEnableButton!.props.onClick();
      await Promise.resolve();
    });
    expect(mocks.executeActions).toHaveBeenCalledTimes(2);
    expect(isExecuting(renderer!)).toBe(true);
    onCredentialsChanged.mockClear();
    onSnapshotChange.mockClear();
    mocks.showNotification.mockClear();

    await act(async () => {
      oldActionRequest.resolve({
        outcomes: [
          {
            accountKey: 'codex.json::auth-1',
            action: 'enable',
            fileName: 'codex.json',
            displayAccount: 'account@example.com',
            status: 'success',
            success: true,
            error: '',
          },
        ],
        refreshedFiles: [file(false)],
        refreshError: '',
      });
      await Promise.resolve();
    });

    expect(onCredentialsChanged).not.toHaveBeenCalled();
    expect(onSnapshotChange).not.toHaveBeenCalled();
    expect(mocks.showNotification).not.toHaveBeenCalledWith(
      'monitoring.codex_inspection_execute_success',
      'success'
    );
    expect(isExecuting(renderer!)).toBe(true);

    await act(async () => {
      newActionRequest.resolve({
        outcomes: [
          {
            accountKey: 'codex.json::auth-1',
            action: 'enable',
            fileName: 'codex.json',
            displayAccount: 'account@example.com',
            status: 'success',
            success: true,
            error: '',
          },
        ],
        refreshedFiles: [file(false)],
        refreshError: '',
      });
      await Promise.resolve();
    });

    expect(isExecuting(renderer!)).toBe(false);
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1);

    act(() => renderer!.unmount());
  });

  it('reports a successful action with an Accounts synchronization warning', async () => {
    mocks.executeActions.mockResolvedValue({
      outcomes: [
        {
          accountKey: 'codex.json::auth-1',
          action: 'enable',
          fileName: 'codex.json',
          displayAccount: 'account@example.com',
          status: 'success',
          success: true,
          error: '',
        },
      ],
      refreshedFiles: [file(false)],
      refreshError: '',
    });
    const onCredentialsChanged = vi
      .fn()
      .mockRejectedValue(new Error('temporary Accounts reload failure'));
    const onSnapshotChange = vi.fn();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <CodexInspectionPage
            onCredentialsChanged={onCredentialsChanged}
            onSnapshotChange={onSnapshotChange}
          />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    await act(async () => {
      pendingActionButton(renderer)?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onCredentialsChanged).toHaveBeenCalledTimes(1);
    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'local',
        results: [
          expect.objectContaining({
            action: 'keep',
            actionStatus: 'pending',
            disabled: false,
          }),
        ],
      })
    );
    expect(onSnapshotChange.mock.invocationCallOrder[0]).toBeLessThan(
      onCredentialsChanged.mock.invocationCallOrder[0]
    );
    expect(mocks.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('temporary Accounts reload failure'),
      'warning'
    );
    expect(mocks.showNotification).not.toHaveBeenCalledWith(
      expect.stringContaining('monitoring.codex_inspection_log_execution_failed'),
      'error'
    );
    expect(isExecuting(renderer)).toBe(false);

    act(() => renderer.unmount());
  });

  it('closes Codex re-login and publishes the new request scope after switching CPA', async () => {
    const buildReauthLastRun = (connectionFingerprint: string): CodexInspectionLastRunState => {
      const state = lastRun(connectionFingerprint);
      return {
        ...state,
        result: {
          ...state.result,
          results: [
            {
              ...state.result.results[0],
              disabled: false,
              action: 'reauth',
              actionReason: 'expired token',
              statusCode: 401,
              status: 'error',
              state: 'error',
              error: 'expired token',
            },
          ],
          summary: {
            ...state.result.summary,
            disabledCount: 0,
            enableCount: 0,
            reauthCount: 1,
          },
        },
      };
    };
    const firstFingerprint = fingerprint(mocks.authState.apiBase, mocks.authState.managementKey);
    const secondFingerprint = fingerprint('http://cpa-b.local:8317', 'cpa-key-b');
    mocks.loadLastRun.mockImplementation((connectionFingerprint?: string | null) =>
      connectionFingerprint === firstFingerprint || connectionFingerprint === secondFingerprint
        ? buildReauthLastRun(connectionFingerprint)
        : null
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <CodexInspectionPage />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const reauthButton = renderer.root
      .findAllByType('button')
      .find((button) => textContent(button) === 'codex_reauth.button');
    expect(reauthButton).toBeDefined();
    act(() => reauthButton!.props.onClick());

    expect(mocks.lastCodexReauthProps?.open).toBe(true);
    expect(mocks.lastCodexReauthProps?.requestScope).toEqual({
      apiBase: 'http://cpa-a.local:8317',
      managementKey: 'cpa-key-a',
    });

    mocks.authState.apiBase = 'http://cpa-b.local:8317';
    mocks.authState.managementKey = 'cpa-key-b';
    await act(async () => {
      renderer.update(
        <MemoryRouter>
          <CodexInspectionPage />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(mocks.lastCodexReauthProps?.open).toBe(false);
    expect(mocks.lastCodexReauthProps?.requestScope).toEqual({
      apiBase: 'http://cpa-b.local:8317',
      managementKey: 'cpa-key-b',
    });

    act(() => renderer.unmount());
  });
});
