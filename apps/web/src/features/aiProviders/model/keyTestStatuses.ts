export type ApiKeyTestStatus = {
  status: string;
  message: string;
};

const buildIdleStatus = <T extends ApiKeyTestStatus>(): T => ({ status: 'idle', message: '' }) as T;

const normalizeStatusList = <T extends ApiKeyTestStatus>(
  statuses: readonly T[],
  count: number
): T[] =>
  Array.from({ length: Math.max(0, count) }, (_, index) => statuses[index] ?? buildIdleStatus<T>());

export const removeKeyTestStatusAtIndex = <T extends ApiKeyTestStatus>(
  statuses: readonly T[],
  removedIndex: number,
  sourceCount: number
): T[] => {
  const normalized = normalizeStatusList(statuses, sourceCount);
  const next = normalized.filter((_, index) => index !== removedIndex);
  return next.length ? next : [buildIdleStatus<T>()];
};

export const appendIdleKeyTestStatus = <T extends ApiKeyTestStatus>(
  statuses: readonly T[],
  sourceCount: number
): T[] => [...normalizeStatusList(statuses, sourceCount), buildIdleStatus<T>()];
