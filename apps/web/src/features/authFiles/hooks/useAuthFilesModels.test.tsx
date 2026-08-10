import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { useAuthFilesModels, type UseAuthFilesModelsResult } from './useAuthFilesModels';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getModelsForAuthFile: vi.fn(),
    getModelDefinitions: vi.fn(),
    showNotification: vi.fn(),
    t: (key: string) => key,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    authFilesApi: {
      ...actual.authFilesApi,
      getModelsForAuthFile: mocks.getModelsForAuthFile,
      getModelDefinitions: mocks.getModelDefinitions,
    },
  };
});

vi.mock('@/stores', () => ({
  useNotificationStore: (
    selector: (state: { showNotification: typeof mocks.showNotification }) => unknown
  ) => selector({ showNotification: mocks.showNotification }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = {
  name: 'shared.json',
  id: 'runtime-codex-1',
  type: 'codex',
  provider: 'codex',
  authIndex: 'auth-1',
  account: 'codex@example.com',
} as AuthFileItem;

describe('useAuthFilesModels', () => {
  let renderer: ReactTestRenderer | null = null;
  let latest: UseAuthFilesModelsResult | null = null;

  function Harness({ connectionKey = 'connection-a' }: { connectionKey?: string }) {
    const result = useAuthFilesModels({ connectionKey });
    useEffect(() => {
      latest = result;
    }, [result]);
    return null;
  }

  beforeEach(() => {
    latest = null;
    renderer = null;
    mocks.getModelsForAuthFile.mockReset();
    mocks.getModelDefinitions.mockReset();
    mocks.showNotification.mockReset();
    mocks.getModelsForAuthFile.mockResolvedValue([{ id: 'gpt-5-codex' }]);
    mocks.getModelDefinitions.mockResolvedValue([{ id: 'gpt-5-codex' }, { id: 'gpt-5-mini' }]);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
  });

  const mount = async (connectionKey = 'connection-a') => {
    await act(async () => {
      renderer = create(<Harness connectionKey={connectionKey} />);
      await Promise.resolve();
    });
  };

  it('loads models by runtime identity and caches provider definitions', async () => {
    await mount();

    await act(async () => {
      await latest?.showModels(file);
    });

    expect(mocks.getModelsForAuthFile).toHaveBeenCalledWith('runtime-codex-1');
    expect(mocks.getModelDefinitions).toHaveBeenCalledWith('codex');
    expect(latest?.modelsList).toEqual([{ id: 'gpt-5-codex' }]);
    expect(latest?.modelDefinitions).toEqual([{ id: 'gpt-5-codex' }, { id: 'gpt-5-mini' }]);

    await act(async () => {
      await latest?.showModels(file);
    });

    expect(mocks.getModelsForAuthFile).toHaveBeenCalledTimes(1);
    expect(mocks.getModelDefinitions).toHaveBeenCalledTimes(1);
  });

  it('force refreshes both runtime models and definitions', async () => {
    await mount();
    await act(async () => {
      await latest?.showModels(file);
    });

    mocks.getModelsForAuthFile.mockResolvedValueOnce([{ id: 'gpt-5-mini' }]);
    mocks.getModelDefinitions.mockResolvedValueOnce([{ id: 'gpt-5-mini' }]);
    await act(async () => {
      await latest?.refreshModels(file);
    });

    expect(mocks.getModelsForAuthFile).toHaveBeenCalledTimes(2);
    expect(mocks.getModelDefinitions).toHaveBeenCalledTimes(2);
    expect(latest?.modelsList).toEqual([{ id: 'gpt-5-mini' }]);
    expect(latest?.modelDefinitions).toEqual([{ id: 'gpt-5-mini' }]);
  });

  it('only marks an explicit refresh as refreshing', async () => {
    let resolveInitial!: (models: AuthFileModelItem[]) => void;
    const initialPromise = new Promise<AuthFileModelItem[]>((resolve) => {
      resolveInitial = resolve;
    });
    mocks.getModelsForAuthFile.mockReturnValueOnce(initialPromise);

    await mount();
    let initialRequest!: Promise<void>;
    await act(async () => {
      initialRequest = latest!.showModels(file);
      await Promise.resolve();
    });

    expect(latest?.modelsLoading).toBe(true);
    expect(latest?.modelsRefreshing).toBe(false);

    await act(async () => {
      resolveInitial([{ id: 'gpt-5-codex' }]);
      await initialRequest;
    });

    let resolveRefresh!: (models: AuthFileModelItem[]) => void;
    const refreshPromise = new Promise<AuthFileModelItem[]>((resolve) => {
      resolveRefresh = resolve;
    });
    mocks.getModelsForAuthFile.mockReturnValueOnce(refreshPromise);

    let refreshRequest!: Promise<void>;
    await act(async () => {
      refreshRequest = latest!.refreshModels(file);
      await Promise.resolve();
    });

    expect(latest?.modelsLoading).toBe(true);
    expect(latest?.modelsRefreshing).toBe(true);

    await act(async () => {
      resolveRefresh([{ id: 'gpt-5-mini' }]);
      await refreshRequest;
    });

    expect(latest?.modelsRefreshing).toBe(false);
  });

  it('keeps last-known model data visible when a force refresh fails', async () => {
    await mount();
    await act(async () => {
      await latest?.showModels(file);
    });

    mocks.getModelsForAuthFile.mockRejectedValueOnce(new Error('runtime unavailable'));
    mocks.getModelDefinitions.mockRejectedValueOnce(new Error('definitions unavailable'));
    await act(async () => {
      await latest?.refreshModels(file);
    });

    expect(latest?.modelsList).toEqual([{ id: 'gpt-5-codex' }]);
    expect(latest?.modelDefinitions).toEqual([{ id: 'gpt-5-codex' }, { id: 'gpt-5-mini' }]);
    expect(latest?.modelsError).toBe('failed');
    expect(latest?.modelDefinitionsError).toBe('failed');
    expect(latest?.modelsSelectionKey).toBe('shared.json\u0000auth-1');
  });

  it('refreshes the currently open credential when no item is supplied', async () => {
    await mount();
    await act(async () => {
      await latest?.showModels(file);
      await latest?.refreshModels();
    });

    expect(mocks.getModelsForAuthFile).toHaveBeenCalledTimes(2);
    expect(mocks.getModelsForAuthFile).toHaveBeenLastCalledWith('runtime-codex-1');
  });

  it('uses the Gemini definition channel for gemini-cli runtime credentials', async () => {
    const geminiFile = {
      ...file,
      id: 'runtime-gemini-1',
      type: 'gemini-cli',
      provider: 'gemini-cli',
    } as AuthFileItem;
    await mount();

    await act(async () => {
      await latest?.showModels(geminiFile);
    });

    expect(mocks.getModelsForAuthFile).toHaveBeenCalledWith('runtime-gemini-1');
    expect(mocks.getModelDefinitions).toHaveBeenCalledWith('gemini');
    expect(latest?.modelsFileType).toBe('gemini-cli');
  });

  it('keeps shared-file runtime identities in separate cache entries', async () => {
    const second = { ...file, id: 'runtime-codex-2', authIndex: 'auth-2' } as AuthFileItem;
    await mount();

    await act(async () => {
      await latest?.showModels(file);
      await latest?.showModels(second);
    });

    expect(mocks.getModelsForAuthFile).toHaveBeenNthCalledWith(1, 'runtime-codex-1');
    expect(mocks.getModelsForAuthFile).toHaveBeenNthCalledWith(2, 'runtime-codex-2');
    expect(mocks.getModelDefinitions).toHaveBeenCalledTimes(1);
  });

  it('retains runtime models when static definitions are unsupported', async () => {
    mocks.getModelDefinitions.mockRejectedValueOnce(new Error('404 Not Found'));
    await mount();

    await act(async () => {
      await latest?.showModels(file);
    });

    expect(latest?.modelsList).toEqual([{ id: 'gpt-5-codex' }]);
    expect(latest?.modelDefinitions).toEqual([]);
    expect(latest?.modelDefinitionsError).toBe('unsupported');
    expect(mocks.showNotification).not.toHaveBeenCalled();
  });

  it('classifies an HTTP 404 model endpoint as unsupported even with a generic message', async () => {
    mocks.getModelsForAuthFile.mockRejectedValueOnce(
      Object.assign(new Error('feature unavailable'), { status: 404 })
    );
    await mount();

    await act(async () => {
      await latest?.showModels(file);
    });

    expect(latest?.modelsError).toBe('unsupported');
    expect(mocks.showNotification).not.toHaveBeenCalled();
  });

  it('keeps a real model endpoint failure distinct from an empty model list', async () => {
    mocks.getModelsForAuthFile.mockRejectedValueOnce(
      Object.assign(new Error('upstream unavailable'), { status: 503 })
    );
    await mount();

    await act(async () => {
      await latest?.showModels(file);
    });

    expect(latest?.modelsError).toBe('failed');
    expect(latest?.modelsList).toEqual([]);
    expect(mocks.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('notification.load_failed'),
      'error'
    );
  });

  it('ignores a stale response after switching to a sibling credential', async () => {
    const second = { ...file, id: 'runtime-codex-2', authIndex: 'auth-2' } as AuthFileItem;
    let resolveFirst!: (models: AuthFileModelItem[]) => void;
    const firstPromise = new Promise<AuthFileModelItem[]>((resolve) => {
      resolveFirst = resolve;
    });
    mocks.getModelsForAuthFile
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce([{ id: 'sibling-model' }]);

    await mount();
    let firstRequest!: Promise<void>;
    await act(async () => {
      firstRequest = latest!.showModels(file);
      await Promise.resolve();
      await latest!.showModels(second);
    });

    expect(latest?.modelsFileName).toBe(second.name);
    expect(latest?.modelsList).toEqual([{ id: 'sibling-model' }]);

    await act(async () => {
      resolveFirst([{ id: 'stale-model' }]);
      await firstRequest;
    });

    expect(latest?.modelsFileType).toBe('codex');
    expect(latest?.modelsList).toEqual([{ id: 'sibling-model' }]);
  });

  it('isolates the same credential identity across CPA connections', async () => {
    let resolveFirst!: (models: AuthFileModelItem[]) => void;
    const firstPromise = new Promise<AuthFileModelItem[]>((resolve) => {
      resolveFirst = resolve;
    });
    mocks.getModelsForAuthFile
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce([{ id: 'connection-b-model' }]);
    mocks.getModelDefinitions
      .mockResolvedValueOnce([{ id: 'connection-a-definition' }])
      .mockResolvedValueOnce([{ id: 'connection-b-definition' }]);

    await mount('connection-a');
    let firstRequest!: Promise<void>;
    await act(async () => {
      firstRequest = latest!.showModels(file);
      await Promise.resolve();
    });

    await act(async () => {
      renderer?.update(<Harness connectionKey="connection-b" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest?.modelsList).toEqual([]);
    expect(latest?.modelsSelectionKey).toBe('');

    await act(async () => {
      await latest?.showModels(file);
    });
    expect(latest?.modelsList).toEqual([{ id: 'connection-b-model' }]);
    expect(latest?.modelDefinitions).toEqual([{ id: 'connection-b-definition' }]);

    await act(async () => {
      resolveFirst([{ id: 'stale-connection-a-model' }]);
      await firstRequest;
    });

    expect(latest?.modelsList).toEqual([{ id: 'connection-b-model' }]);
    expect(mocks.getModelsForAuthFile).toHaveBeenCalledTimes(2);
    expect(mocks.getModelDefinitions).toHaveBeenCalledTimes(2);
  });
});
