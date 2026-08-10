import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mocks } = vi.hoisted(() => ({
  mocks: {
    location: { pathname: '/accounts', search: '', hash: '', key: 'current', state: null },
    blocker: {
      state: 'unblocked' as 'unblocked' | 'blocked' | 'proceeding',
      location: undefined as
        { pathname: string; search: string; hash: string; key: string; state: null } | undefined,
      proceed: vi.fn(),
      reset: vi.fn(),
    },
    showConfirmation: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => mocks.location,
  useBlocker: () => mocks.blocker,
}));

vi.mock('@/stores', () => ({
  useNotificationStore: () => ({ showConfirmation: mocks.showConfirmation }),
}));

const dialog = {
  title: 'Unsaved',
  message: 'Leave?',
  confirmText: 'Leave',
  cancelText: 'Stay',
};

function Harness({
  onConfirmNavigation,
}: {
  onConfirmNavigation?: () => boolean | void | Promise<boolean | void>;
}) {
  useUnsavedChangesGuard({
    shouldBlock: true,
    dialog,
    onConfirmNavigation,
  });
  return null;
}

const blockNavigation = async (
  renderer: ReactTestRenderer,
  onConfirmNavigation?: () => boolean | void | Promise<boolean | void>
) => {
  mocks.blocker.state = 'blocked';
  mocks.blocker.location = {
    pathname: '/settings',
    search: '',
    hash: '',
    key: 'next',
    state: null,
  };
  await act(async () => {
    renderer.update(<Harness onConfirmNavigation={onConfirmNavigation} />);
    await Promise.resolve();
  });
  const confirmation = mocks.showConfirmation.mock.calls[0]?.[0] as {
    onConfirm: () => void;
  };
  if (!confirmation) throw new Error('confirmation missing');
  return confirmation;
};

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    mocks.blocker.state = 'unblocked';
    mocks.blocker.location = undefined;
    mocks.blocker.proceed.mockClear();
    mocks.blocker.reset.mockClear();
    mocks.showConfirmation.mockClear();
  });

  it('runs the discard callback before proceeding', async () => {
    const onConfirmNavigation = vi.fn(() => true);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Harness onConfirmNavigation={onConfirmNavigation} />);
    });
    const confirmation = await blockNavigation(renderer, onConfirmNavigation);

    await act(async () => {
      confirmation.onConfirm();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onConfirmNavigation).toHaveBeenCalledTimes(1);
    expect(mocks.blocker.proceed).toHaveBeenCalledTimes(1);
    expect(mocks.blocker.reset).not.toHaveBeenCalled();
  });

  it('resets the blocker when the discard callback refuses or fails', async () => {
    for (const onConfirmNavigation of [
      vi.fn(() => false),
      vi.fn(async () => {
        throw new Error('discard failed');
      }),
    ]) {
      mocks.blocker.state = 'unblocked';
      mocks.blocker.location = undefined;
      mocks.blocker.reset.mockClear();
      mocks.showConfirmation.mockClear();
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = create(<Harness onConfirmNavigation={onConfirmNavigation} />);
      });
      const confirmation = await blockNavigation(renderer, onConfirmNavigation);

      await act(async () => {
        confirmation.onConfirm();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.blocker.reset).toHaveBeenCalledTimes(1);
      expect(mocks.blocker.proceed).not.toHaveBeenCalled();
      act(() => renderer.unmount());
    }
  });
});
