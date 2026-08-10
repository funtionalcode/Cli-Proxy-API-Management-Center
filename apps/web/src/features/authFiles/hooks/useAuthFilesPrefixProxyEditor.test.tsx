import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    downloadText: vi.fn(),
    list: vi.fn(),
    patchFieldsWithPluginSourceFallback: vi.fn(),
    showNotification: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.name === 'string' ? `${key}:${options.name}` : key,
  }),
}));

vi.mock('@/stores', () => ({
  useNotificationStore: (
    selector: (state: { showNotification: typeof mocks.showNotification }) => unknown
  ) => selector({ showNotification: mocks.showNotification }),
}));

vi.mock('@/services/api', () => ({
  authFilesApi: {
    downloadText: mocks.downloadText,
    list: mocks.list,
    patchFieldsWithPluginSourceFallback: mocks.patchFieldsWithPluginSourceFallback,
  },
}));

import {
  useAuthFilesPrefixProxyEditor,
  type UseAuthFilesPrefixProxyEditorResult,
} from './useAuthFilesPrefixProxyEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createAuthFile = (authIndex: string): AuthFileItem =>
  ({
    id: `runtime-${authIndex}`,
    name: 'shared.json',
    type: 'codex',
    provider: 'codex',
    authIndex,
    account_id: `account-${authIndex}`,
  }) as AuthFileItem;

type HarnessApi = {
  getLatest: () => UseAuthFilesPrefixProxyEditorResult;
  loadFiles: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
  unmount: () => void;
};

function Harness({
  onResult,
  loadFiles,
  onSaved,
}: {
  onResult: (result: UseAuthFilesPrefixProxyEditorResult) => void;
  loadFiles: () => Promise<void>;
  onSaved: (fileName: string) => void;
}) {
  const result = useAuthFilesPrefixProxyEditor({
    disableControls: false,
    loadFiles,
    onSaved,
  });
  onResult(result);
  return null;
}

const mountHarness = (): HarnessApi => {
  let latest: UseAuthFilesPrefixProxyEditorResult | null = null;
  let renderer: ReactTestRenderer | null = null;
  const loadFiles = vi.fn(async () => undefined);
  const onSaved = vi.fn();

  act(() => {
    renderer = create(
      createElement(Harness, {
        onResult: (result: UseAuthFilesPrefixProxyEditorResult) => {
          latest = result;
        },
        loadFiles,
        onSaved,
      })
    );
  });

  return {
    getLatest: () => {
      if (!latest) throw new Error('prefix/proxy editor harness did not mount');
      return latest;
    },
    loadFiles,
    onSaved,
    unmount: () => {
      act(() => renderer?.unmount());
      renderer = null;
    },
  };
};

