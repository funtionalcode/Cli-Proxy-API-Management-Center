import { describe, expect, it } from 'vitest';
import {
  createProviderWriteQueue,
  enqueueLatestProviderListEntryWrite,
  enqueueLatestProviderListWrite,
} from './providerWriteQueue';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('createProviderWriteQueue', () => {
  it('runs tasks in strict FIFO order', async () => {
    const firstGate = createDeferred<void>();
    const events: string[] = [];
    const queue = createProviderWriteQueue();

    const first = queue.enqueue(async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first-result';
    });
    const second = queue.enqueue(async () => {
      events.push('second:start');
      return 'second-result';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    firstGate.resolve();

    await expect(first).resolves.toBe('first-result');
    await expect(second).resolves.toBe('second-result');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('continues with the next task after a rejection', async () => {
    const events: string[] = [];
    const queue = createProviderWriteQueue();
    const failure = new Error('save failed');

    const first = queue.enqueue(async () => {
      events.push('first');
      throw failure;
    });
    const second = queue.enqueue(async () => {
      events.push('second');
      return 2;
    });

    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(['first', 'second']);
  });

  it('reports pending count on enqueue and settle', async () => {
    const firstGate = createDeferred<void>();
    const secondGate = createDeferred<void>();
    const pendingCounts: number[] = [];
    const queue = createProviderWriteQueue((pending) => pendingCounts.push(pending));

    const first = queue.enqueue(() => firstGate.promise);
    const second = queue.enqueue(() => secondGate.promise);

    expect(pendingCounts).toEqual([1, 2]);

    firstGate.resolve();
    await first;
    await Promise.resolve();
    expect(pendingCounts).toEqual([1, 2, 1]);

    secondGate.resolve();
    await second;
    await Promise.resolve();
    expect(pendingCounts).toEqual([1, 2, 1, 0]);
  });
});

describe('enqueueLatestProviderListWrite', () => {
  it('builds each queued write from the latest applied list', async () => {
    const firstGate = createDeferred<void>();
    const queue = createProviderWriteQueue();
    let current = [{ priority: 1, enabled: true }];
    const saved: Array<typeof current> = [];

    const priorityWrite = enqueueLatestProviderListWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
      },
      buildNext: (list) => list.map((item) => ({ ...item, priority: 9 })),
      save: async (next) => {
        saved.push(next);
        await firstGate.promise;
      },
    });
    const toggleWrite = enqueueLatestProviderListWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
      },
      buildNext: (list) => list.map((item) => ({ ...item, enabled: false })),
      save: async (next) => {
        saved.push(next);
      },
    });

    await Promise.resolve();
    expect(saved).toEqual([[{ priority: 9, enabled: true }]]);

    firstGate.resolve();

    await expect(Promise.all([priorityWrite, toggleWrite])).resolves.toEqual([true, true]);
    expect(saved[1]).toEqual([{ priority: 9, enabled: false }]);
    expect(current).toEqual([{ priority: 9, enabled: false }]);
  });

  it('rolls back a failed write before the next task reads current state', async () => {
    const firstGate = createDeferred<void>();
    const queue = createProviderWriteQueue();
    const failure = new Error('save failed');
    let current = [{ priority: 1, enabled: true }];
    const saved: Array<typeof current> = [];
    const errors: unknown[] = [];

    const priorityWrite = enqueueLatestProviderListWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
      },
      buildNext: (list) => list.map((item) => ({ ...item, priority: 9 })),
      save: async (next) => {
        saved.push(next);
        await firstGate.promise;
        throw failure;
      },
      onError: (error) => errors.push(error),
    });
    const toggleWrite = enqueueLatestProviderListWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
      },
      buildNext: (list) => list.map((item) => ({ ...item, enabled: false })),
      save: async (next) => {
        saved.push(next);
      },
    });

    firstGate.resolve();

    await expect(Promise.all([priorityWrite, toggleWrite])).resolves.toEqual([false, true]);
    expect(errors).toEqual([failure]);
    expect(saved[1]).toEqual([{ priority: 1, enabled: false }]);
    expect(current).toEqual([{ priority: 1, enabled: false }]);
  });

  it('does not apply or save when the builder returns null', async () => {
    const queue = createProviderWriteQueue();
    const current = [{ priority: 1 }];
    let applyCount = 0;
    let saveCount = 0;

    const result = await enqueueLatestProviderListWrite(queue, {
      getCurrent: () => current,
      apply: () => {
        applyCount += 1;
      },
      buildNext: () => null,
      save: async () => {
        saveCount += 1;
      },
    });

    expect(result).toBe(false);
    expect(applyCount).toBe(0);
    expect(saveCount).toBe(0);
  });

  it('does not roll back a saved list when onSuccess throws', async () => {
    const queue = createProviderWriteQueue();
    const notificationFailure = new Error('notification failed');
    let current = [{ priority: 1 }];
    const applied: Array<typeof current> = [];

    const result = enqueueLatestProviderListWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
        applied.push(next);
      },
      buildNext: (list) => list.map((item) => ({ ...item, priority: 9 })),
      save: async () => {},
      onSuccess: () => {
        throw notificationFailure;
      },
    });

    await expect(result).rejects.toBe(notificationFailure);
    expect(current).toEqual([{ priority: 9 }]);
    expect(applied).toEqual([[{ priority: 9 }]]);
  });
});

