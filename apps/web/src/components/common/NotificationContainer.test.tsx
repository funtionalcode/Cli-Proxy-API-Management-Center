import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/types';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    notifications: [] as Notification[],
    removeNotification: vi.fn(),
    portalTarget: null as unknown,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (children: unknown, target: unknown) => {
      mocks.portalTarget = target;
      return children;
    },
  };
});

vi.mock('@/stores', () => ({
  useNotificationStore: (
    selector?: (state: {
      notifications: Notification[];
      removeNotification: typeof mocks.removeNotification;
    }) => unknown
  ) => {
    const state = {
      notifications: mocks.notifications,
      removeNotification: mocks.removeNotification,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/ui/icons', () => ({
  IconX: () => null,
}));

import { NotificationContainer } from './NotificationContainer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('NotificationContainer', () => {
  let renderer: ReactTestRenderer | undefined;
  let body: Record<string, unknown>;
  let restoreDocument: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.notifications = [];
    mocks.removeNotification.mockReset();
    mocks.portalTarget = null;

    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    body = {};
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body },
    });
    restoreDocument = () => {
      if (previousDocument) {
        Object.defineProperty(globalThis, 'document', previousDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    };
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    restoreDocument?.();
    restoreDocument = undefined;
    vi.useRealTimers();
  });

  it('portals notifications to document.body without changing their content or type', async () => {
    mocks.notifications = [
      {
        id: 'notification-1',
        message: '401 Unauthorized',
        type: 'error',
      },
    ];

    await act(async () => {
      renderer = create(<NotificationContainer />);
      await Promise.resolve();
    });

    expect(mocks.portalTarget).toBe(body);
    const notification = renderer!.root.find(
      (node) =>
        typeof node.props.className === 'string' &&
        node.props.className.includes('notification error')
    );
    expect(notification.props.children[0].props.children).toBe('401 Unauthorized');
  });

  it('keeps close behavior wired to removeNotification after the exit animation', async () => {
    mocks.notifications = [
      {
        id: 'notification-1',
        message: 'Saved',
        type: 'success',
      },
    ];

    await act(async () => {
      renderer = create(<NotificationContainer />);
      await Promise.resolve();
    });

    await act(async () => {
      renderer!.root.findByProps({ className: 'close-btn' }).props.onClick();
      vi.advanceTimersByTime(300);
    });

    expect(mocks.removeNotification).toHaveBeenCalledWith('notification-1');
  });
});
