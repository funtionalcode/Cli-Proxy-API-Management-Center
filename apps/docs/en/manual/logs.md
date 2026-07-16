# Logs

Logs helps diagnose runtime issues. Use it when monitoring summaries are not enough, OAuth callbacks fail, plugin pages are blank, or configuration reload does not behave as expected.

Use [System](./system.md) for version, runtime mode, and model-list checks.

## When To Use Logs

- Provider requests fail and Monitoring does not explain enough.
- OAuth login or callback fails.
- Plugin loading, plugin configuration, or plugin page resources fail.
- Configuration saves but does not take effect.
- Reverse proxy paths hit the wrong upstream.
- CPA or Manager Server connection is unhealthy.

## Page Actions

- Refresh logs.
- Hide management-panel logs so model requests and runtime errors are easier to see.
- Show raw logs for multi-line copying.
- Open error request logs and download the file matching the time window.

If request logging is enabled, CPA's separate error-request log list may be empty. That does not mean no request failed. Use [Monitoring](./monitoring.md) for sanitized failure summaries.

## Investigation Flow

1. Get the approximate time from Monitoring or the page error.
2. Refresh logs and locate the same time window.
3. Copy sanitized error lines, status codes, and upstream summaries.
4. If logs point to auth or quota, continue with [Auth Files](./auth-files.md) or [Quota](./quota.md).
5. If logs point to plugins, continue with [Plugin Management](./plugins.md) and check resource paths.

## Do Not Share

Logs may include paths, headers, or upstream summaries. Before sharing, remove:

- CPA Management Key
- CPAMP Admin Key
- Provider API Key
- OAuth Token
- Full auth file content
- Unsanitized Authorization headers

