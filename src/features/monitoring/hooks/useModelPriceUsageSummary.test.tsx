import { act, createElement, createRef, useImperativeHandle, type Ref } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usageServiceApi, type ModelPriceUsageSummaryResponse } from '@/services/api/usageService';
import { useModelPriceUsageSummary } from './useModelPriceUsageSummary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useModelPriceUsageSummary>;

interface HookParams {
  serviceBase: string;
  managementKey?: string;
}

interface HookHarnessProps extends HookParams {
  hookRef: Ref<HookResult>;
  onRender?: (result: HookResult) => void;
}

interface MountedHook {
  getCurrent: () => HookResult;
  rerender: (params: HookParams) => Promise<void>;
  unmount: () => void;
}

const SUMMARY_A: ModelPriceUsageSummaryResponse = {
  sampled_events: 3,
  total_events: 3,
  truncated: false,
  models: [{ model: 'gpt-5.5', calls: 3, requested_calls: 1, resolved_calls: 2 }],
};

const SUMMARY_B: ModelPriceUsageSummaryResponse = {
  sampled_events: 5,
  total_events: 5,
  truncated: false,
  models: [{ model: 'claude-opus-4-5', calls: 5, requested_calls: 5, resolved_calls: 0 }],
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const createStatusError = (message: string, status?: number, code?: string) =>
  Object.assign(new Error(message), { status, code });

function HookHarness({ hookRef, onRender, serviceBase, managementKey }: HookHarnessProps) {
  const result = useModelPriceUsageSummary({ serviceBase, managementKey });
  onRender?.(result);
  useImperativeHandle(hookRef, () => result, [result]);
  return null;
}

const mountedRenderers: ReactTestRenderer[] = [];

const mountHook = async (
  params: HookParams,
  onRender?: (result: HookResult) => void
): Promise<MountedHook> => {
  const hookRef = createRef<HookResult>();
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(createElement(HookHarness, { ...params, hookRef, onRender }));
    await flushMicrotasks();
  });
  mountedRenderers.push(renderer);

  return {
    getCurrent: () => {
      if (!hookRef.current) throw new Error('Hook harness is not mounted');
      return hookRef.current;
    },
    rerender: async (nextParams) => {
      await act(async () => {
        renderer.update(createElement(HookHarness, { ...nextParams, hookRef, onRender }));
        await flushMicrotasks();
      });
    },
    unmount: () => {
      act(() => renderer.unmount());
    },
  };
};

