import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    fetchModelsViaApiCall: vi.fn(),
    fetchV1ModelsViaApiCall: vi.fn(),
    fetchClaudeModelsViaApiCall: vi.fn(),
    fetchGeminiModelsViaApiCall: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  modelsApi: mocks,
}));

import { buildProviderRows } from '../ProviderTable/rowData';
import type { ProviderRecentUsageMap } from '../utils';
import {
  buildProviderHealthCheckItems,
  getProviderHealthCheckApplyActions,
  runProviderHealthCheckItem,
  summarizeProviderHealthCheckItems,
  type ProviderHealthCheckItem,
} from './healthCheck';

const emptyUsageByProvider = new Map() as ProviderRecentUsageMap;

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

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

  it('builds xAI API key health-check items with xAI identity', () => {
    const rows = buildProviderRows({
      gemini: [],
      codex: [],
      xai: [{ apiKey: 'xai-key', baseUrl: 'https://api.x.ai/v1' }],
      claude: [],
      vertex: [],
      openai: [],
      usageByProvider: emptyUsageByProvider,
    });

    expect(buildProviderHealthCheckItems(rows)).toEqual([
      expect.objectContaining({
        providerKind: 'xai',
        providerLabel: expect.stringContaining('xAI'),
        providerSubtitle: 'https://api.x.ai/v1',
      }),
    ]);
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

  it('passes a key-provider proxy to the health-check model request', async () => {
    mocks.fetchV1ModelsViaApiCall.mockResolvedValueOnce([{ name: 'gpt-5' }]);
    const rows = buildProviderRows({
      gemini: [],
      codex: [
        {
          apiKey: 'codex-key',
          baseUrl: 'https://codex.example.com/v1',
          proxyUrl: 'socks5://provider-proxy.example:1080',
        },
      ],
      claude: [],
      vertex: [],
      openai: [],
      usageByProvider: emptyUsageByProvider,
    });
    const [item] = buildProviderHealthCheckItems(rows);

    await expect(runProviderHealthCheckItem(rows, item)).resolves.toMatchObject({
      status: 'success',
      modelCount: 1,
    });

    expect(mocks.fetchV1ModelsViaApiCall).toHaveBeenCalledWith(
      'https://codex.example.com/v1',
      'codex-key',
      {},
      undefined,
      'socks5://provider-proxy.example:1080'
    );
  });

  it('uses the selected OpenAI key entry proxy for health checks', async () => {
    mocks.fetchModelsViaApiCall.mockResolvedValueOnce([{ name: 'gpt-4.1' }]);
    const rows = buildProviderRows({
      gemini: [],
      codex: [],
      claude: [],
      vertex: [],
      openai: [
        {
          name: 'proxied',
          baseUrl: 'https://openai.example.com/v1',
          apiKeyEntries: [
            { apiKey: 'key-a', proxyUrl: 'http://first-proxy.example:8080' },
            { apiKey: 'key-b', proxyUrl: 'http://second-proxy.example:8080' },
          ],
        },
      ],
      usageByProvider: emptyUsageByProvider,
    });
    const items = buildProviderHealthCheckItems(rows);

    await expect(runProviderHealthCheckItem(rows, items[1])).resolves.toMatchObject({
      status: 'success',
      modelCount: 1,
    });

    expect(mocks.fetchModelsViaApiCall).toHaveBeenCalledWith(
      'https://openai.example.com/v1',
      'key-b',
      {},
      undefined,
      'http://second-proxy.example:8080'
    );
  });
});
