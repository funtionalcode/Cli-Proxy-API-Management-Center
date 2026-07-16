import type { PluginListEntry } from '@/types';

export const resolvePluginOAuthProviderId = (
  plugin: Pick<PluginListEntry, 'id' | 'oauthProvider'>
): string => plugin.oauthProvider ?? plugin.id;

export const shouldShowPluginOAuthProvider = (
  plugin: Pick<PluginListEntry, 'id' | 'oauthProvider' | 'supportsOAuth'>,
  builtInProviderIds: ReadonlySet<string>
): boolean =>
  plugin.supportsOAuth && !builtInProviderIds.has(resolvePluginOAuthProviderId(plugin));