describe('useModelPriceUsageSummary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    for (const renderer of mountedRenderers.splice(0)) {
      act(() => renderer.unmount());
    }
    vi.restoreAllMocks();
  });

  it('enables model_stats fallback without exposing an error for a 404 response', async () => {
    vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary').mockRejectedValueOnce(
      createStatusError('not found', 404)
    );

    const harness = await mountHook({
      serviceBase: 'http://manager.local',
      managementKey: 'management-key',
    });

    expect(harness.getCurrent()).toMatchObject({
      usageSummary: null,
      loading: false,
      error: '',
      modelStatsFallbackEnabled: true,
    });
  });

  it.each([
    createStatusError('method not allowed', 405),
    createStatusError('unsupported method', undefined, 'method_not_allowed'),
  ])('enables model_stats fallback for another unsupported endpoint error', async (error) => {
    vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary').mockRejectedValueOnce(error);

    const harness = await mountHook({ serviceBase: 'http://manager.local' });

    expect(harness.getCurrent().modelStatsFallbackEnabled).toBe(true);
    expect(harness.getCurrent().error).toBe('');
  });

  it.each([
    createStatusError('authentication failed', 401),
    createStatusError('database unavailable', 500),
  ])('exposes a real HTTP failure message without enabling fallback', async (requestError) => {
    vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary').mockRejectedValueOnce(requestError);

    const harness = await mountHook({ serviceBase: 'http://manager.local' });

    expect(harness.getCurrent()).toMatchObject({
      usageSummary: null,
      loading: false,
      error: requestError.message,
      modelStatsFallbackEnabled: false,
    });
  });

  it('clears an error while retrying and stores the successful summary', async () => {
    const retryRequest = createDeferred<ModelPriceUsageSummaryResponse>();
    vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary')
      .mockRejectedValueOnce(new Error('network failed'))
      .mockImplementationOnce(() => retryRequest.promise);

    const harness = await mountHook({ serviceBase: 'http://manager.local' });
    expect(harness.getCurrent().error).toBe('network failed');

    act(() => harness.getCurrent().retry());

    expect(harness.getCurrent()).toMatchObject({
      usageSummary: null,
      loading: true,
      error: '',
      modelStatsFallbackEnabled: false,
    });

    await act(async () => {
      retryRequest.resolve(SUMMARY_A);
      await flushMicrotasks();
    });

    expect(harness.getCurrent()).toMatchObject({
      usageSummary: SUMMARY_A,
      loading: false,
      error: '',
      modelStatsFallbackEnabled: false,
    });
    expect(usageServiceApi.getModelPriceUsageSummary).toHaveBeenCalledTimes(2);
  });

  it('aborts and replaces an active request when retrying', async () => {
    const firstRequest = createDeferred<ModelPriceUsageSummaryResponse>();
    const secondRequest = createDeferred<ModelPriceUsageSummaryResponse>();
    const signals: AbortSignal[] = [];
    vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary')
      .mockImplementationOnce((_base, _key, signal) => {
        if (signal) signals.push(signal);
        return firstRequest.promise;
      })
      .mockImplementationOnce((_base, _key, signal) => {
        if (signal) signals.push(signal);
        return secondRequest.promise;
      });

    const harness = await mountHook({ serviceBase: 'http://manager.local' });
    act(() => harness.getCurrent().retry());

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    await act(async () => {
      secondRequest.resolve(SUMMARY_B);
      await flushMicrotasks();
    });
    await act(async () => {
      firstRequest.resolve(SUMMARY_A);
      await flushMicrotasks();
    });

    expect(harness.getCurrent().usageSummary).toEqual(SUMMARY_B);
    expect(harness.getCurrent().loading).toBe(false);
  });

  it('aborts stale parameters and prevents their response from replacing current data', async () => {
    const firstRequest = createDeferred<ModelPriceUsageSummaryResponse>();
    const secondRequest = createDeferred<ModelPriceUsageSummaryResponse>();
    const signals: AbortSignal[] = [];
    vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary')
      .mockImplementationOnce((_base, _key, signal) => {
        if (signal) signals.push(signal);
        return firstRequest.promise;
      })
      .mockImplementationOnce((_base, _key, signal) => {
        if (signal) signals.push(signal);
        return secondRequest.promise;
      });

    const harness = await mountHook({ serviceBase: 'http://manager-a.local' });
    await harness.rerender({ serviceBase: 'http://manager-b.local' });

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    await act(async () => {
      firstRequest.resolve(SUMMARY_A);
      await flushMicrotasks();
    });
    expect(harness.getCurrent()).toMatchObject({ usageSummary: null, loading: true });

    await act(async () => {
      secondRequest.resolve(SUMMARY_B);
      await flushMicrotasks();
    });
    expect(harness.getCurrent()).toMatchObject({ usageSummary: SUMMARY_B, loading: false });
  });

  it('does not request and resets state when serviceBase becomes empty', async () => {
    const request = createDeferred<ModelPriceUsageSummaryResponse>();
    let signal: AbortSignal | undefined;
    const requestSpy = vi
      .spyOn(usageServiceApi, 'getModelPriceUsageSummary')
      .mockImplementation((_base, _key, nextSignal) => {
        signal = nextSignal;
        return request.promise;
      });

    const harness = await mountHook({ serviceBase: 'http://manager.local' });
    await harness.rerender({ serviceBase: '' });

    expect(signal?.aborted).toBe(true);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(harness.getCurrent()).toMatchObject({
      usageSummary: null,
      loading: false,
      error: '',
      modelStatsFallbackEnabled: false,
    });
  });

  it.each(['resolve', 'reject'] as const)(
    'aborts on unmount and ignores a late %s',
    async (settlement) => {
      const request = createDeferred<ModelPriceUsageSummaryResponse>();
      let signal: AbortSignal | undefined;
      let renderCount = 0;
      vi.spyOn(usageServiceApi, 'getModelPriceUsageSummary').mockImplementation(
        (_base, _key, nextSignal) => {
          signal = nextSignal;
          return request.promise;
        }
      );

      const harness = await mountHook({ serviceBase: 'http://manager.local' }, () => {
        renderCount += 1;
      });
      harness.unmount();
      const renderCountAfterUnmount = renderCount;

      expect(signal?.aborted).toBe(true);

      await act(async () => {
        if (settlement === 'resolve') request.resolve(SUMMARY_A);
        else request.reject(new Error('late network failure'));
        await flushMicrotasks();
      });

      expect(renderCount).toBe(renderCountAfterUnmount);
    }
  );
});
