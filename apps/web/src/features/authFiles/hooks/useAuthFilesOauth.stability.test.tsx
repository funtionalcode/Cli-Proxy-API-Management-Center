import { act, createElement, useEffect, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseAuthFilesOauthResult } from './useAuthFilesOauth';

const { mocks } = vi.hoisted(() => {
  const translate = (key: string) => key;
  return {
    mocks: {
      getOauthExcludedModels: vi.fn(),
      getOauthModelAlias: vi.fn(),
      getModelDefinitions: vi.fn(),
      saveOauthModelAlias: vi.fn(),
      deleteOauthModelAlias: vi.fn(),
      showNotification: vi.fn(),
      showConfirmation: vi.fn(),
      // Stable like production react-i18next `t` / store actions.
      translate,
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.translate,
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('@/stores', () => ({
  useNotificationStore: () => ({
    showNotification: mocks.showNotification,
    showConfirmation: mocks.showConfirmation,
  }),
}));

vi.mock('@/services/api', () => ({
  authFilesApi: {
    getOauthExcludedModels: mocks.getOauthExcludedModels,
    getOauthModelAlias: mocks.getOauthModelAlias,
    getModelDefinitions: mocks.getModelDefinitions,
    saveOauthModelAlias: mocks.saveOauthModelAlias,
    deleteOauthModelAlias: mocks.deleteOauthModelAlias,
  },
}));

import { useAuthFilesOauth } from './useAuthFilesOauth';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessApi = {
  getLatest: () => UseAuthFilesOauthResult;
  bumpRender: () => void;
  switchConnection: (connectionKey: string) => void;
  unmount: () => void;
};

/**
 * Mimics AuthFilesPage: call loaders once when they appear in the dependency list.
 * Unstable loader identities re-trigger this effect after every successful load.
 */
function AuthFilesInitEffectHarness({
  connectionKey,
  onResult,
  onBumpReady,
}: {
  connectionKey: string;
  onResult: (result: UseAuthFilesOauthResult) => void;
  onBumpReady: (bump: () => void) => void;
}) {
  const [renderTick, setRenderTick] = useState(0);
  const result = useAuthFilesOauth({
    viewMode: 'list',
    files: [],
    connectionKey,
    requestScope: {
      apiBase: `http://${connectionKey}.local:8317`,
      managementKey: `${connectionKey}-key`,
    },
  });
  const { loadExcluded, loadModelAlias } = result;

  useEffect(() => {
    onBumpReady(() => setRenderTick((value) => value + 1));
  }, [onBumpReady]);

  useEffect(() => {
    void loadExcluded();
    void loadModelAlias();
  }, [loadExcluded, loadModelAlias]);

  // Force a harmless re-render path that must not recreate loader identities.
  void renderTick;
  onResult(result);
  return null;
}

const mountHarness = (initialConnectionKey = 'connection-a'): HarnessApi => {
  let latest: UseAuthFilesOauthResult | null = null;
  let bumpRender: (() => void) | null = null;
  let renderer: ReactTestRenderer | null = null;
  let connectionKey = initialConnectionKey;
  const onResult = (result: UseAuthFilesOauthResult) => {
    latest = result;
  };
  const onBumpReady = (bump: () => void) => {
    bumpRender = bump;
  };
  const renderHarness = () =>
    createElement(AuthFilesInitEffectHarness, {
      connectionKey,
      onResult,
      onBumpReady,
    });

  act(() => {
    renderer = create(renderHarness());
  });

  return {
    getLatest: () => {
      if (!latest) {
        throw new Error('useAuthFilesOauth harness did not mount');
      }
      return latest;
    },
    bumpRender: () => {
      if (!bumpRender) {
        throw new Error('useAuthFilesOauth harness bump is not ready');
      }
      act(() => {
        bumpRender?.();
      });
    },
    switchConnection: (nextConnectionKey: string) => {
      connectionKey = nextConnectionKey;
      act(() => {
        renderer?.update(renderHarness());
      });
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('useAuthFilesOauth loader reference stability', () => {
  let harness: HarnessApi | null = null;

  beforeEach(() => {
    mocks.getOauthExcludedModels.mockReset();
    mocks.getOauthModelAlias.mockReset();
    mocks.getModelDefinitions.mockReset();
    mocks.saveOauthModelAlias.mockReset();
    mocks.deleteOauthModelAlias.mockReset();
    mocks.showNotification.mockReset();
    mocks.showConfirmation.mockReset();

    mocks.getOauthExcludedModels.mockResolvedValue({});
    mocks.getOauthModelAlias.mockResolvedValue({});
    mocks.getModelDefinitions.mockResolvedValue([]);
    mocks.saveOauthModelAlias.mockResolvedValue(undefined);
    mocks.deleteOauthModelAlias.mockResolvedValue(undefined);
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('loads each OAuth config endpoint once and keeps loader identities stable across re-renders', async () => {
    harness = mountHarness();
    await flushAsync();

    expect(mocks.getOauthExcludedModels).toHaveBeenCalledTimes(1);
    expect(mocks.getOauthModelAlias).toHaveBeenCalledTimes(1);

    const afterFirstLoad = harness.getLatest();
    expect(afterFirstLoad.excludedError).toBe('ready');
    expect(afterFirstLoad.modelAliasError).toBe('ready');

    const loadExcludedBeforeRerender = afterFirstLoad.loadExcluded;
    const loadModelAliasBeforeRerender = afterFirstLoad.loadModelAlias;

    harness.bumpRender();
    await flushAsync();

    const afterRerender = harness.getLatest();
    expect(afterRerender.loadExcluded).toBe(loadExcludedBeforeRerender);
    expect(afterRerender.loadModelAlias).toBe(loadModelAliasBeforeRerender);
    expect(mocks.getOauthExcludedModels).toHaveBeenCalledTimes(1);
    expect(mocks.getOauthModelAlias).toHaveBeenCalledTimes(1);
  });

  it('clears OAuth rules immediately and ignores late responses from the previous connection', async () => {
    const oldExcluded = createDeferred<Record<string, string[]>>();
    const oldAliases = createDeferred<Record<string, Array<{ name: string; alias: string }>>>();
    mocks.getOauthExcludedModels
      .mockReset()
      .mockImplementationOnce(() => oldExcluded.promise)
      .mockResolvedValue({ claude: ['new-*'] });
    mocks.getOauthModelAlias
      .mockReset()
      .mockImplementationOnce(() => oldAliases.promise)
      .mockResolvedValue({ claude: [{ name: 'new-model', alias: 'new-alias' }] });

    harness = mountHarness('connection-a');
    expect(mocks.getOauthExcludedModels).toHaveBeenCalledTimes(1);
    expect(mocks.getOauthModelAlias).toHaveBeenCalledTimes(1);

    harness.switchConnection('connection-b');

    expect(harness.getLatest().excluded).toEqual({});
    expect(harness.getLatest().modelAlias).toEqual({});
    expect(harness.getLatest().excludedError).toBe('loading');
    expect(harness.getLatest().modelAliasError).toBe('loading');

    await flushAsync();

    expect(harness.getLatest().excluded).toEqual({ claude: ['new-*'] });
    expect(harness.getLatest().modelAlias).toEqual({
      claude: [{ name: 'new-model', alias: 'new-alias' }],
    });

    oldExcluded.resolve({ codex: ['old-*'] });
    oldAliases.resolve({ codex: [{ name: 'old-model', alias: 'old-alias' }] });
    await flushAsync();

    expect(harness.getLatest().excluded).toEqual({ claude: ['new-*'] });
    expect(harness.getLatest().modelAlias).toEqual({
      claude: [{ name: 'new-model', alias: 'new-alias' }],
    });
  });

  it('invalidates the mutation baseline and queued handlers when the connection changes', async () => {
    const newExcluded = createDeferred<Record<string, string[]>>();
    const newAliases = createDeferred<Record<string, Array<{ name: string; alias: string }>>>();
    mocks.getOauthExcludedModels
      .mockReset()
      .mockResolvedValueOnce({ codex: [] })
      .mockImplementationOnce(() => newExcluded.promise);
    mocks.getOauthModelAlias
      .mockReset()
      .mockResolvedValueOnce({ codex: [{ name: 'gpt-old', alias: 'old-alias' }] })
      .mockImplementationOnce(() => newAliases.promise);

    harness = mountHarness('connection-a');
    await flushAsync();
    const oldMutation = harness.getLatest().handleMappingUpdate;

    harness.switchConnection('connection-b');
    await oldMutation('codex', 'gpt-old', 'stale-write');
    await harness.getLatest().handleMappingUpdate('codex', 'gpt-new', 'new-alias');

    expect(mocks.saveOauthModelAlias).not.toHaveBeenCalled();
    expect(mocks.deleteOauthModelAlias).not.toHaveBeenCalled();
    expect(mocks.showNotification).toHaveBeenCalledWith('notification.refresh_failed', 'error');

    newExcluded.resolve({});
    newAliases.resolve({});
    await flushAsync();
  });

  it('rolls back a multi-provider rename on the captured connection when the scope changes mid-write', async () => {
    const originalAliases = {
      claude: [{ name: 'claude-upstream', alias: 'shared' }],
      codex: [{ name: 'codex-upstream', alias: 'shared' }],
    };
    const storedAliases = structuredClone(originalAliases);
    const firstWrite = createDeferred<void>();
    let writeCount = 0;
    mocks.getOauthModelAlias
      .mockReset()
      .mockResolvedValueOnce(originalAliases)
      .mockResolvedValueOnce(originalAliases)
      .mockResolvedValue({});
    mocks.saveOauthModelAlias
      .mockReset()
      .mockImplementation(
        async (
          channel: keyof typeof storedAliases,
          aliases: Array<{ name: string; alias: string }>
        ) => {
          storedAliases[channel] = structuredClone(aliases);
          writeCount += 1;
          if (writeCount === 1) await firstWrite.promise;
        }
      );

    harness = mountHarness('connection-a');
    await flushAsync();

    let mutationPromise: Promise<void> | null = null;
    act(() => {
      mutationPromise = harness?.getLatest().handleRenameAlias('shared', 'renamed') ?? null;
    });
    await flushAsync();
    expect(mocks.saveOauthModelAlias).toHaveBeenCalledTimes(1);

    harness.switchConnection('connection-b');
    await act(async () => {
      firstWrite.resolve();
      await mutationPromise;
    });
    await flushAsync();

    expect(mocks.saveOauthModelAlias).toHaveBeenCalledTimes(3);
    expect(mocks.saveOauthModelAlias.mock.calls.map((call) => call[2]?.apiBase)).toEqual([
      'http://connection-a.local:8317',
      'http://connection-a.local:8317',
      'http://connection-a.local:8317',
    ]);
    expect(storedAliases).toEqual(originalAliases);
    expect(mocks.showNotification).not.toHaveBeenCalledWith(
      'oauth_model_alias.save_success',
      'success'
    );
  });

  it('reports a partial update when captured-connection rollback fails after a scope change', async () => {
    const originalAliases = {
      claude: [{ name: 'claude-upstream', alias: 'shared' }],
      codex: [{ name: 'codex-upstream', alias: 'shared' }],
    };
    const firstWrite = createDeferred<void>();
    let writeCount = 0;
    mocks.getOauthModelAlias
      .mockReset()
      .mockResolvedValueOnce(originalAliases)
      .mockResolvedValueOnce(originalAliases)
      .mockResolvedValue({});
    mocks.saveOauthModelAlias.mockReset().mockImplementation(async () => {
      writeCount += 1;
      if (writeCount === 1) {
        await firstWrite.promise;
        return;
      }
      if (writeCount === 3) throw new Error('old CPA unavailable');
    });

    harness = mountHarness('connection-a');
    await flushAsync();

    let mutationPromise: Promise<void> | null = null;
    act(() => {
      mutationPromise = harness?.getLatest().handleRenameAlias('shared', 'renamed') ?? null;
    });
    await flushAsync();
    harness.switchConnection('connection-b');

    await act(async () => {
      firstWrite.resolve();
      await mutationPromise;
    });
    await flushAsync();

    expect(mocks.showNotification).toHaveBeenCalledWith(
      'oauth_model_alias.rollback_failed',
      'error'
    );
    expect(
      mocks.saveOauthModelAlias.mock.calls.every(
        (call) => call[2]?.apiBase === 'http://connection-a.local:8317'
      )
    ).toBe(true);
  });
});
