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
      options.onSuccess?.();
      return true;
    } catch (error: unknown) {
      options.apply(previous);
      options.onError?.(error);
      return false;
    }
  });
