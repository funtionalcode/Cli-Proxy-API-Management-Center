import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { AccountsView } from '@/features/accounts/model/accountsPagePresentation';
import {
  useAccountsWorkspaceRefresh,
  type AccountsWorkspaceRefreshHandlers,
} from './useAccountsWorkspaceRefresh';

function RefreshHarness({
  activeView,
  handlers,
}: {
  activeView: AccountsView;
  handlers: AccountsWorkspaceRefreshHandlers;
}) {
  const refresh = useAccountsWorkspaceRefresh(activeView, handlers);
  return <button onClick={() => void refresh()}>refresh</button>;
}

const triggerRefresh = async (renderer: ReactTestRenderer) => {
  await act(async () => {
    renderer.root.findByType('button').props.onClick();
    await Promise.resolve();
  });
};

describe('useAccountsWorkspaceRefresh', () => {
  it('refreshes only the active workspace and reads the latest handler', async () => {
    const firstAccounts = vi.fn(async () => undefined);
    const latestAccounts = vi.fn(async () => undefined);
    const health = vi.fn(async () => undefined);
    const oauth = vi.fn(async () => undefined);
    const initialHandlers = {
      refreshAccounts: firstAccounts,
      refreshHealth: health,
      refreshOauth: oauth,
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RefreshHarness activeView="accounts" handlers={initialHandlers} />);
      await Promise.resolve();
    });

    await triggerRefresh(renderer);
    expect(firstAccounts).toHaveBeenCalledTimes(1);
    expect(health).not.toHaveBeenCalled();
    expect(oauth).not.toHaveBeenCalled();

    await act(async () => {
      renderer.update(
        <RefreshHarness
          activeView="health"
          handlers={{ refreshAccounts: latestAccounts, refreshHealth: health, refreshOauth: oauth }}
        />
      );
      await Promise.resolve();
    });
    await triggerRefresh(renderer);

    expect(latestAccounts).not.toHaveBeenCalled();
    expect(health).toHaveBeenCalledTimes(1);
    expect(oauth).not.toHaveBeenCalled();

    await act(async () => {
      renderer.update(
        <RefreshHarness
          activeView="accounts"
          handlers={{ refreshAccounts: latestAccounts, refreshHealth: health, refreshOauth: oauth }}
        />
      );
      await Promise.resolve();
    });
    await triggerRefresh(renderer);

    expect(latestAccounts).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledTimes(1);
  });
});
