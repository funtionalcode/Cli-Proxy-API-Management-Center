import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
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
    listRuns: vi.fn(async () => ({ items: [] })),
    getRun: vi.fn(),
  },
}));

vi.mock('@/features/monitoring/codexInspection', () => ({
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
});
