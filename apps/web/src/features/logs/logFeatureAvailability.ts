import type { Config } from '@/types';

export function isFileLogsAvailable(config?: Pick<Config, 'loggingToFile'> | null): boolean {
  return config?.loggingToFile === true;
}

export function isErrorLogsTab(search?: string | URLSearchParams | null): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params?.get('tab') === 'errors';
}

export function isLogsRouteAvailable(
  config: Pick<Config, 'loggingToFile'> | null | undefined,
  search?: string | URLSearchParams | null
): boolean {
  return isErrorLogsTab(search) || isFileLogsAvailable(config);
}
