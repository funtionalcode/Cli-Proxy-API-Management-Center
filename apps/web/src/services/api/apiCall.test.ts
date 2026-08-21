import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    post: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    post: mocks.post,
  },
}));

import { apiCallApi, getApiCallErrorDetails, type ApiCallResult } from './apiCall';

beforeEach(() => {
  mocks.post.mockReset();
  mocks.post.mockResolvedValue({ status_code: 200, body: {} });
});

describe('apiCallApi', () => {
  it('serializes the request-level proxy as proxy_url without leaking proxyUrl', async () => {
    await apiCallApi.request({
      authIndex: 'auth-1',
      proxyUrl: '  socks5h://proxy.example:1080  ',
      method: 'GET',
      url: 'https://api.example.com/v1/models',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      '/api-call',
      {
        authIndex: 'auth-1',
        proxy_url: 'socks5h://proxy.example:1080',
        method: 'GET',
        url: 'https://api.example.com/v1/models',
      },
      undefined
    );
    expect(mocks.post.mock.calls[0]?.[1]).not.toHaveProperty('proxyUrl');
  });

  it('omits an empty request-level proxy', async () => {
    await apiCallApi.request({
      proxyUrl: '   ',
      method: 'GET',
      url: 'https://api.example.com/v1/models',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      '/api-call',
      {
        method: 'GET',
        url: 'https://api.example.com/v1/models',
      },
      undefined
    );
  });
});

const buildResult = (overrides: Partial<ApiCallResult> = {}): ApiCallResult => ({
  statusCode: 401,
  hasStatusCode: true,
  header: {},
  bodyText: '',
  body: null,
  ...overrides,
});

describe('getApiCallErrorDetails', () => {
  it('keeps the complete structured response body', () => {
    const result = buildResult({
      bodyText: '{"error":{"code":16,"message":"Forbidden"}}',
      body: { error: { code: 16, message: 'Forbidden' } },
    });

    expect(getApiCallErrorDetails(result)).toBe(
      [
        '401 Forbidden',
        '',
        'Body:',
        '{',
        '  "error": {',
        '    "code": 16,',
        '    "message": "Forbidden"',
        '  }',
        '}',
      ].join('\n')
    );
  });

  it('preserves a plain-text response body', () => {
    const result = buildResult({ bodyText: 'upstream access denied', body: 'upstream access denied' });

    expect(getApiCallErrorDetails(result)).toBe(
      '401 upstream access denied\n\nBody:\nupstream access denied'
    );
  });

  it('returns the summary when the response body is empty', () => {
    expect(getApiCallErrorDetails(buildResult())).toBe('HTTP 401');
  });
});
