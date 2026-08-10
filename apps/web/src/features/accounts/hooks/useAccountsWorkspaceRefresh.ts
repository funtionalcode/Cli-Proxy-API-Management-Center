import { useCallback, useEffect, useRef } from 'react';
import type { AccountsView } from '@/features/accounts/model/accountsPagePresentation';

export interface AccountsWorkspaceRefreshHandlers {
  refreshAccounts: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshOauth: () => Promise<void>;
}

/**
 * Keeps the top-level refresh action scoped to the visible workspace.
 * Idle pages must not fan out into unrelated monitoring, OAuth, or quota requests.
 */
export function useAccountsWorkspaceRefresh(
  activeView: AccountsView,
  handlers: AccountsWorkspaceRefreshHandlers
) {
  const { refreshAccounts, refreshHealth, refreshOauth } = handlers;
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = { refreshAccounts, refreshHealth, refreshOauth };
  }, [refreshAccounts, refreshHealth, refreshOauth]);

  return useCallback(async () => {
    const currentHandlers = handlersRef.current;
    if (activeView === 'health') {
      await currentHandlers.refreshHealth();
      return;
    }
    if (activeView === 'oauth') {
      await currentHandlers.refreshOauth();
      return;
    }
    await currentHandlers.refreshAccounts();
  }, [activeView]);
}
