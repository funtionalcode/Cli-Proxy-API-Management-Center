export interface ProviderCredentialTask<T> {
  item: T;
  originalIndex: number;
  providerKey: string;
  credentialKey: string;
}

export interface ProviderCredentialTaskSelectors<T> {
  getProviderKey: (item: T) => string;
  getCredentialKey: (item: T) => string;
}

export interface ProviderCredentialSchedulerOptions {
  perProviderConcurrency: number;
  maxConcurrentProviders?: number;
}

export interface KeyedSerialTaskQueue {
  isPending: (key: string) => boolean;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}

const normalizeTaskKey = (value: string): string => value.trim().toLowerCase();

export function buildProviderCredentialTaskPlan<T>(
  items: readonly T[],
  selectors: ProviderCredentialTaskSelectors<T>
): ProviderCredentialTask<T>[] {
  const seen = new Set<string>();
  const tasks: ProviderCredentialTask<T>[] = [];

  items.forEach((item, originalIndex) => {
    const providerKey = normalizeTaskKey(selectors.getProviderKey(item)) || 'unknown';
    const rawCredentialKey = selectors.getCredentialKey(item).trim();
    const credentialKey = rawCredentialKey || `unscoped:${originalIndex}`;
    const dedupeKey = `${providerKey}\u0000${credentialKey}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    tasks.push({ item, originalIndex, providerKey, credentialKey });
  });

  return tasks;
}

async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

/**
 * Runs each provider queue independently. Requests for one provider stay
 * bounded, while different providers can make progress in parallel.
 */
export async function runProviderCredentialTaskPlan<T, TResult>(
  tasks: readonly ProviderCredentialTask<T>[],
  options: ProviderCredentialSchedulerOptions,
  worker: (task: ProviderCredentialTask<T>) => Promise<TResult>
): Promise<TResult[]> {
  if (tasks.length === 0) return [];

  const tasksByProvider = new Map<string, ProviderCredentialTask<T>[]>();
  tasks.forEach((task) => {
    const providerTasks = tasksByProvider.get(task.providerKey) ?? [];
    providerTasks.push(task);
    tasksByProvider.set(task.providerKey, providerTasks);
  });

  const resultsByIndex = new Map<number, TResult>();
  const providerGroups = Array.from(tasksByProvider.values());
  await mapWithConcurrency(
    providerGroups,
    options.maxConcurrentProviders ?? providerGroups.length,
    async (providerTasks) => {
      const providerResults = await mapWithConcurrency(
        providerTasks,
        options.perProviderConcurrency,
        worker
      );
      providerTasks.forEach((task, index) => {
        resultsByIndex.set(task.originalIndex, providerResults[index]);
      });
    }
  );

  return [...tasks]
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((task) => resultsByIndex.get(task.originalIndex) as TResult);
}

/**
 * Serializes independently-triggered batches and coalesces repeated work with
 * the same key. This keeps separate UI actions from bypassing the concurrency
 * limits enforced inside each provider task plan.
 */
export function createKeyedSerialTaskQueue(): KeyedSerialTaskQueue {
  let tail: Promise<void> = Promise.resolve();
  const pendingByKey = new Map<string, Promise<void>>();

  return {
    isPending: (key) => pendingByKey.has(key),
    run: (key, task) => {
      const pending = pendingByKey.get(key);
      if (pending) return pending;

      const result = tail.then(task, task);
      const tracked = result.finally(() => {
        if (pendingByKey.get(key) === tracked) {
          pendingByKey.delete(key);
        }
      });
      pendingByKey.set(key, tracked);
      tail = tracked.catch(() => {});
      return tracked;
    },
  };
}
