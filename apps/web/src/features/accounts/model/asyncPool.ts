/**
 * Runs independent tasks with a bounded amount of concurrency while preserving
 * result order. This is used for explicit bulk credential quota refreshes so a
 * single user action cannot fan out to every upstream provider at once.
 */
export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  map: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return [];

  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
