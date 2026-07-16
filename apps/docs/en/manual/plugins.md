# Plugin Management

Plugin Management is where you install, enable, configure, and troubleshoot CPA plugins. CPAMP provides one panel entry for plugin status, configuration, and plugin page resources.

This page covers installing, enabling, configuring, and troubleshooting plugins from the panel.

## Page Structure

Plugin Management normally has two entries:

- **Installed plugins**: the plugins currently discovered by the runtime, with status, config, and page resources.
- **Plugin store**: plugins available from configured store sources.

If the plugin system is globally disabled, the page will show the `plugins.enabled` state. A plugin instance marked enabled will still not run until the global switch is enabled.

## Installed Plugins

- View installed plugins, version, author, status, and configuration fields.
- Enable or disable plugins.
- Edit plugin configuration, priority, and enabled state.
- Fill plugin-declared fields such as strings, numbers, booleans, arrays, and objects.
- Start OAuth flows provided by plugins.
- Open plugin-provided pages.
- Delete plugin configuration or plugin files.

If the page says a restart is required, restart CPA or Manager Server according to your deployment. Refreshing the browser is not enough.

## Plugin Store

The plugin store depends on `plugins.store-sources` and optional store authentication. Common operations:

- Refresh the store list.
- View plugin name, version, source, and description.
- Install or update plugins.
- Handle sources that require authentication.

After installing, return to Installed plugins and confirm runtime status. The plugin directory must be persistent, otherwise container rebuilds may remove installed files.

## Before Enabling

1. CPA plugin support is enabled.
2. The plugin directory is persistent in the container or host.
3. The plugin supports the current OS and architecture.
4. Required plugin configuration fields are filled.
5. If the plugin provides OAuth or pages, reverse proxy includes `/v0/resource/plugins/*` to CPAMP.

Whether a plugin can run depends on CPA runtime capability and the plugin's own compatibility. CPAMP exposes management, but it cannot make a plugin support your CPA version, OS, or CPU architecture.

## Blank Plugin Pages

Common causes:

- The plugin is disabled or not registered.
- Plugin configuration is missing.
- The reverse proxy does not send `/v0/resource/plugins/*` to CPAMP.
- Plugin resource files are missing or incompatible with the current version.

First check path boundaries in [Reverse Proxy](../deployment/reverse-proxy.md), then inspect runtime errors in [Logs](./logs.md).

## Change Advice

In production, enable, upgrade, or delete plugins during low traffic. After enabling, watch [Dashboard](./dashboard.md) and [Monitoring](./monitoring.md) to make sure request volume, failure rate, and latency stay normal.

If a plugin affects auth or upstream requests, also check [Auth Files](./auth-files.md), [OAuth Login](./oauth.md), and [Logs](./logs.md).