describe('enqueueLatestProviderListEntryWrite', () => {
  it('relocates the captured entry after the list is reordered while waiting', async () => {
    const firstGate = createDeferred<void>();
    const queue = createProviderWriteQueue();
    let current = [
      { id: 'alpha', priority: 1 },
      { id: 'beta', priority: 2 },
    ];
    const saved: Array<typeof current> = [];

    const blocker = queue.enqueue(() => firstGate.promise);
    const write = enqueueLatestProviderListEntryWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
      },
      locate: (list) => list.findIndex((item) => item.id === 'alpha'),
      buildNext: (list, index) =>
        list.map((item, itemIndex) => (itemIndex === index ? { ...item, priority: 9 } : item)),
      save: async (next) => {
        saved.push(next);
      },
    });

    current = [current[1], current[0]];
    firstGate.resolve();

    await blocker;
    await expect(write).resolves.toBe(true);
    expect(current).toEqual([
      { id: 'beta', priority: 2 },
      { id: 'alpha', priority: 9 },
    ]);
    expect(saved).toEqual([current]);
  });

  it('passes the relocated index to save for index-based PATCH APIs', async () => {
    const firstGate = createDeferred<void>();
    const queue = createProviderWriteQueue();
    let current = [
      { name: 'first', disabled: false },
      { name: 'target', disabled: false },
    ];
    const savedIndexes: number[] = [];

    const blocker = queue.enqueue(() => firstGate.promise);
    const write = enqueueLatestProviderListEntryWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
      },
      locate: (list) => list.findIndex((item) => item.name === 'target'),
      buildNext: (list, index) =>
        list.map((item, itemIndex) => (itemIndex === index ? { ...item, disabled: true } : item)),
      save: async (_next, index) => {
        savedIndexes.push(index);
      },
    });

    current = [current[1], current[0]];
    firstGate.resolve();

    await blocker;
    await expect(write).resolves.toBe(true);
    expect(savedIndexes).toEqual([0]);
  });

  it('rolls back the latest list when saving the relocated entry fails', async () => {
    const queue = createProviderWriteQueue();
    const failure = new Error('save failed');
    let current = [
      { id: 'other', priority: 1 },
      { id: 'target', priority: 2 },
    ];
    const applied: Array<typeof current> = [];
    const errors: unknown[] = [];

    const result = await enqueueLatestProviderListEntryWrite(queue, {
      getCurrent: () => current,
      apply: (next) => {
        current = next;
        applied.push(next);
      },
      locate: (list) => list.findIndex((item) => item.id === 'target'),
      buildNext: (list, index) =>
        list.map((item, itemIndex) => (itemIndex === index ? { ...item, priority: 9 } : item)),
      save: async () => {
        throw failure;
      },
      onError: (error) => errors.push(error),
    });

    expect(result).toBe(false);
    expect(errors).toEqual([failure]);
    expect(current).toEqual([
      { id: 'other', priority: 1 },
      { id: 'target', priority: 2 },
    ]);
    expect(applied).toEqual([
      [
        { id: 'other', priority: 1 },
        { id: 'target', priority: 9 },
      ],
      current,
    ]);
  });

  it('does not apply or save when the captured entry no longer exists', async () => {
    const queue = createProviderWriteQueue();
    const current = [{ id: 'other', priority: 1 }];
    let applyCount = 0;
    let saveCount = 0;

    const result = await enqueueLatestProviderListEntryWrite(queue, {
      getCurrent: () => current,
      apply: () => {
        applyCount += 1;
      },
      locate: (list) => list.findIndex((item) => item.id === 'missing'),
      buildNext: (list) => list,
      save: async () => {
        saveCount += 1;
      },
    });

    expect(result).toBe(false);
    expect(applyCount).toBe(0);
    expect(saveCount).toBe(0);
  });
});
