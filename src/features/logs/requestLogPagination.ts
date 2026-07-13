export const DEFAULT_REQUEST_LOG_PAGE_SIZE = 10;
export const REQUEST_LOG_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export const normalizeRequestLogPageSize = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && REQUEST_LOG_PAGE_SIZE_OPTIONS.some((size) => size === parsed)
    ? parsed
    : DEFAULT_REQUEST_LOG_PAGE_SIZE;
};
