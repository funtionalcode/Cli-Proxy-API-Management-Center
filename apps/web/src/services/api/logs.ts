/**
 * 日志相关 API
 */

import { apiClient } from './client';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';

export interface LogsQuery {
  after?: number;
  cursor?: string;
  limit?: number;
}

export interface LogsResponse {
  lines: string[];
  'line-count': number;
  'latest-timestamp': number;
  latestAfter?: number;
  nextCursor?: string;
  cursorReset?: boolean;
}

export interface ErrorLogFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface RequestLogFilesQuery {
  page?: number;
  pageSize?: number;
}

export interface SuccessLogFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface RequestLogFilesResponse {
  files: Array<ErrorLogFile | SuccessLogFile>;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

export type ErrorLogsResponse = RequestLogFilesResponse;
export type SuccessLogsResponse = RequestLogFilesResponse;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const stringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const booleanValue = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const normalizeRequestLogFile = (value: unknown): ErrorLogFile => {
  const source = asRecord(value);
  const file: ErrorLogFile = { name: String(source.name ?? '') };
  const size = numberValue(source.size);
  const modified = numberValue(source.modified);
  if (size !== undefined) file.size = size;
  if (modified !== undefined) file.modified = modified;
  return file;
};

export const normalizeRequestLogFilesResponse = (value: unknown): RequestLogFilesResponse => {
  const source = asRecord(value);
  const files = Array.isArray(source.files)
    ? source.files.map(normalizeRequestLogFile).filter((file) => file.name.length > 0)
    : [];
  const page = numberValue(source.page);
  const pageSize = numberValue(source.pageSize ?? source.page_size);
  const total = numberValue(source.total);
  const totalPages = numberValue(source.totalPages ?? source.total_pages);
  const response: RequestLogFilesResponse = { files };
  if (page !== undefined) response.page = page;
  if (pageSize !== undefined) response.pageSize = pageSize;
  if (total !== undefined) response.total = total;
  if (totalPages !== undefined) response.totalPages = totalPages;
  return response;
};

const requestLogParams = (query: RequestLogFilesQuery = {}) => {
  const params: Record<string, number> = {};
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.page_size = query.pageSize;
  return params;
};

const hasHttpStatus = (error: unknown, status: number): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  (error as { status?: unknown }).status === status;

export const normalizeLogsResponse = (value: unknown): LogsResponse => {
  const source = asRecord(value);
  const lines = Array.isArray(source.lines) ? source.lines.map((line) => String(line ?? '')) : [];
  const lineCount = numberValue(source['line-count'] ?? source.lineCount) ?? lines.length;
  const latestTimestamp = numberValue(source['latest-timestamp'] ?? source.latestTimestamp) ?? 0;
  const rawLatestAfter =
    numberValue(source.latestAfter ?? source.latest_after ?? source['latest-after']) ??
    latestTimestamp;
  const latestAfter = rawLatestAfter > 0 ? rawLatestAfter : undefined;
  const nextCursor = stringValue(source['next-cursor'] ?? source.nextCursor ?? source.next_cursor);

  return {
    lines,
    'line-count': lineCount,
    'latest-timestamp': latestTimestamp,
    latestAfter,
    nextCursor,
    cursorReset: booleanValue(source['cursor-reset'] ?? source.cursorReset ?? source.cursor_reset),
  };
};

export const logsApi = {
  async fetchLogs(params: LogsQuery = {}): Promise<LogsResponse> {
    const data = await apiClient.get('/logs', { params, timeout: LOGS_TIMEOUT_MS });
    return normalizeLogsResponse(data);
  },

  clearLogs: () => apiClient.delete('/logs'),

  fetchErrorLogs: async (query: RequestLogFilesQuery = {}): Promise<ErrorLogsResponse> => {
    const params = requestLogParams(query);
    const data = await apiClient.get('/request-error-logs', {
      ...(Object.keys(params).length > 0 ? { params } : {}),
      timeout: LOGS_TIMEOUT_MS,
    });
    return normalizeRequestLogFilesResponse(data);
  },

  downloadErrorLog: (filename: string) =>
    apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),

  downloadFormattedErrorLog: (filename: string) =>
    apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}/formatted`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),

  fetchSuccessLogs: async (query: RequestLogFilesQuery = {}): Promise<SuccessLogsResponse> => {
    const params = requestLogParams(query);
    try {
      const data = await apiClient.get('/request-success-logs', {
        ...(Object.keys(params).length > 0 ? { params } : {}),
        timeout: LOGS_TIMEOUT_MS,
      });
      return normalizeRequestLogFilesResponse(data);
    } catch (error: unknown) {
      if (hasHttpStatus(error, 404)) {
        return { files: [] };
      }
      throw error;
    }
  },

  downloadSuccessLog: (filename: string) =>
    apiClient.getRaw(`/request-success-logs/${encodeURIComponent(filename)}`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),

  downloadFormattedSuccessLog: (filename: string) =>
    apiClient.getRaw(`/request-success-logs/${encodeURIComponent(filename)}/formatted`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),

  downloadRequestLogById: (id: string) =>
    apiClient.getRaw(`/request-log-by-id/${encodeURIComponent(id)}`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),
};
