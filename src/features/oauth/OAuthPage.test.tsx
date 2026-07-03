import { describe, expect, it } from 'vitest';
import { resolvePluginOAuthProviderId, shouldShowPluginOAuthProvider } from './oauthProviderHelpers';

const builtInProviderIds = new Set(['codex', 'anthropic', 'antigravity', 'kimi', 'xai']);

describe('plugin OAuth provider helpers', () => {
  it('uses explicit plugin OAuth provider ids when present', () => {
    expect(resolvePluginOAuthProviderId({ id: 'legacy-plugin', oauthProvider: 'custom' })).toBe(
      'custom'
    );
    expect(resolvePluginOAuthProviderId({ id: 'legacy-plugin' })).toBe('legacy-plugin');
  });

  it('hides plugin OAuth entries that resolve to built-in providers', () => {
    expect(
      shouldShowPluginOAuthProvider(
        {
          id: 'custom-plugin',
          oauthProvider: 'codex',
          supportsOAuth: true,
        },
        builtInProviderIds
      )
    ).toBe(false);
    expect(
      shouldShowPluginOAuthProvider(
        {
          id: 'custom-plugin',
          oauthProvider: 'custom-provider',
          supportsOAuth: true,
        },
        builtInProviderIds
      )
    ).toBe(true);
  });
});
