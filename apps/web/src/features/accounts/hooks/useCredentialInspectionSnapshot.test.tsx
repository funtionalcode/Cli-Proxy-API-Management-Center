import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexInspectionRun, CodexInspectionRunDetail } from '@/services/api';
import type {
  CredentialInspectionSnapshot,
  CredentialInspectionResult,
} from '@/features/monitoring/model/credentialInspectionSnapshot';
import { useCredentialInspectionSnapshot } from './useCredentialInspectionSnapshot';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { mocks } = vi.hoisted(() => ({
  mocks: {
    loadLastRun: vi.fn(() => null),
    listRuns: vi.fn(async () => ({ items: [] as CodexInspectionRun[] })),
    getRun: vi.fn(),
  },
}));

vi.mock('@/features/monitoring/codexInspection', () => ({
  createCodexInspectionConnectionFingerprint: (apiBase: string, managementKey: string) =>
    apiBase && managementKey ? `opaque:${apiBase.length}:${managementKey.length}` : null,
  loadCodexInspectionLastRun: mocks.loadLastRun,
}));

vi.mock('@/services/api', () => ({
  usageServiceApi: {
    listCodexInspectionRuns: mocks.listRuns,
    getCodexInspectionRun: mocks.getRun,
  },
}));

function Harness({ onResults }: { onResults: (results: readonly unknown[]) => void }) {
  const { results } = useCredentialInspectionSnapshot({
    connectionFingerprint: 'connection-a',
    checking: false,
    serverAvailable: false,
    managerServiceBase: '',
    managementKey: 'manager-key',
  });
  onResults(results);
  return null;
}

function ScopedHarness({
  connectionFingerprint,
  onCommit,
  onApplySnapshot,
}: {
  connectionFingerprint: string;
  onCommit: (results: readonly CredentialInspectionResult[]) => void;
  onApplySnapshot: (apply: (snapshot: CredentialInspectionSnapshot) => void) => void;
}) {
  const { results, applySnapshot } = useCredentialInspectionSnapshot({
    connectionFingerprint,
    checking: false,
    serverAvailable: false,
    managerServiceBase: '',
    managementKey: 'manager-key',
  });
  onApplySnapshot(applySnapshot);

  useLayoutEffect(() => {
    onCommit(results);
  }, [connectionFingerprint, onCommit, results]);

  return null;
}

type CredentialInspectionHookState = ReturnType<typeof useCredentialInspectionSnapshot>;

function ServerHarness({ onState }: { onState: (state: CredentialInspectionHookState) => void }) {
  const state = useCredentialInspectionSnapshot({
    connectionFingerprint: 'connection-a',
    checking: false,
    serverAvailable: true,
    managerServiceBase: 'http://manager.local:18317',
    managementKey: 'manager-key',
  });
  onState(state);
  return null;
}

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const makeRun = (finishedAtMs: number): CodexInspectionRun => ({
  id: 7,
  triggerType: 'manual',
  status: 'completed',
  startedAtMs: finishedAtMs - 100,
  finishedAtMs,
  totalFiles: 1,
  probeSetCount: 1,
  sampledCount: 1,
  disabledCount: 0,
  enabledCount: 0,
  deleteCount: 0,
  disableCount: 0,
  enableCount: 0,
  reauthCount: 1,
  keepCount: 0,
  createdAtMs: finishedAtMs - 100,
  updatedAtMs: finishedAtMs,
});

const makeIncompleteRun = (id: number): CodexInspectionRun => ({
  ...makeRun(id * 100),
  id,
  status: 'failed',
  error: 'inspection failed',
});

const makeResult = (account: string, createdAtMs: number): CredentialInspectionResult => ({
  id: createdAtMs,
  runId: 7,
  accountKey: account,
  fileName: 'codex.json',
  displayAccount: account,
  authIndex: 'auth-1',
  provider: 'codex',
  disabled: false,
  status: 'success',
  state: 'healthy',
  action: 'keep',
  actionReason: '',
  actionStatus: 'success',
  isQuota: false,
  autoRecoverEligible: false,
  error: '',
  createdAtMs,
  inspectionSource: 'server',
});

beforeEach(() => {
  mocks.loadLastRun.mockReset();
  mocks.loadLastRun.mockReturnValue(null);
  mocks.listRuns.mockReset();
  mocks.listRuns.mockResolvedValue({ items: [] });
  mocks.getRun.mockReset();
});

