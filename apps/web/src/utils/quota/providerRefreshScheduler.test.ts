import { describe, expect, it } from 'vitest';
import {
  buildProviderCredentialTaskPlan,
  createKeyedSerialTaskQueue,
  runProviderCredentialTaskPlan,
} from './providerRefreshScheduler';

describe('providerRefreshScheduler', () => {
  it('deduplicates repeated credentials within a provider only', () => {
    const tasks = buildProviderCredentialTaskPlan(
      [
        { provider: 'Claude', credential: 'shared', value: 1 },
        { provider: 'claude', credential: 'shared', value: 2 },
        { provider: 'codex', credential: 'shared', value: 3 },
      ],
      {
        getProviderKey: (item) => item.provider,
        getCredentialKey: (item) => item.credential,
      }
    );

    expect(tasks.map((task) => task.item.value)).toEqual([1, 3]);
  });

  it('serializes each provider while keeping different providers parallel', async () => {
    const tasks = buildProviderCredentialTaskPlan(
      [
        { provider: 'claude', credential: 'claude-1' },
        { provider: 'claude', credential: 'claude-2' },
        { provider: 'codex', credential: 'codex-1' },
        { provider: 'codex', credential: 'codex-2' },
      ],
      {
        getProviderKey: (item) => item.provider,
        getCredentialKey: (item) => item.credential,
      }
    );
    const activeByProvider = new Map<string, number>();
    const peakByProvider = new Map<string, number>();
    let active = 0;
    let globalPeak = 0;

    const results = await runProviderCredentialTaskPlan(
      tasks,
      { perProviderConcurrency: 1 },
      async (task) => {
        const providerActive = (activeByProvider.get(task.providerKey) ?? 0) + 1;
        activeByProvider.set(task.providerKey, providerActive);
        peakByProvider.set(
          task.providerKey,
          Math.max(peakByProvider.get(task.providerKey) ?? 0, providerActive)
        );
        active += 1;
        globalPeak = Math.max(globalPeak, active);
        await Promise.resolve();
        active -= 1;
        activeByProvider.set(task.providerKey, providerActive - 1);
        return task.credentialKey;
      }
    );

    expect(peakByProvider).toEqual(
      new Map([
        ['claude', 1],
        ['codex', 1],
      ])
    );
    expect(globalPeak).toBe(2);
    expect(results).toEqual(['claude-1', 'claude-2', 'codex-1', 'codex-2']);
  });

  it('caps the number of provider queues running at once', async () => {
    const tasks = buildProviderCredentialTaskPlan(
      ['claude', 'codex', 'kimi', 'xai'].map((provider) => ({
        provider,
        credential: `${provider}-1`,
      })),
      {
        getProviderKey: (item) => item.provider,
        getCredentialKey: (item) => item.credential,
      }
    );
    let active = 0;
    let peak = 0;

    await runProviderCredentialTaskPlan(
      tasks,
      { perProviderConcurrency: 1, maxConcurrentProviders: 2 },
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
      }
    );

    expect(peak).toBe(2);
  });

  it('serializes separate batches and coalesces repeated keys', async () => {
    const queue = createKeyedSerialTaskQueue();
    const starts: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run('account-a', async () => {
      starts.push('account-a');
      await firstGate;
    });
    const duplicate = queue.run('account-a', async () => {
      throw new Error('duplicate task must not run');
    });
    const second = queue.run('account-b', async () => {
      starts.push('account-b');
    });

    await Promise.resolve();
    expect(duplicate).toBe(first);
    expect(queue.isPending('account-a')).toBe(true);
    expect(starts).toEqual(['account-a']);

    releaseFirst();
    await expect(Promise.all([first, duplicate, second])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(starts).toEqual(['account-a', 'account-b']);
    expect(queue.isPending('account-a')).toBe(false);
    expect(queue.isPending('account-b')).toBe(false);
  });

  it('continues the queue after a failed batch', async () => {
    const queue = createKeyedSerialTaskQueue();
    const failed = queue.run('failed', async () => {
      throw new Error('failed batch');
    });
    const recovered = queue.run('recovered', async () => {});

    await expect(failed).rejects.toThrow('failed batch');
    await expect(recovered).resolves.toBeUndefined();
  });
});
