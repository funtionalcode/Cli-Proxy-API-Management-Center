import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import { authFilesApi } from '@/services/api/authFiles';
import {
  CODEX_INSPECTION_SETTINGS_STORAGE_KEY,
  executeCodexInspectionActions,
  loadCodexInspectionConfigurableSettings,
  resolveCodexInspectionAutoActionItems,
  type CodexInspectionAction,
  type CodexInspectionResultItem,
  type CodexInspectionRunResult,
} from './codexInspection';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  } as unknown as Storage;
};

const createResultItem = (
  action: CodexInspectionAction,
  overrides: Partial<CodexInspectionResultItem> = {}
): CodexInspectionResultItem => ({
  key: overrides.key ?? `${action}.json::1`,
  fileName: overrides.fileName ?? `${action}.json`,
  displayAccount: overrides.displayAccount ?? `${action}@example.com`,
  authIndex: overrides.authIndex ?? '1',
  accountId: overrides.accountId ?? 'account-1',
  provider: overrides.provider ?? 'codex',
  disabled: overrides.disabled ?? false,
  status: overrides.status ?? '',
  state: overrides.state ?? '',
  raw:
    overrides.raw ??
    ({
      name: `${action}.json`,
      type: 'codex',
      access_token: 'raw-secret-token',
    } as AuthFileItem),
  action,
  actionReason: overrides.actionReason ?? 'reason',
  statusCode: overrides.statusCode ?? (action === 'delete' ? 401 : 200),
  usedPercent: overrides.usedPercent ?? null,
  isQuota: overrides.isQuota ?? false,
  error: overrides.error ?? '',
});

const createRunResult = (): CodexInspectionRunResult => {
  const results = [createResultItem('delete')];
  return {
    settings: {
      baseUrl: 'https://secret.example.test',
      token: 'management-secret-token',
      targetType: 'codex',
      workers: 2,
      deleteWorkers: 1,
      timeout: 1000,
      retries: 0,
      userAgent: 'test-agent',
      usedPercentThreshold: 90,
      sampleSize: 0,
    },
    files: [
      {
        name: 'delete.json',
        type: 'codex',
        access_token: 'file-secret-token',
      } as AuthFileItem,
    ],
    results,
    summary: {
      totalFiles: 1,
      probeSetCount: 1,
      sampledCount: 1,
      disabledCount: 0,
      enabledCount: 1,
      deleteCount: 1,
      disableCount: 0,
      enableCount: 0,
      keepCount: 0,
      usedPercentThreshold: 90,
      sampled: false,
      plannedActionPreview: ['delete@example.com -> delete'],
    },
    startedAt: 1000,
    finishedAt: 2000,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Codex inspection settings', () => {
  it('migrates legacy auto execute settings to auto disable', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY, JSON.stringify({ autoExecuteActions: true }));

    expect(loadCodexInspectionConfigurableSettings(null).autoActionMode).toBe('disable');
  });
});

describe('resolveCodexInspectionAutoActionItems', () => {
  const deleteItem = createResultItem('delete');
  const disableItem = createResultItem('disable');
  const enableItem = createResultItem('enable');

  it('does nothing when automatic mode is none', () => {
    expect(resolveCodexInspectionAutoActionItems('none', [deleteItem, disableItem, enableItem])).toEqual([]);
  });

  it('turns delete suggestions into disable actions in auto disable mode', () => {
    const items = resolveCodexInspectionAutoActionItems('disable', [
      deleteItem,
      disableItem,
      enableItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([
      ['delete.json', 'disable'],
      ['disable.json', 'disable'],
    ]);
  });

  it('keeps delete and disable suggestions in auto delete mode', () => {
    const items = resolveCodexInspectionAutoActionItems('delete', [
      deleteItem,
      disableItem,
      enableItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([
      ['delete.json', 'delete'],
      ['disable.json', 'disable'],
    ]);
  });
});

describe('executeCodexInspectionActions', () => {
  it('uses action concurrency for disable and enable operations', async () => {
    let activeStatusUpdates = 0;
    let maxStatusUpdates = 0;

    vi.spyOn(authFilesApi, 'setStatusWithFallback').mockImplementation(async () => {
      activeStatusUpdates += 1;
      maxStatusUpdates = Math.max(maxStatusUpdates, activeStatusUpdates);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      activeStatusUpdates -= 1;
      return {} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>;
    });
    vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: {
        ...createRunResult().settings,
        workers: 10,
        deleteWorkers: 1,
      },
      items: [
        createResultItem('disable', { fileName: 'disable-a.json' }),
        createResultItem('disable', { fileName: 'disable-b.json' }),
        createResultItem('enable', { fileName: 'enable-a.json' }),
      ],
      previousFiles: [],
    });

    expect(execution.outcomes).toHaveLength(3);
    expect(maxStatusUpdates).toBe(1);
  });
});
