import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    delete: vi.fn(),
    getRaw: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    delete: mocks.delete,
    getRaw: mocks.getRaw,
  },
}));

import { logsApi, normalizeLogsResponse } from './logs';

beforeEach(() => {
  mocks.get.mockReset();
  mocks.delete.mockReset();
  mocks.getRaw.mockReset();
});

describe('logs API', () => {
  it('normalizes legacy timestamp-based log responses', () => {
    expect(
      normalizeLogsResponse({
        lines: ['a', 'b'],
        'line-count': 2,
        'latest-timestamp': 123,
      })
    ).toEqual({
      lines: ['a', 'b'],
      'line-count': 2,
      'latest-timestamp': 123,
      latestAfter: 123,
      nextCursor: undefined,
      cursorReset: false,
    });
  });

  it('normalizes cursor-based log responses', () => {
    expect(
      normalizeLogsResponse({
        lines: ['next'],
        lineCount: '1',
        latestAfter: '456',
        'next-cursor': 'cursor-2',
        'cursor-reset': 'true',
      })
    ).toEqual({
      lines: ['next'],
      'line-count': 1,
      'latest-timestamp': 0,
      latestAfter: 456,
      nextCursor: 'cursor-2',
      cursorReset: true,
    });
  });

  it('passes cursor, after, and limit query params when fetching logs', async () => {
    mocks.get.mockResolvedValue({ lines: [] });

    await logsApi.fetchLogs({ cursor: 'cursor-1', after: 123, limit: 100 });

    expect(mocks.get).toHaveBeenCalledWith('/logs', {
      params: { cursor: 'cursor-1', after: 123, limit: 100 },
      timeout: expect.any(Number),
    });
  });

  it('treats a missing success log list endpoint as an empty list', async () => {
    mocks.get.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), { status: 404 })
    );

    await expect(logsApi.fetchSuccessLogs({ page: 2, pageSize: 50 })).resolves.toEqual({
      files: [],
    });

    expect(mocks.get).toHaveBeenCalledWith('/request-success-logs', {
      params: { page: 2, page_size: 50 },
      timeout: expect.any(Number),
    });
  });

  it('passes model, request id, and time filters when fetching request logs', async () => {
    mocks.get.mockResolvedValue({ files: [] });

    await logsApi.fetchErrorLogs({
      page: 1,
      pageSize: 20,
      model: ' gpt-5 ',
      requestId: ' 202607311301428373439638268d9d6tX6BBjia ',
      from: 1700000000,
      to: 1700003600,
    });

    expect(mocks.get).toHaveBeenCalledWith('/request-error-logs', {
      params: {
        page: 1,
        page_size: 20,
        model: 'gpt-5',
        request_id: '202607311301428373439638268d9d6tX6BBjia',
        from: 1700000000,
        to: 1700003600,
      },
      timeout: expect.any(Number),
    });
  });

  it('keeps non-404 success log list errors visible', async () => {
    const serverError = Object.assign(new Error('server unavailable'), { status: 500 });
    mocks.get.mockRejectedValue(serverError);

    await expect(logsApi.fetchSuccessLogs()).rejects.toBe(serverError);
  });
});