describe('useAuthFilesPrefixProxyEditor', () => {
  let harness: HarnessApi | null = null;

  beforeEach(() => {
    mocks.downloadText.mockReset();
    mocks.list.mockReset();
    mocks.patchFieldsWithPluginSourceFallback.mockReset();
    mocks.showNotification.mockReset();
    mocks.list.mockResolvedValue({ files: [] });
    mocks.patchFieldsWithPluginSourceFallback.mockResolvedValue(undefined);
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('keeps raw auth credentials out of serialized editor state', async () => {
    const file = {
      ...createAuthFile('auth-1'),
      access_token: 'row-access-secret',
    } as AuthFileItem;
    mocks.downloadText.mockResolvedValue(
      JSON.stringify({
        auth_index: 'auth-1',
        account_id: 'account-auth-1',
        access_token: 'download-access-secret',
        refresh_token: 'download-refresh-secret',
        cookie: 'download-cookie-secret',
        prefix: 'team-a',
        proxy_url: 'http://127.0.0.1:8080',
        headers: {
          'X-Tenant': 'tenant-a',
          Nested: { token: 'nested-header-secret' },
        },
      })
    );
    harness = mountHarness();

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(file);
    });

    const editor = harness.getLatest().prefixProxyEditor;
    const serialized = JSON.stringify(editor);
    expect(editor?.json).toEqual({
      prefix: 'team-a',
      proxy_url: 'http://127.0.0.1:8080',
      headers: { 'X-Tenant': 'tenant-a' },
    });
    expect(serialized).not.toContain('row-access-secret');
    expect(serialized).not.toContain('download-access-secret');
    expect(serialized).not.toContain('download-refresh-secret');
    expect(serialized).not.toContain('download-cookie-secret');
    expect(serialized).not.toContain('nested-header-secret');
  });

  it('does not retain invalid downloaded content in editor state', async () => {
    const file = createAuthFile('auth-1');
    mocks.downloadText.mockResolvedValue('<html>challenge secret-body</html>');
    harness = mountHarness();

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(file);
    });

    const serialized = JSON.stringify(harness.getLatest().prefixProxyEditor);
    expect(serialized).not.toContain('secret-body');
    expect(harness.getLatest().prefixProxyEditor?.error).toBe(
      'auth_files.prefix_proxy_html_challenge'
    );
  });

  it('patches only a changed prefix without resending proxy or headers', async () => {
    const file = createAuthFile('auth-1');
    mocks.downloadText.mockResolvedValue(
      JSON.stringify({
        auth_index: 'auth-1',
        account_id: 'account-auth-1',
        prefix: 'old-prefix',
        proxy_url: 'http://127.0.0.1:8080',
        headers: { 'X-Tenant': 'tenant-a' },
      })
    );
    mocks.list.mockResolvedValue({ files: [file] });
    harness = mountHarness();

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(file);
    });
    act(() => {
      harness?.getLatest().handlePrefixProxyChange('prefix', 'new-prefix');
    });
    await act(async () => {
      await harness?.getLatest().handlePrefixProxySave();
    });

    expect(mocks.patchFieldsWithPluginSourceFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'shared.json',
        runtimeId: 'runtime-auth-1',
        authIndex: 'auth-1',
      }),
      { prefix: 'new-prefix' },
      [
        expect.objectContaining({
          name: 'shared.json',
          runtimeId: 'runtime-auth-1',
          authIndex: 'auth-1',
        }),
      ]
    );
  });

  it('sends a per-header change set when one header changes', async () => {
    const file = createAuthFile('auth-1');
    mocks.downloadText.mockResolvedValue(
      JSON.stringify({
        auth_index: 'auth-1',
        account_id: 'account-auth-1',
        headers: {
          'X-Tenant': 'tenant-a',
          'X-Region': 'east',
        },
      })
    );
    mocks.list.mockResolvedValue({ files: [file] });
    harness = mountHarness();

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(file);
    });
    act(() => {
      harness?.getLatest().handlePrefixProxyChange(
        'headersText',
        JSON.stringify({ 'X-Tenant': 'tenant-a', 'X-Region': 'west' })
      );
    });
    await act(async () => {
      await harness?.getLatest().handlePrefixProxySave();
    });

    expect(mocks.patchFieldsWithPluginSourceFallback).toHaveBeenCalledWith(
      expect.any(Object),
      { headers: { 'X-Region': 'west' } },
      expect.any(Array)
    );
  });

  it('loads the matching credential fields from a shared auth-file array', async () => {
    const first = createAuthFile('auth-1');
    const second = createAuthFile('auth-2');
    mocks.downloadText.mockResolvedValue(
      JSON.stringify([
        {
          auth_index: 'auth-1',
          account_id: 'account-auth-1',
          prefix: 'first-prefix',
          proxy_url: 'http://first.proxy',
        },
        {
          auth_index: 'auth-2',
          account_id: 'account-auth-2',
          prefix: 'second-prefix',
          proxy_url: 'http://second.proxy',
        },
      ])
    );
    harness = mountHarness();

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(second);
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-2',
      prefix: 'second-prefix',
      proxyUrl: 'http://second.proxy',
    });

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(first);
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-1',
      prefix: 'first-prefix',
      proxyUrl: 'http://first.proxy',
    });
  });

  it('does not let an older same-name download overwrite the current credential editor', async () => {
    const first = createAuthFile('auth-1');
    const second = createAuthFile('auth-2');
    const firstDownload = createDeferred<string>();
    const secondDownload = createDeferred<string>();
    mocks.downloadText
      .mockImplementationOnce(() => firstDownload.promise)
      .mockImplementationOnce(() => secondDownload.promise);
    harness = mountHarness();

    let firstOpen!: Promise<void>;
    act(() => {
      firstOpen = harness!.getLatest().openPrefixProxyEditor(first);
    });
    let secondOpen!: Promise<void>;
    act(() => {
      secondOpen = harness!.getLatest().openPrefixProxyEditor(second);
    });

    await act(async () => {
      secondDownload.resolve(
        JSON.stringify({
          auth_index: 'auth-2',
          account_id: 'account-auth-2',
          prefix: 'current-prefix',
        })
      );
      await secondOpen;
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-2',
      prefix: 'current-prefix',
    });

    await act(async () => {
      firstDownload.resolve(
        JSON.stringify({
          auth_index: 'auth-1',
          account_id: 'account-auth-1',
          prefix: 'stale-prefix',
        })
      );
      await firstOpen;
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-2',
      prefix: 'current-prefix',
    });
  });

  it('does not let the first A response overwrite a newer A editor after A to B to A switching', async () => {
    const first = createAuthFile('auth-1');
    const second = createAuthFile('auth-2');
    const firstADownload = createDeferred<string>();
    const secondDownload = createDeferred<string>();
    const latestADownload = createDeferred<string>();
    mocks.downloadText
      .mockImplementationOnce(() => firstADownload.promise)
      .mockImplementationOnce(() => secondDownload.promise)
      .mockImplementationOnce(() => latestADownload.promise);
    harness = mountHarness();

    let firstAOpen!: Promise<void>;
    act(() => {
      firstAOpen = harness!.getLatest().openPrefixProxyEditor(first);
    });
    let secondOpen!: Promise<void>;
    act(() => {
      secondOpen = harness!.getLatest().openPrefixProxyEditor(second);
    });
    await act(async () => {
      secondDownload.resolve(
        JSON.stringify({
          auth_index: 'auth-2',
          account_id: 'account-auth-2',
          prefix: 'second-prefix',
        })
      );
      await secondOpen;
    });

    let latestAOpen!: Promise<void>;
    act(() => {
      latestAOpen = harness!.getLatest().openPrefixProxyEditor(first);
    });
    await act(async () => {
      latestADownload.resolve(
        JSON.stringify({
          auth_index: 'auth-1',
          account_id: 'account-auth-1',
          prefix: 'latest-a-prefix',
        })
      );
      await latestAOpen;
    });

    await act(async () => {
      firstADownload.resolve(
        JSON.stringify({
          auth_index: 'auth-1',
          account_id: 'account-auth-1',
          prefix: 'stale-a-prefix',
        })
      );
      await firstAOpen;
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-1',
      prefix: 'latest-a-prefix',
    });
  });

  it('does not let an older save completion close a reopened editor for the same credential', async () => {
    const first = createAuthFile('auth-1');
    const patchResult = createDeferred<void>();
    mocks.downloadText
      .mockResolvedValueOnce(
        JSON.stringify({
          auth_index: 'auth-1',
          account_id: 'account-auth-1',
          prefix: 'first-prefix',
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          auth_index: 'auth-1',
          account_id: 'account-auth-1',
          prefix: 'reopened-prefix',
        })
      );
    mocks.list.mockResolvedValue({ files: [first] });
    mocks.patchFieldsWithPluginSourceFallback.mockImplementation(() => patchResult.promise);
    harness = mountHarness();

    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(first);
    });
    act(() => {
      harness?.getLatest().handlePrefixProxyChange('prefix', 'updated-first-prefix');
    });

    let save!: Promise<void>;
    act(() => {
      save = harness!.getLatest().handlePrefixProxySave();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.patchFieldsWithPluginSourceFallback).toHaveBeenCalledTimes(1);

    act(() => {
      harness?.getLatest().closePrefixProxyEditor();
    });
    await act(async () => {
      await harness?.getLatest().openPrefixProxyEditor(first);
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-1',
      prefix: 'reopened-prefix',
    });

    await act(async () => {
      patchResult.resolve();
      await save;
    });
    expect(harness.getLatest().prefixProxyEditor).toMatchObject({
      credentialKey: 'shared.json::auth-1',
      prefix: 'reopened-prefix',
    });
  });
});
