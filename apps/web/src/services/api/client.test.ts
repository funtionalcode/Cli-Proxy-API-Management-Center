import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, axiosInstance } = vi.hoisted(() => {
  const requestUse = vi.fn();
  const responseUse = vi.fn();
  return {
    mocks: {
      requestUse,
      responseUse,
    },
    axiosInstance: {
      defaults: { timeout: 0 },
      interceptors: {
        request: { use: requestUse },
        response: { use: responseUse },
      },
    },
  };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => axiosInstance),
    isAxiosError: (error: unknown) =>
      Boolean(error && typeof error === 'object' && 'isAxiosError' in error),
  },
}));

import { apiClient, createScopedApiRequestConfig } from './client';

type RequestConfig = {
  baseURL?: string;
  url?: string;
  headers: Record<string, string>;
  cpampScopedRequest?: true;
};

const applyRequestInterceptor = (config: RequestConfig): RequestConfig => {
  const interceptor = mocks.requestUse.mock.calls[0]?.[0] as
    | ((request: RequestConfig) => RequestConfig)
    | undefined;
  if (!interceptor) throw new Error('request interceptor was not registered');
  return interceptor(config);
};

const applyResponseErrorInterceptor = async (error: unknown): Promise<void> => {
  const interceptor = mocks.responseUse.mock.calls[0]?.[1] as
    | ((reason: unknown) => Promise<never>)
    | undefined;
  if (!interceptor) throw new Error('response interceptor was not registered');
  await interceptor(error);
};

const applyResponseSuccessInterceptor = (response: unknown): unknown => {
  const interceptor = mocks.responseUse.mock.calls[0]?.[0] as
    | ((value: unknown) => unknown)
    | undefined;
  if (!interceptor) throw new Error('response interceptor was not registered');
  return interceptor(response);
};

describe('ApiClient request scoping', () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    dispatchEvent.mockReset();
    vi.stubGlobal('window', { dispatchEvent });
    apiClient.setConfig({
      apiBase: 'http://new-cpa.local:8317',
      managementKey: 'new-cpa-key',
    });
  });

  it('preserves an explicit old connection while regular requests use the current connection', () => {
    const scoped = createScopedApiRequestConfig({
      apiBase: 'http://old-cpa.local:8317',
      managementKey: 'old-cpa-key',
    }) as RequestConfig;
    scoped.url = '/oauth-model-alias';

    expect(applyRequestInterceptor(scoped)).toMatchObject({
      baseURL: 'http://old-cpa.local:8317/v0/management',
      headers: { Authorization: 'Bearer old-cpa-key' },
    });
    expect(applyRequestInterceptor({ url: '/oauth-model-alias', headers: {} })).toMatchObject({
      baseURL: 'http://new-cpa.local:8317/v0/management',
      headers: { Authorization: 'Bearer new-cpa-key' },
    });
  });

  it('does not let a stale scoped 401 log out the current connection', async () => {
    const staleConfig = applyRequestInterceptor({
      ...(createScopedApiRequestConfig({
        apiBase: 'http://old-cpa.local:8317',
        managementKey: 'old-cpa-key',
      }) as RequestConfig),
      url: '/oauth-model-alias',
    });
    const currentConfig = applyRequestInterceptor({
      url: '/oauth-model-alias',
      headers: {},
    });
    const createUnauthorizedError = (config: RequestConfig) => ({
      isAxiosError: true,
      message: 'unauthorized',
      config,
      response: { status: 401, data: { message: 'unauthorized' } },
    });

    await expect(
      applyResponseErrorInterceptor(createUnauthorizedError(staleConfig))
    ).rejects.toThrow('unauthorized');
    expect(dispatchEvent).not.toHaveBeenCalled();

    await expect(
      applyResponseErrorInterceptor(createUnauthorizedError(currentConfig))
    ).rejects.toThrow('unauthorized');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('does not publish server metadata from a stale scoped response', () => {
    const staleConfig = applyRequestInterceptor({
      ...(createScopedApiRequestConfig({
        apiBase: 'http://old-cpa.local:8317',
        managementKey: 'old-cpa-key',
      }) as RequestConfig),
      url: '/oauth-model-alias',
    });
    const currentConfig = applyRequestInterceptor({
      url: '/oauth-model-alias',
      headers: {},
    });
    const createResponse = (config: RequestConfig) => ({
      config,
      headers: {
        'x-cpa-version': 'v1.2.3',
        'x-cpa-support-plugin': 'true',
      },
    });

    applyResponseSuccessInterceptor(createResponse(staleConfig));
    expect(dispatchEvent).not.toHaveBeenCalled();

    applyResponseSuccessInterceptor(createResponse(currentConfig));
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });
});
