import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CLAUDE_CONFIG } from '@/components/quota/quotaConfigs';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCredentialStoreKey } from '@/utils/quota/credentialScope';
import { parseClaudeLimitResets } from '@/utils/quota/claudeLimitReset';
import type { ClaudeQuotaData } from '@/utils/quota/providerRequests';
import type { AccountRow } from '../model/accountRows';
import { beginAccountQuotaRequest } from '../model/accountQuotaRequestGate';
import { useClaudeLimitReset } from './useClaudeLimitReset';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mocks } = vi.hoisted(() => ({
  mocks: {
    consume: vi.fn(),
    resetGateway: vi.fn(),
    onGatewayReset: vi.fn(),
    showConfirmation: vi.fn(),
    showNotification: vi.fn(),
  },
}));
vi.mock('@/services/api/claudeQuota', () => ({ consumeClaudeLimitReset: mocks.consume }));
vi.mock('@/services/api/authFiles', () => ({ authFilesApi: { resetQuota: mocks.resetGateway } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`,
  }),
}));

const row = {
  fileName: 'claude.json',
  provider: 'claude',
  runtimeOnly: false,
  selectionKey: 'claude:auth-1',
  raw: { name: 'claude.json', type: 'claude', auth_index: 'auth-1' },
} as unknown as AccountRow;
const quotaData = (resetsLeft = 2, usedPercent = 20): ClaudeQuotaData => ({
  windows: [
    { id: 'five-hour', label: '5h', usedPercent, resetLabel: '-' },
    { id: 'seven-day', label: '7d', usedPercent, resetLabel: '-' },
  ],
  quotaInventoryObserved: true,
  organizationId: 'org-1',
  limitResets: parseClaudeLimitResets({
    grants: [
      {
        id: 'fable',
        label: 'Fable reset',
        type: 'full',
        gives_back_weekly: true,
        resets_left: resetsLeft,
        clears: ['five_hour'],
        usable_now: true,
      },
    ],
  }),
});

type Options = Parameters<typeof useClaudeLimitReset>[0];
let options: Options;
let hook: ReturnType<typeof useClaudeLimitReset>;
let renderer: ReactTestRenderer | undefined;
let fetchQuota: MockInstance<typeof CLAUDE_CONFIG.fetchQuota>;

function Harness({ config }: { config: Options }) {
  const current = useClaudeLimitReset(config);
  useLayoutEffect(() => {
    hook = current;
  });
  return null;
}
const mount = () =>
  act(() => {
    renderer = create(<Harness config={options} />);
  });
const start = (grantId = 'fable') =>
  act(async () => {
    await hook.resetClaudeQuotaForRow(row, grantId);
  });
const confirm = () =>
  act(async () => {
    await mocks.showConfirmation.mock.calls[0][0].onConfirm();
  });
const update = (patch: Partial<Options>) =>
  act(() => {
    options = { ...options, ...patch };
    renderer!.update(<Harness config={options} />);
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  useQuotaStore.getState().clearQuotaCache();
  useNotificationStore.setState({
    showConfirmation: mocks.showConfirmation,
    showNotification: mocks.showNotification,
  });
  options = {
    rows: [row],
    connectionKey: 'connection-a',
    disabled: false,
    requestScope: { apiBase: 'https://captured.example.test', managementKey: 'test-key' },
    requestVersions: { current: new Map() },
    onGatewayReset: mocks.onGatewayReset,
  };
  fetchQuota = vi.spyOn(CLAUDE_CONFIG, 'fetchQuota').mockResolvedValue(quotaData());
  mocks.consume.mockResolvedValue({ outcome: 'reset', result: 'reset', reason: null });
  mocks.resetGateway.mockResolvedValue({ status: 'ok' });
  mocks.onGatewayReset.mockResolvedValue(undefined);
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useClaudeLimitReset explicit transaction', () => {
  it.each([
    ['full_launch', 'full'],
    ['fable', 'fable'],
  ])(
    'confirms and submits only the selected %s grant without substituting the other kind',
    async (grantId, kind) => {
      const data = quotaData();
      data.limitResets!.grants.unshift({
        ...data.limitResets!.grants[0],
        id: 'full_launch',
        label: 'Full reset',
        kind: 'full',
        resetsLeft: 1,
        clears: ['five_hour', 'seven_day'],
      });
      fetchQuota.mockResolvedValue(data);
      mount();
      await start(grantId);
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.showConfirmation.mock.calls[0][0].message).toContain(`reset_kind_${kind}`);
      await confirm();
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(
        row.raw,
        'org-1',
        grantId,
        options.requestScope
      );
    }
  );

  it('keeps a cancelled confirmation inert even if its callback is invoked later', async () => {
    mount();
    await start();
    act(() => mocks.showConfirmation.mock.calls[0][0].onCancel());
    await confirm();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('checks expiry again when confirmation is submitted', async () => {
    const nowMs = Date.parse('2026-11-16T12:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const data = quotaData();
    data.limitResets!.grants[0].endsAtMs = nowMs + 60_000;
    fetchQuota.mockResolvedValue(data);
    mount();
    await start();
    clock.mockReturnValue(nowMs + 60_000);
    await confirm();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('does not publish a late mutation result into a different connection', async () => {
    let resolveMutation!: (value: unknown) => void;
    mocks.consume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        })
    );
    mount();
    await start();
    let transaction!: Promise<void>;
    await act(async () => {
      transaction = mocks.showConfirmation.mock.calls[0][0].onConfirm();
    });
    update({ connectionKey: 'connection-b' });
    act(() => useQuotaStore.getState().clearQuotaCache());
    await act(async () => {
      resolveMutation({ outcome: 'reset', result: 'reset', reason: null });
      await transaction;
    });
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    expect(mocks.resetGateway).not.toHaveBeenCalled();
    expect(mocks.showNotification).not.toHaveBeenCalled();
    expect(useQuotaStore.getState().claudeQuota).toEqual({});
  });

  it('does not read or consume on mount, and cancellation never submits a reset', async () => {
    mount();
    expect(fetchQuota).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    await start();
    expect(fetchQuota).toHaveBeenCalledWith(row.raw, expect.any(Function), options.requestScope);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(hook.isClaudeQuotaResetting(row)).toBe(true);
    const confirmation = mocks.showConfirmation.mock.calls[0][0];
    expect(confirmation.message).toContain('Fable reset');
    expect(confirmation.message).toContain('five_hour');
    act(() => confirmation.onCancel());
    expect(hook.isClaudeQuotaResetting(row)).toBe(false);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('submits once after confirmation and refreshes before clearing a healthy gateway cooldown', async () => {
    fetchQuota.mockResolvedValueOnce(quotaData(2)).mockResolvedValueOnce(quotaData(1));
    mount();
    await start();
    await start();
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    await act(async () => {
      const onConfirm = mocks.showConfirmation.mock.calls[0][0].onConfirm;
      await Promise.all([onConfirm(), onConfirm()]);
    });
    expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(
      row.raw,
      'org-1',
      'fable',
      options.requestScope
    );
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(mocks.resetGateway).toHaveBeenCalledExactlyOnceWith('auth-1', options.requestScope);
    expect(mocks.onGatewayReset).toHaveBeenCalledTimes(1);
    expect(
      useQuotaStore.getState().claudeQuota[getQuotaCredentialStoreKey(row.raw)].limitResets
        ?.grants[0].resetsLeft
    ).toBe(1);
    expect(mocks.showNotification).toHaveBeenLastCalledWith(
      expect.stringContaining('reset_success'),
      'success'
    );
    expect(hook.isClaudeQuotaResetting(row)).toBe(false);
  });

  it.each([
    { outcome: 'declined', result: 'already_used', reason: null },
    { outcome: 'declined', result: 'not_limited', reason: null },
    { outcome: 'unconfirmed', result: 'reset', reason: 'reset_unconfirmed' },
    { outcome: 'unconfirmed', result: 'unknown', reason: null },
  ])('never clears gateway cooldown or reports success for $result / $reason', async (result) => {
    mocks.consume.mockResolvedValue(result);
    mount();
    await start();
    await confirm();
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(mocks.resetGateway).not.toHaveBeenCalled();
    expect(mocks.showNotification).toHaveBeenLastCalledWith(expect.any(String), 'warning');
  });

  it('does not retry a lost mutation response, but still attempts a safe inventory refresh', async () => {
    mocks.consume.mockRejectedValue(new Error('response lost'));
    mount();
    await start();
    await confirm();
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(mocks.resetGateway).not.toHaveBeenCalled();
    expect(mocks.showNotification).toHaveBeenLastCalledWith(
      expect.stringContaining('reset_unconfirmed'),
      'warning'
    );
  });

  it('blocks reset when verification fails', async () => {
    fetchQuota.mockRejectedValue(new Error('read failed'));
    mount();
    await start();
    expect(mocks.showConfirmation).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(hook.isClaudeQuotaResetting(row)).toBe(false);
  });

  it.each([
    { ...quotaData(), organizationId: null },
    { ...quotaData(), limitResets: null },
    quotaData(0),
  ])('blocks a missing or unusable grant before confirmation', async (data) => {
    fetchQuota.mockResolvedValue(data);
    mount();
    await start();
    expect(mocks.showConfirmation).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it.each(['connection', 'credential', 'cache', 'quota', 'disabled', 'unmount'])(
    'blocks confirmation after %s changes',
    async (change) => {
      mount();
      await start();
      if (change === 'connection') update({ connectionKey: 'connection-b' });
      if (change === 'credential')
        update({ rows: [{ ...row, raw: { ...row.raw, auth_index: 'auth-2' } }] });
      if (change === 'cache') act(() => useQuotaStore.getState().clearQuotaCache());
      if (change === 'quota')
        beginAccountQuotaRequest(
          options.requestVersions.current,
          `claude:${getQuotaCredentialStoreKey(row.raw)}`
        );
      if (change === 'disabled') update({ disabled: true });
      if (change === 'unmount') {
        act(() => renderer!.unmount());
        renderer = undefined;
      }
      await confirm();
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.resetGateway).not.toHaveBeenCalled();
    }
  );

  it('preserves gateway limits if a different quota window is still exhausted', async () => {
    fetchQuota.mockResolvedValueOnce(quotaData()).mockResolvedValueOnce({
      ...quotaData(1),
      windows: [
        ...quotaData().windows,
        { id: 'seven-day', label: '7d', usedPercent: 100, resetLabel: '-' },
      ],
    });
    mount();
    await start();
    await confirm();
    expect(mocks.resetGateway).not.toHaveBeenCalled();
    expect(mocks.showNotification).toHaveBeenLastCalledWith(
      expect.stringContaining('reset_success'),
      'success'
    );
  });

  it('does not recover a manually disabled account', async () => {
    const disabledRow = { ...row, raw: { ...row.raw, disabled: true } };
    options.rows = [disabledRow];
    mount();
    await act(async () => {
      await hook.resetClaudeQuotaForRow(disabledRow, 'fable');
    });
    await confirm();
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(mocks.resetGateway).not.toHaveBeenCalled();
  });

  it('does not clear all gateway limits when weekly usage is unobserved', async () => {
    fetchQuota.mockResolvedValueOnce(quotaData()).mockResolvedValueOnce({
      ...quotaData(1),
      windows: quotaData().windows.filter((window) => window.id === 'five-hour'),
    });
    mount();
    await start();
    await confirm();
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(mocks.resetGateway).not.toHaveBeenCalled();
  });

  it('preserves an account manually disabled while confirmation is open', async () => {
    mount();
    await start();
    update({ rows: [{ ...row, raw: { ...row.raw, disabled: true } }] });
    await confirm();
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(mocks.resetGateway).not.toHaveBeenCalled();
  });

  it('invalidates consumed inventory if the post-reset refresh fails', async () => {
    fetchQuota.mockResolvedValueOnce(quotaData()).mockRejectedValueOnce(new Error('read failed'));
    mount();
    await start();
    await confirm();
    expect(
      useQuotaStore.getState().claudeQuota[getQuotaCredentialStoreKey(row.raw)].limitResets
    ).toBeNull();
    expect(mocks.resetGateway).not.toHaveBeenCalled();
    expect(mocks.showNotification).toHaveBeenLastCalledWith(
      expect.stringContaining('reset_partial_success'),
      'warning'
    );
  });
});
