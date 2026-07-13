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

import { logsApi, normalizeLogsResponse, normalizeRequestLogFilesResponse } from './logs';

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

  it('loads and downloads success request logs', async () => {
    mocks.get.mockResolvedValue({ files: [{ name: 'success.log' }] });
    mocks.getRaw.mockResolvedValue({ data: 'ok' });

    await expect(logsApi.fetchSuccessLogs()).resolves.toEqual({
      files: [{ name: 'success.log' }],
    });
    await logsApi.downloadSuccessLog('success.log');

    expect(mocks.get).toHaveBeenCalledWith('/request-success-logs', {
      timeout: expect.any(Number),
    });
    expect(mocks.getRaw).toHaveBeenCalledWith('/request-success-logs/success.log', {
      responseType: 'blob',
      timeout: expect.any(Number),
    });
  });

  it('normalizes paginated request log file responses', () => {
    expect(
      normalizeRequestLogFilesResponse({
        files: [{ name: 'error.log', size: '42', modified: '123' }],
        page: '2',
        page_size: '20',
        total: '41',
        total_pages: '3',
      })
    ).toEqual({
      files: [{ name: 'error.log', size: 42, modified: 123 }],
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
  });

  it('passes page and page size query params for request logs', async () => {
    mocks.get.mockResolvedValue({ files: [] });

    await logsApi.fetchErrorLogs({ page: 2, pageSize: 20 });

    expect(mocks.get).toHaveBeenCalledWith('/request-error-logs', {
      params: { page: 2, page_size: 20 },
      timeout: expect.any(Number),
    });
  });

  it('downloads formatted error and success request logs', async () => {
    mocks.getRaw.mockResolvedValue({ data: 'formatted' });

    await logsApi.downloadFormattedErrorLog('error 1.log');
    await logsApi.downloadFormattedSuccessLog('success 1.log');

    expect(mocks.getRaw).toHaveBeenNthCalledWith(1, '/request-error-logs/error%201.log/formatted', {
      responseType: 'blob',
      timeout: expect.any(Number),
    });
    expect(mocks.getRaw).toHaveBeenNthCalledWith(
      2,
      '/request-success-logs/success%201.log/formatted',
      {
        responseType: 'blob',
        timeout: expect.any(Number),
      }
    );
  });
});