describe('useCredentialInspectionSnapshot', () => {
  it('keeps the empty result collection stable across parent renders', () => {
    const observed: Array<readonly unknown[]> = [];
    const onResults = (results: readonly unknown[]) => observed.push(results);
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<Harness onResults={onResults} />);
    });
    const initialResults = observed[observed.length - 1];

    act(() => {
      renderer!.update(<Harness onResults={onResults} />);
    });

    expect(initialResults).toBeDefined();
    expect(observed[observed.length - 1]).toBe(initialResults);
    expect(mocks.listRuns).not.toHaveBeenCalled();
  });

  it('does not expose the previous scope snapshot on the first commit after a scope change', () => {
    const committedResults: Array<readonly CredentialInspectionResult[]> = [];
    let applySnapshot: ((snapshot: CredentialInspectionSnapshot) => void) | null = null;
    const onCommit = (results: readonly CredentialInspectionResult[]) => {
      committedResults.push(results);
    };
    const onApplySnapshot = (apply: (snapshot: CredentialInspectionSnapshot) => void) => {
      applySnapshot = apply;
    };
    const oldResult = {
      id: 1,
      runId: 1,
      accountKey: 'old-account',
      fileName: 'old.json',
      displayAccount: 'old-account',
      provider: 'codex',
      disabled: false,
      status: 'success',
      state: 'healthy',
      action: 'keep',
      actionReason: '',
      actionStatus: 'pending',
      isQuota: false,
      autoRecoverEligible: false,
      error: '',
      createdAtMs: 1,
      inspectionSource: 'server',
    } as CredentialInspectionResult;
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <ScopedHarness
          connectionFingerprint="connection-a"
          onCommit={onCommit}
          onApplySnapshot={onApplySnapshot}
        />
      );
    });

    act(() => {
      applySnapshot?.({
        source: 'server',
        completedAtMs: 1,
        results: [oldResult],
        runs: [],
      });
    });

    expect(committedResults[committedResults.length - 1]).toEqual([
      expect.objectContaining({ provider: 'codex' }),
    ]);

    act(() => {
      renderer!.update(
        <ScopedHarness
          connectionFingerprint="connection-b"
          onCommit={onCommit}
          onApplySnapshot={onApplySnapshot}
        />
      );
    });

    expect(committedResults[committedResults.length - 1]).toEqual([]);
  });

  it('keeps an applied live snapshot when an older server response finishes later', async () => {
    const run = makeRun(200);
    const deferredDetail = createDeferred<CodexInspectionRunDetail>();
    mocks.listRuns.mockResolvedValue({ items: [run] });
    mocks.getRun.mockReturnValue(deferredDetail.promise);
    let currentState: CredentialInspectionHookState | null = null;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<ServerHarness onState={(state) => (currentState = state)} />);
    });

    let refreshPromise!: Promise<CredentialInspectionSnapshot | null>;
    await act(async () => {
      refreshPromise = currentState!.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(currentState!.loading).toBe(true);

    const liveSnapshot: CredentialInspectionSnapshot = {
      source: 'server',
      completedAtMs: 300,
      results: [makeResult('live@example.com', 300)],
      runs: [],
    };
    act(() => currentState!.applySnapshot(liveSnapshot));

    expect(currentState!.loading).toBe(false);
    expect(currentState!.results).toEqual([
      expect.objectContaining({ displayAccount: 'live@example.com' }),
    ]);

    deferredDetail.resolve({
      run,
      results: [makeResult('stale@example.com', 200)],
      logs: [],
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(currentState!.results).toEqual([
      expect.objectContaining({ displayAccount: 'live@example.com' }),
    ]);
    act(() => renderer!.unmount());
  });

  it('ignores an in-flight server response after credential evidence is invalidated', async () => {
    const run = makeRun(200);
    const deferredDetail = createDeferred<CodexInspectionRunDetail>();
    mocks.listRuns.mockResolvedValue({ items: [run] });
    mocks.getRun.mockReturnValue(deferredDetail.promise);
    let currentState: CredentialInspectionHookState | null = null;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<ServerHarness onState={(state) => (currentState = state)} />);
    });

    let refreshPromise!: Promise<CredentialInspectionSnapshot | null>;
    await act(async () => {
      refreshPromise = currentState!.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(currentState!.loading).toBe(true);

    act(() => currentState!.invalidatePendingRefresh());
    expect(currentState!.loading).toBe(false);

    deferredDetail.resolve({
      run,
      results: [makeResult('stale@example.com', 200)],
      logs: [],
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(currentState!.results).toEqual([]);
    act(() => renderer!.unmount());
  });

  it('does not clear an applied snapshot when a later refresh has no completed run', async () => {
    let currentState: CredentialInspectionHookState | null = null;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<ServerHarness onState={(state) => (currentState = state)} />);
    });
    act(() =>
      currentState!.applySnapshot({
        source: 'server',
        completedAtMs: 300,
        results: [makeResult('live@example.com', 300)],
        runs: [],
      })
    );

    await act(async () => {
      await currentState!.refresh();
    });

    expect(currentState!.results).toEqual([
      expect.objectContaining({ displayAccount: 'live@example.com' }),
    ]);
    expect(currentState!.loading).toBe(false);
    act(() => renderer!.unmount());
  });

  it('returns the completed server snapshot loaded by refresh', async () => {
    const run = makeRun(200);
    mocks.listRuns.mockResolvedValue({ items: [run] });
    mocks.getRun.mockResolvedValue({
      run,
      results: [makeResult('server@example.com', 200)],
      logs: [],
    });
    let currentState: CredentialInspectionHookState | null = null;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<ServerHarness onState={(state) => (currentState = state)} />);
    });

    let loadedSnapshot: CredentialInspectionSnapshot | null = null;
    await act(async () => {
      loadedSnapshot = await currentState!.refresh();
    });

    expect(loadedSnapshot).toMatchObject({
      source: 'server',
      completedAtMs: 200,
      results: [expect.objectContaining({ displayAccount: 'server@example.com' })],
    });
    act(() => renderer!.unmount());
  });

  it('expands the run search when the latest ten runs have no successful snapshot', async () => {
    const completedRun = { ...makeRun(100), id: 1 };
    const recentFailures = Array.from({ length: 10 }, (_, index) =>
      makeIncompleteRun(index + 2)
    ).reverse();
    mocks.listRuns
      .mockResolvedValueOnce({ items: recentFailures })
      .mockResolvedValueOnce({ items: [...recentFailures, completedRun] });
    mocks.getRun.mockResolvedValue({
      run: completedRun,
      results: [makeResult('last-success@example.com', 100)],
      logs: [],
    });
    let currentState: CredentialInspectionHookState | null = null;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<ServerHarness onState={(state) => (currentState = state)} />);
    });

    await act(async () => {
      await currentState!.refresh();
    });

    expect(mocks.listRuns).toHaveBeenNthCalledWith(
      1,
      'http://manager.local:18317',
      'manager-key',
      10
    );
    expect(mocks.listRuns).toHaveBeenNthCalledWith(
      2,
      'http://manager.local:18317',
      'manager-key',
      200
    );
    expect(mocks.getRun).toHaveBeenCalledWith(
      'http://manager.local:18317',
      'manager-key',
      completedRun.id
    );
    expect(currentState!.results).toEqual([
      expect.objectContaining({ displayAccount: 'last-success@example.com' }),
    ]);
    act(() => renderer!.unmount());
  });

  it('skips newer failed runs and loads the latest successful inspection snapshot', async () => {
    const completedRun = makeRun(200);
    const failedRun = {
      ...makeRun(300),
      id: 8,
      status: 'failed',
    };
    mocks.listRuns.mockResolvedValue({ items: [failedRun, completedRun] });
    mocks.getRun.mockResolvedValue({
      run: completedRun,
      results: [makeResult('completed@example.com', 200)],
      logs: [],
    });
    let currentState: CredentialInspectionHookState | null = null;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<ServerHarness onState={(state) => (currentState = state)} />);
    });

    await act(async () => {
      await currentState!.refresh();
    });

    expect(mocks.getRun).toHaveBeenCalledWith(
      'http://manager.local:18317',
      'manager-key',
      completedRun.id
    );
    expect(currentState!.results).toEqual([
      expect.objectContaining({ displayAccount: 'completed@example.com' }),
    ]);
    act(() => renderer!.unmount());
  });
});
