import { useEffect, useLayoutEffect, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  monitoringAnalyticsApi,
  type UsageHeaderSnapshot,
  type UsageHeaderSnapshotsResponse,
} from '@/services/api/usageService';
import { useHeaderSnapshotsLoader } from './useHeaderSnapshotsLoader';
import { useUsageHeaderSnapshotStore } from '@/stores/useUsageHeaderSnapshotStore';

vi.mock('@/services/api/usageService', () => ({
  monitoringAnalyticsApi: {
    getHeaderSnapshots: vi.fn(),
  },
}));

const getHeaderSnapshotsMock = vi.mocked(monitoringAnalyticsApi.getHeaderSnapshots);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const response = (eventHash: string): UsageHeaderSnapshotsResponse => ({
  generated_at_ms: 3,
  from_ms: 1,
  to_ms: 2,
  items: [{ event_hash: eventHash, timestamp_ms: 2 }],
});

describe('useHeaderSnapshotsLoader', () => {
  let renderer: ReactTestRenderer | null = null;
  let load: (() => Promise<void>) | null = null;
  const observedItems: UsageHeaderSnapshot[][] = [];
  const observedGeneratedAtMs: number[] = [];
  const layoutCommits: Array<{
    serviceBase: string;
    managementKey: string;
    items: UsageHeaderSnapshot[];
  }> = [];

  beforeAll(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  beforeEach(() => {
    useUsageHeaderSnapshotStore.setState({
      scopeKey: '',
      items: [],
      generatedAtMs: 0,
      loadedAtMs: 0,
      contentRevision: '',
    });
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
    load = null;
    observedItems.length = 0;
    observedGeneratedAtMs.length = 0;
    layoutCommits.length = 0;
    getHeaderSnapshotsMock.mockReset();
  });

  function Harness({
    serviceBase,
    managementKey = 'management-key',
    requestGenerationRef,
  }: {
    serviceBase: string;
    managementKey?: string;
    requestGenerationRef?: { current: number };
  }) {
    const currentItemsRef = useRef<UsageHeaderSnapshot[]>([]);
    const currentLoad = useHeaderSnapshotsLoader({
      serviceBase,
      managementKey,
      requestGenerationRef,
      onResponse: (result) => {
        currentItemsRef.current = result.items ?? [];
        observedItems.push(currentItemsRef.current);
        observedGeneratedAtMs.push(result.generated_at_ms);
      },
      onReset: () => {
        currentItemsRef.current = [];
        observedItems.push([]);
      },
    });
    useLayoutEffect(() => {
      layoutCommits.push({
        serviceBase,
        managementKey,
        items: [...currentItemsRef.current],
      });
    }, [managementKey, serviceBase]);
    useEffect(() => {
      load = currentLoad;
      return () => {
        if (load === currentLoad) load = null;
      };
    }, [currentLoad]);
    return null;
  }

  it('invalidates snapshots before the first layout commit after the scope changes', async () => {
    getHeaderSnapshotsMock
      .mockResolvedValueOnce(response('manager-a'))
      .mockResolvedValueOnce(response('manager-b'));

    await act(async () => {
      renderer = create(
        <Harness serviceBase="http://manager-a.local" managementKey="management-key-a" />
      );
    });
    await act(async () => {
      await load!();
    });

    layoutCommits.length = 0;
    await act(async () => {
      renderer?.update(
        <Harness serviceBase="http://manager-b.local" managementKey="management-key-a" />
      );
    });
    expect(layoutCommits[0]).toEqual({
      serviceBase: 'http://manager-b.local',
      managementKey: 'management-key-a',
      items: [],
    });

    await act(async () => {
      await load!();
    });
    layoutCommits.length = 0;
    await act(async () => {
      renderer?.update(
        <Harness serviceBase="http://manager-b.local" managementKey="management-key-b" />
      );
    });
    expect(layoutCommits[0]).toEqual({
      serviceBase: 'http://manager-b.local',
      managementKey: 'management-key-b',
      items: [],
    });
  });

  it('deduplicates the same request and ignores a stale response after the service changes', async () => {
    const first = deferred<UsageHeaderSnapshotsResponse>();
    const second = deferred<UsageHeaderSnapshotsResponse>();
    getHeaderSnapshotsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await act(async () => {
      renderer = create(<Harness serviceBase="http://manager-a.local" />);
    });

    let firstLoad!: Promise<void>;
    let duplicateLoad!: Promise<void>;
    act(() => {
      firstLoad = load!();
      duplicateLoad = load!();
    });
    expect(getHeaderSnapshotsMock).toHaveBeenCalledTimes(1);
    const firstSignal = getHeaderSnapshotsMock.mock.calls[0]?.[3];
    expect(firstSignal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      renderer?.update(<Harness serviceBase="http://manager-b.local" />);
    });
    expect(firstSignal?.aborted).toBe(true);
    let secondLoad!: Promise<void>;
    act(() => {
      secondLoad = load!();
    });
    expect(getHeaderSnapshotsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve(response('stale'));
      await Promise.all([firstLoad, duplicateLoad]);
    });
    expect(observedItems).toEqual([[]]);

    await act(async () => {
      second.resolve(response('current'));
      await secondLoad;
    });
    expect(observedItems).toEqual([[], [{ event_hash: 'current', timestamp_ms: 2 }]]);
    expect(observedGeneratedAtMs).toEqual([3]);
  });

  it('restarts the request and ignores the old response after credential evidence changes', async () => {
    const first = deferred<UsageHeaderSnapshotsResponse>();
    const second = deferred<UsageHeaderSnapshotsResponse>();
    const requestGenerationRef = { current: 0 };
    getHeaderSnapshotsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await act(async () => {
      renderer = create(
        <Harness serviceBase="http://manager.local" requestGenerationRef={requestGenerationRef} />
      );
    });

    let firstLoad!: Promise<void>;
    act(() => {
      firstLoad = load!();
    });
    const firstSignal = getHeaderSnapshotsMock.mock.calls[0]?.[3];
    requestGenerationRef.current += 1;
    let secondLoad!: Promise<void>;
    act(() => {
      secondLoad = load!();
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(getHeaderSnapshotsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve(response('stale'));
      await firstLoad;
    });
    expect(observedItems).toEqual([]);

    await act(async () => {
      second.resolve(response('current'));
      await secondLoad;
    });
    expect(observedItems).toEqual([[{ event_hash: 'current', timestamp_ms: 2 }]]);
  });

  it('clears snapshots from the previous service when the replacement request fails', async () => {
    getHeaderSnapshotsMock
      .mockResolvedValueOnce(response('manager-a'))
      .mockRejectedValueOnce(new Error('manager-b unavailable'));

    await act(async () => {
      renderer = create(<Harness serviceBase="http://manager-a.local" />);
    });
    await act(async () => {
      await load!();
    });
    expect(observedItems).toEqual([[{ event_hash: 'manager-a', timestamp_ms: 2 }]]);

    await act(async () => {
      renderer?.update(<Harness serviceBase="http://manager-b.local" />);
    });
    await act(async () => {
      await load!();
    });

    expect(observedItems).toEqual([[{ event_hash: 'manager-a', timestamp_ms: 2 }], []]);
  });

  it('allows a failed request to be retried for the same service', async () => {
    getHeaderSnapshotsMock
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(response('recovered'));

    await act(async () => {
      renderer = create(<Harness serviceBase="http://manager.local" />);
    });
    await act(async () => {
      await load!();
      await load!();
    });

    expect(getHeaderSnapshotsMock).toHaveBeenCalledTimes(2);
    expect(observedItems).toEqual([[{ event_hash: 'recovered', timestamp_ms: 2 }]]);
  });

  it('keeps the latest snapshot cached when a consumer remounts in the same scope', async () => {
    getHeaderSnapshotsMock.mockResolvedValueOnce(response('cached'));

    await act(async () => {
      renderer = create(<Harness serviceBase="http://manager.local" />);
    });
    await act(async () => {
      await load!();
    });
    await act(async () => {
      renderer?.unmount();
      renderer = null;
    });

    await act(async () => {
      renderer = create(<Harness serviceBase="http://manager.local" />);
    });

    expect(useUsageHeaderSnapshotStore.getState().items).toMatchObject([
      { event_hash: 'cached', timestamp_ms: 2 },
    ]);
    expect(getHeaderSnapshotsMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that resolves after the consumer unmounts', async () => {
    const request = deferred<UsageHeaderSnapshotsResponse>();
    getHeaderSnapshotsMock.mockReturnValueOnce(request.promise);

    await act(async () => {
      renderer = create(<Harness serviceBase="http://manager.local" />);
    });
    let pendingLoad!: Promise<void>;
    act(() => {
      pendingLoad = load!();
    });
    const signal = getHeaderSnapshotsMock.mock.calls[0]?.[3];
    await act(async () => {
      renderer?.unmount();
      renderer = null;
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      request.resolve(response('late'));
      await pendingLoad;
    });

    expect(observedItems).toEqual([]);
  });
});
