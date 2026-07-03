import type { PluginListEntry } from '@/types';

export type PluginStatusTone = 'success' | 'warning' | 'muted';

export interface PluginStatusDisplay {
  key:
    | 'effective'
    | 'global_disabled'
    | 'disabled'
    | 'not_registered'
    | 'not_configured'
    | 'inactive';
  labelKey: string;
  tone: PluginStatusTone;
}

export interface PluginDisplay {
  title: string;
  subtitleParts: string[];
  versionLabel: string;
  author: string;
  status: PluginStatusDisplay;
  menuCount: number;
  primaryMenuLabel: string;
  primaryMenuDescription: string;
  configFieldCount: number;
}

interface PluginDisplayOptions {
  pluginsEnabled?: boolean;
}

export const formatPluginVersion = (version: string) => {
  const trimmed = version.trim();
  if (!trimmed) return '';
  return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
};

export const getPluginStatusDisplay = (
  plugin: PluginListEntry,
  options: PluginDisplayOptions = {}
): PluginStatusDisplay => {
  const pluginsEnabled = options.pluginsEnabled ?? true;

  if (plugin.effectiveEnabled) {
    return {
      key: 'effective',
      labelKey: 'plugin_management.status_effective',
      tone: 'success',
    };
  }
  if (!pluginsEnabled && plugin.enabled) {
    return {
      key: 'global_disabled',
      labelKey: 'plugin_management.status_global_disabled',
      tone: 'warning',
    };
  }
  if (!plugin.enabled) {
    return {
      key: 'disabled',
      labelKey: 'plugin_management.status_disabled',
      tone: 'muted',
    };
  }
  if (!plugin.registered) {
    return {
      key: 'not_registered',
      labelKey: 'plugin_management.not_registered',
      tone: 'warning',
    };
  }
  if (!plugin.configured) {
    return {
      key: 'not_configured',
      labelKey: 'plugin_management.not_configured',
      tone: 'muted',
    };
  }
  return {
    key: 'inactive',
    labelKey: 'plugin_management.status_inactive',
    tone: 'warning',
  };
};

export const buildPluginDisplay = (
  plugin: PluginListEntry,
  options: PluginDisplayOptions = {}
): PluginDisplay => {
  const title = plugin.metadata?.name.trim() || plugin.id;
  const versionLabel = formatPluginVersion(plugin.metadata?.version ?? '');
  const author = plugin.metadata?.author.trim() ?? '';
  const primaryMenu = plugin.menus.find((menu) => menu.menu.trim() || menu.path.trim());
  const primaryMenuLabel = primaryMenu?.menu.trim() || primaryMenu?.path.trim() || '';

  return {
    title,
    subtitleParts: [plugin.id, versionLabel, author].filter(Boolean),
    versionLabel,
    author,
    status: getPluginStatusDisplay(plugin, options),
    menuCount: plugin.menus.length,
    primaryMenuLabel,
    primaryMenuDescription: primaryMenu?.description.trim() ?? '',
    configFieldCount: plugin.configFields.length,
  };
};
