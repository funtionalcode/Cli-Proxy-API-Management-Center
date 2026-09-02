import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCredentialVisibilityRetry } from './accountCredentialVisibilityRetry';

describe('runCredentialVisibilityRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries boundedly until the credential becomes visible', async () => {
    vi.useFakeTimers();
    const load = vi
      .fn<() => Promise<{ visible: boolean }>>()
      .mockResolvedValueOnce({ visible: false })
      .mockResolvedValueOnce({ visible: false })
      .mockResolvedValueOnce({ visible: true });

    const resultPromise = runCredentialVisibilityRetry({
      load,
      isUnconfirmed: (value) => !value.visible,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(resultPromise).resolves.toMatchObject({
      value: { visible: true },
      exhausted: false,
      cancelled: false,
    });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not retry after the connection becomes inactive', async () => {
    vi.useFakeTimers();
    let active = true;
    const load = vi.fn(async () => ({ visible: false }));
    const resultPromise = runCredentialVisibilityRetry({
      load,
      isUnconfirmed: () => true,
      isActive: () => active,
    });
    await vi.advanceTimersByTimeAsync(0);
    active = false;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(resultPromise).resolves.toMatchObject({ cancelled: true });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
