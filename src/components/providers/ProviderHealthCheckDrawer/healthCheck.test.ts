import { describe, expect, it, vi } from 'vitest';
import { modelsApi } from '@/services/api';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { buildProviderRows } from '../ProviderTable/rowData';
import type { ProviderRecentUsageMap } from '../utils';
import {
  buildProviderHealthCheckItems,
  getProviderHealthCheckProviderKey,
  getProviderHealthCheckApplyActions,
  runProviderHealthCheckItem,
  summarizeProviderHealthCheckItems,
  type ProviderHealthCheckItem,
} from './healthCheck';

const emptyUsageByProvider = new Map() as ProviderRecentUsageMap;

describe('provider health check model', () => {
  it('expands key-based providers and OpenAI key entries into check items', () => {
    const codex: ProviderKeyConfig[] = [
      {
        apiKey: 'sk-codex-key-123456',
        baseUrl: 'https://codex.example.com/v1',
      },
    ];
    const openai: OpenAIProviderConfig[] = [
      {
        name: 'mixed',
        baseUrl: 'https://mixed.example.com/v1',
        apiKeyEntries: [{ apiKey: 'key-a' }, { apiKey: 'key-b', authIndex: 'auth-b' }],
      },
    ];

    const rows = buildProviderRows({
      gemini: [],
      codex,
      claude: [],
      vertex: [],
      openai,
      usageByProvider: emptyUsageByProvider,
    });
    const items = buildProviderHealthCheckItems(rows);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      providerKind: 'codex',
      providerIndex: 0,
    });
    expect(items[0]).not.toHaveProperty('openAIKeyIndex');
    expect(items[1]).toMatchObject({
      providerKind: 'openai',
      providerIndex: 0,
      openAIKeyIndex: 0,
      providerLabel: 'OpenAI · mixed',
      providerSubtitle: 'https://mixed.example.com/v1',
      targetLabel: 'Key #1',
    });
    expect(items[2]).toMatchObject({
      providerKind: 'openai',
      providerIndex: 0,
      openAIKeyIndex: 1,
      providerLabel: 'OpenAI · mixed',
      targetLabel: 'Key #2',
      detailLabel: 'auth-index: auth-b',
    });
  });

  it('summarizes progress from item statuses', () => {
    const items = [
      { status: 'success' },
      { status: 'error' },
      { status: 'running' },
      { status: 'pending' },
    ] as ProviderHealthCheckItem[];

    expect(summarizeProviderHealthCheckItems(items)).toEqual({
      total: 4,
      pending: 1,
      running: 1,
      success: 1,
      error: 1,
      completed: 2,
      percent: 50,
    });
  });

  it('enables OpenAI providers when any key succeeds and disables when all keys fail', () => {
    const items = [
      { providerKey: 'openai:a', status: 'error' },
      { providerKey: 'openai:a', status: 'success' },
      { providerKey: 'openai:b', status: 'error' },
      { providerKey: 'openai:b', status: 'error' },
      { providerKey: 'codex:c', status: 'pending' },
    ] as ProviderHealthCheckItem[];

    const actions = getProviderHealthCheckApplyActions(items);

    expect(actions.get('openai:a')).toBe('enable');
    expect(actions.get('openai:b')).toBe('disable');
    expect(actions.has('codex:c')).toBe(false);
  });

  it('keeps health-check items and actions bound to the same provider after list reorder', async () => {
    const target: ProviderKeyConfig = {
      apiKey: 'sk-target-key',
      baseUrl: 'https://target.example.com/v1',
      proxyUrl: 'https://target-proxy.example.com',
    };
    const other: ProviderKeyConfig = {
      apiKey: 'sk-other-key',
      baseUrl: 'https://other.example.com/v1',
      proxyUrl: 'https://other-proxy.example.com',
    };
    const buildRows = (codex: ProviderKeyConfig[]) =>
      buildProviderRows({
        gemini: [],
        codex,
        claude: [],
        vertex: [],
        openai: [],
        usageByProvider: emptyUsageByProvider,
      });
    const initialRows = buildRows([target, other]);
    const item = buildProviderHealthCheckItems(initialRows)[0];
    const reorderedRows = buildRows([other, target]);
    const targetRow = reorderedRows.find((row) => row.raw.apiKey === target.apiKey);
    const fetchModels = vi
      .spyOn(modelsApi, 'fetchV1ModelsViaApiCall')
      .mockResolvedValue([{ name: 'target-model' }]);

    try {
      const result = await runProviderHealthCheckItem(reorderedRows, item);
      const actions = getProviderHealthCheckApplyActions([result]);

      expect(result.status).toBe('success');
      expect(fetchModels).toHaveBeenCalledWith(
        target.baseUrl,
        target.apiKey,
        target.headers ?? {},
        undefined
      );
      expect(targetRow).toBeDefined();
      expect(Array.from(actions.keys())).toEqual([getProviderHealthCheckProviderKey(targetRow!)]);
      expect(actions.get(getProviderHealthCheckProviderKey(targetRow!))).toBe('enable');
    } finally {
      fetchModels.mockRestore();
    }
  });
});
