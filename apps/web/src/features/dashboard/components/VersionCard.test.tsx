import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectionStatus } from '@/types';
import { VersionCard } from './VersionCard';
import styles from './VersionCard.module.scss';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mocks } = vi.hoisted(() => ({
  mocks: {
    checkManagerLatest: vi.fn(),
    checkLatest: vi.fn(),
    showNotification: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.version ? `${key}:${String(options.version)}` : key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/stores', () => ({
  useNotificationStore: (
    selector: (state: { showNotification: typeof mocks.showNotification }) => unknown
  ) => selector({ showNotification: mocks.showNotification }),
}));

vi.mock('@/services/api', () => ({
  versionApi: {
    checkManagerLatest: mocks.checkManagerLatest,
    checkLatest: mocks.checkLatest,
  },
}));

let renderer: ReactTestRenderer | null = null;

const getText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : getText(child))).join('');

const findAnchor = (renderer: ReactTestRenderer, className: string, text: string) =>
  renderer.root.find(
    (node) =>
      node.type === 'a' && node.props.className?.includes(className) && getText(node).includes(text)
  );

const findBadge = (renderer: ReactTestRenderer, type: string, text: string) =>
  renderer.root.find(
    (node) =>
      node.type === type &&
      node.props.className?.includes(styles.badge) &&
      node.props.className?.includes(styles.badgeUpdate) &&
      getText(node).includes(text)
  );

const renderCard = async ({
  appVersion = '1.12.6',
  apiVersion = '7.2.143',
  latestApp = '1.12.6',
  latestApi = '7.2.143',
  connectionStatus = 'connected' as ConnectionStatus,
}: {
  appVersion?: string;
  apiVersion?: string;
  latestApp?: string;
  latestApi?: string;
  connectionStatus?: ConnectionStatus;
} = {}) => {
  mocks.checkManagerLatest.mockResolvedValue({ tag_name: latestApp });
  mocks.checkLatest.mockResolvedValue({ 'latest-version': latestApi });

  await act(async () => {
    renderer = create(
      <MemoryRouter>
        <VersionCard
          appVersion={appVersion}
          apiVersion={apiVersion}
          cpaBase="http://cpa.local:8317"
          connectionStatus={connectionStatus}
          usageEnabled={false}
          usageLoading={false}
          collectorStatus={null}
          collectorLoading={false}
          errorLogCount={0}
          errorLogsLoading={false}
        />
      </MemoryRouter>
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  if (!renderer) throw new Error('VersionCard did not render');
  return renderer;
};

afterEach(() => {
  if (renderer) {
    act(() => renderer?.unmount());
    renderer = null;
  }
  mocks.checkManagerLatest.mockReset();
  mocks.checkLatest.mockReset();
  mocks.showNotification.mockReset();
});

describe('VersionCard release links', () => {
  it('keeps current Manager and Core versions linked to their installed releases', async () => {
    const renderer = await renderCard();

    expect(findAnchor(renderer, styles.versionLink, '1.12.6').props.href).toBe(
      'https://github.com/seakee/CPA-Manager-Plus/releases/tag/v1.12.6'
    );
    expect(findAnchor(renderer, styles.versionLink, '7.2.143').props.href).toBe(
      'https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.143'
    );
    expect(mocks.checkManagerLatest).toHaveBeenCalledTimes(1);
    expect(mocks.checkLatest).toHaveBeenCalledTimes(1);
  });

  it('links a Core update badge to the detected latest Core release', async () => {
    const renderer = await renderCard({ latestApi: 'v7.2.146' });
    const badge = findBadge(renderer, 'a', 'v7.2.146');

    expect(badge.props.href).toBe(
      'https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.146'
    );
    expect(badge.props.target).toBe('_blank');
    expect(badge.props.rel).toBe('noopener noreferrer');
  });

  it('links a Manager update badge to the detected latest Manager release', async () => {
    const renderer = await renderCard({ latestApp: 'v1.12.7' });
    const badge = findBadge(renderer, 'a', 'v1.12.7');

    expect(badge.props.href).toBe(
      'https://github.com/seakee/CPA-Manager-Plus/releases/tag/v1.12.7'
    );
    expect(badge.props.target).toBe('_blank');
    expect(badge.props.rel).toBe('noopener noreferrer');
  });

  it('does not create a badge link for an invalid latest version', async () => {
    const renderer = await renderCard({ latestApp: 'v1.12.7-5-gabcdef', latestApi: '' });

    expect(
      renderer.root.findAll(
        (node) => node.type === 'a' && node.props.className?.includes(styles.badge)
      )
    ).toHaveLength(0);
    expect(findAnchor(renderer, styles.versionLink, '1.12.6').props.href).toContain(
      '/CPA-Manager-Plus/releases/tag/v1.12.6'
    );
  });

  it('keeps the latest badge as plain text when there is no update', async () => {
    const renderer = await renderCard();

    expect(
      renderer.root.findAll(
        (node) =>
          node.type === 'span' &&
          node.props.className?.includes(styles.badgeLatest) &&
          getText(node) === 'dashboard.version_is_latest'
      )
    ).toHaveLength(2);
  });
});
