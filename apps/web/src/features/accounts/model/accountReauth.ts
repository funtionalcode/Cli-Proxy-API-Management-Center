import type { AuthFileItem } from '@/types';
import { normalizeAccountProvider } from './accountRows';

export type AccountReauthAction =
  | { kind: 'codex-dialog' }
  | { kind: 'navigate'; path: string }
  | { kind: 'unsupported'; provider: string };

const OAUTH_PROVIDER_BY_ACCOUNT_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic',
  antigravity: 'antigravity',
  claude: 'anthropic',
  kimi: 'kimi',
  xai: 'xai',
};

export const resolveAccountReauthAction = (file: AuthFileItem): AccountReauthAction => {
  const provider = normalizeAccountProvider(file);
  if (provider === 'codex') return { kind: 'codex-dialog' };

  const oauthProvider = OAUTH_PROVIDER_BY_ACCOUNT_PROVIDER[provider];
  if (oauthProvider) {
    return {
      kind: 'navigate',
      path: `/oauth#oauth-provider-${oauthProvider}`,
    };
  }

  return { kind: 'unsupported', provider };
};
