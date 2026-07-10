export interface ProviderWriteQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export interface LatestProviderListWriteOptions<T> {
  getCurrent: () => T;
  apply: (next: T) => void;
  buildNext: (current: T) => T | null;
  save: (next: T) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export interface LatestProviderListEntryWriteOptions<T> {
  getCurrent: () => T[];
  apply: (next: T[]) => void;
  locate: (current: T[]) => number;
  buildNext: (current: T[], index: number) => T[] | null;
  save: (next: T[], index: number) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export interface LatestProviderListUpsertOptions<T> {
  getCurrent: () => T[];
  apply: (next: T[]) => void;
  locate?: (current: T[]) => number;
  value: T;
  save: (next: T[], index?: number) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export const createProviderWriteQueue = (
  onPendingChange?: (pending: number) => void
): ProviderWriteQueue => {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    enqueue<T>(task: () => Promise<T>) {
      pending += 1;
      onPendingChange?.(pending);

      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      void result.then(
        () => {
          pending -= 1;
          onPendingChange?.(pending);
        },
        () => {
          pending -= 1;
          onPendingChange?.(pending);
        }
      );

      return result;
    },
  };
};

export const enqueueLatestProviderListWrite = <T>(
  queue: ProviderWriteQueue,
  options: LatestProviderListWriteOptions<T>
): Promise<boolean> =>
  queue.enqueue(async () => {
    const previous = options.getCurrent();
    const next = options.buildNext(previous);
    if (next === null) return false;

    options.apply(next);
    try {
      await options.save(next);
    } catch (error: unknown) {
      options.apply(previous);
      options.onError?.(error);
      return false;
    }

    options.onSuccess?.();
    return true;
  });

export const enqueueLatestProviderListEntryWrite = <T>(
  queue: ProviderWriteQueue,
  options: LatestProviderListEntryWriteOptions<T>
): Promise<boolean> =>
  queue.enqueue(async () => {
    const previous = options.getCurrent();
    const index = options.locate(previous);
    if (index < 0) return false;

    const next = options.buildNext(previous, index);
    if (next === null) return false;

    options.apply(next);
    try {
      await options.save(next, index);
    } catch (error: unknown) {
      options.apply(previous);
      options.onError?.(error);
      return false;
    }

    options.onSuccess?.();
    return true;
  });

export const enqueueLatestProviderListUpsert = <T>(
  queue: ProviderWriteQueue,
  options: LatestProviderListUpsertOptions<T>
): Promise<boolean> => {
  if (options.locate) {
    return enqueueLatestProviderListEntryWrite(queue, {
      getCurrent: options.getCurrent,
      apply: options.apply,
      locate: options.locate,
      buildNext: (current, index) =>
        current.map((item, itemIndex) => (itemIndex === index ? options.value : item)),
      save: options.save,
      onSuccess: options.onSuccess,
      onError: options.onError,
    });
  }

  return enqueueLatestProviderListWrite(queue, {
    getCurrent: options.getCurrent,
    apply: options.apply,
    buildNext: (current) => [...current, options.value],
    save: options.save,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
};
