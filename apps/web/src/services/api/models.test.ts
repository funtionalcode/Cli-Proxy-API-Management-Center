import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    request: vi.fn(),
  },
}));

vi.mock('./apiCall', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apiCall')>();
  return {
    ...actual,
    apiCallApi: {
      request: mocks.request,
    },
  };
});

import { modelsApi } from './models';

const successfulResult = (body: unknown) => ({
  statusCode: 200,
  hasStatusCode: true,
  header: {},
  bodyText: JSON.stringify(body),
  body,
});

beforeEach(() => {
  mocks.request.mockReset();
});

describe('modelsApi request-level proxy', () => {
  it.each([
    ['v1', modelsApi.fetchV1ModelsViaApiCall, 'https://api.example.com/v1/models'],
    ['openai', modelsApi.fetchModelsViaApiCall, 'https://api.example.com/models'],
    ['claude', modelsApi.fetchClaudeModelsViaApiCall, 'https://api.example.com/v1/models'],
  ] as const)('passes the trimmed proxy to %s model discovery', async (_, fetchModels, url) => {
    mocks.request.mockResolvedValueOnce(successfulResult({ data: [{ id: 'model-1' }] }));

    await fetchModels(
      'https://api.example.com',
      'api-key',
      {},
      'auth-1',
      '  socks5://proxy.example:1080  '
    );

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        authIndex: 'auth-1',
        proxyUrl: 'socks5://proxy.example:1080',
        method: 'GET',
        url,
      })
    );
  });

  it('passes the proxy to every Gemini model page', async () => {
    mocks.request
      .mockResolvedValueOnce(
        successfulResult({ models: [{ name: 'models/gemini-1' }], nextPageToken: 'page-2' })
      )
      .mockResolvedValueOnce(successfulResult({ models: [{ name: 'models/gemini-2' }] }));

    await expect(
      modelsApi.fetchGeminiModelsViaApiCall(
        'https://generativelanguage.googleapis.com',
        'api-key',
        {},
        undefined,
        'https://proxy.example:8443'
      )
    ).resolves.toEqual([{ name: 'gemini-1' }, { name: 'gemini-2' }]);

    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ proxyUrl: 'https://proxy.example:8443' })
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        proxyUrl: 'https://proxy.example:8443',
        url: expect.stringContaining('pageToken=page-2'),
      })
    );
  });

  it.each([
    ['Claude', modelsApi.fetchClaudeModelsViaApiCall],
    ['Gemini', modelsApi.fetchGeminiModelsViaApiCall],
  ] as const)(
    'reuses in-flight %s requests only when the proxy matches',
    async (_, fetchModels) => {
      let resolveFirst: ((value: ReturnType<typeof successfulResult>) => void) | undefined;
      mocks.request
        .mockImplementationOnce(
          () =>
            new Promise<ReturnType<typeof successfulResult>>((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockResolvedValueOnce(successfulResult({ models: [{ name: 'model-b' }] }));

      const first = fetchModels(
        'https://api.example.com',
        'api-key',
        {},
        'auth-1',
        'socks5://proxy-a.example:1080'
      );
      const sameProxy = fetchModels(
        'https://api.example.com',
        'api-key',
        {},
        'auth-1',
        '  socks5://proxy-a.example:1080  '
      );
      const differentProxy = fetchModels(
        'https://api.example.com',
        'api-key',
        {},
        'auth-1',
        'socks5://proxy-b.example:1080'
      );

      expect(mocks.request).toHaveBeenCalledTimes(2);
      resolveFirst?.(successfulResult({ models: [{ name: 'model-a' }] }));

      await expect(Promise.all([first, sameProxy, differentProxy])).resolves.toHaveLength(3);
    }
  );
});
