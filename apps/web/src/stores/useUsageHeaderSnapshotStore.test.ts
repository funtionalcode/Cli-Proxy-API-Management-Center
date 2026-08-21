import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageHeaderSnapshotsResponse } from '@/services/api/usageService';
import {
  buildUsageHeaderSnapshotContentRevision,
  buildUsageHeaderSnapshotScopeKey,
  useUsageHeaderSnapshotStore,
} from './useUsageHeaderSnapshotStore';

const response = (eventHash: string, timestampMs = 2): UsageHeaderSnapshotsResponse => ({
  generated_at_ms: 3,
  from_ms: 1,
  to_ms: 2,
  items: [{ event_hash: eventHash, timestamp_ms: timestampMs }],
});

describe('useUsageHeaderSnapshotStore', () => {
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
    vi.restoreAllMocks();
  });

  it('builds an opaque, normalized connection scope', () => {
    const first = buildUsageHeaderSnapshotScopeKey('http://manager.local/', 'secret');
    const second = buildUsageHeaderSnapshotScopeKey('http://manager.local', 'secret');

    expect(first).toBe(second);
    expect(first).not.toContain('manager.local');
    expect(first).not.toContain('secret');
    expect(buildUsageHeaderSnapshotScopeKey('', 'secret')).toBe('');
  });

  it('keeps snapshots for the same scope and clears them before a new scope is used', () => {
    const store = useUsageHeaderSnapshotStore.getState();
    expect(store.activateScope('scope-a')).toBe(true);
    expect(useUsageHeaderSnapshotStore.getState().commitResponse('scope-a', response('a'))).toBe(
      true
    );

    expect(useUsageHeaderSnapshotStore.getState().activateScope('scope-a')).toBe(false);
    expect(useUsageHeaderSnapshotStore.getState().items).toMatchObject([{ event_hash: 'a' }]);

    expect(useUsageHeaderSnapshotStore.getState().activateScope('scope-b')).toBe(true);
    expect(useUsageHeaderSnapshotStore.getState()).toMatchObject({
      scopeKey: 'scope-b',
      items: [],
      generatedAtMs: 0,
      loadedAtMs: 0,
      contentRevision: '',
    });
  });

  it('rejects a stale response from a previous scope', () => {
    useUsageHeaderSnapshotStore.getState().activateScope('scope-a');
    useUsageHeaderSnapshotStore.getState().activateScope('scope-b');

    expect(useUsageHeaderSnapshotStore.getState().commitResponse('scope-a', response('late'))).toBe(
      false
    );
    expect(useUsageHeaderSnapshotStore.getState().items).toEqual([]);
  });

  it('tracks query time separately from content revision', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10);
    useUsageHeaderSnapshotStore.getState().activateScope('scope-a');
    useUsageHeaderSnapshotStore.getState().commitResponse('scope-a', response('same'));
    const first = useUsageHeaderSnapshotStore.getState();

    nowSpy.mockReturnValue(20);
    useUsageHeaderSnapshotStore
      .getState()
      .commitResponse('scope-a', { ...response('same'), generated_at_ms: 4 });
    const second = useUsageHeaderSnapshotStore.getState();

    expect(second.loadedAtMs).toBe(20);
    expect(second.generatedAtMs).toBe(4);
    expect(second.contentRevision).toBe(first.contentRevision);
  });

  it('builds a stable revision independent of response ordering', () => {
    const items = [
      { event_hash: 'b', timestamp_ms: 2 },
      { event_hash: 'a', timestamp_ms: 1 },
    ];
    expect(buildUsageHeaderSnapshotContentRevision(items)).toBe(
      buildUsageHeaderSnapshotContentRevision([...items].reverse())
    );
  });
});
