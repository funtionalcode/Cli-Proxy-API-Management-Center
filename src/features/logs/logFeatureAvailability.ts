import type { Config } from '@/types';

export function isFileLogsAvailable(config?: Pick<Config, 'loggingToFile'> | null): boolean {
  return config?.loggingToFile === true;
}

export function isRequestLogsTab(search?: string | URLSearchParams | null): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const tab = params?.get('tab');
  return tab === 'errors' || tab === 'success';
}

export const isErrorLogsTab = isRequestLogsTab;

export function isLogsRouteAvailable(
  config: Pick<Config, 'loggingToFile'> | null | undefined,
  search?: string | URLSearchParams | null
): boolean {
  return isRequestLogsTab(search) || isFileLogsAvailable(config);
}
