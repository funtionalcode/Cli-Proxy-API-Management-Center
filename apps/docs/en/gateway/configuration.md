# Gateway Configuration

CPA / CLIProxyAPI is the gateway runtime that receives real model traffic. CPAMP reads runtime state and configuration signals through the CPA Management API, then presents monitoring, analytics, and operations in the panel.

If CPAMP setup succeeds but Monitoring stays empty, start with the settings below: remote management, usage publishing, and queue retention.

## Required Settings

CPAMP needs CPA remote management enabled:

```yaml
remote-management:
  secret-key: "replace-with-a-long-random-management-key"
  allow-remote: true
```

Check `allow-remote` whenever CPAMP and CPA are not running in the same process. In Docker Compose, two containers on the same network are still not seen by CPA as `localhost`.

Request monitoring also needs usage publishing:

```yaml
usage-statistics-enabled: true
redis-usage-queue-retention-seconds: 60
```

`redis-usage-queue-retention-seconds` is the window CPAMP has to collect request events. Start with the default `60` seconds. Increase it only for unstable networks, frequent collector restarts, or troubleshooting.

## Auth Directory

Auth files hold provider accounts, OAuth tokens, or API keys. For monitoring, quota, and inspection to keep tracking the same account, keep them stable:

- Mount an `auths/` directory into the CPA container.
- Use one JSON file per account, or one file with multiple account entries.
- Configure a stable `auth_index` for each account so CPAMP can correlate monitoring, quota, and inspection data.
- Disable accounts through the panel or CPA management APIs when possible. Deleting files breaks historical correlation and account actions.

Use [Auth Files](../manual/auth-files.md) and [OAuth Login](../manual/oauth.md) for day-to-day maintenance.

## Storage And Hot Reload

CPA config and runtime data can use local files or external storage supported by CPA. Choose based on how you back up and roll back:

| Option | Good For | Notes |
|---|---|---|
| Local files | Single-host Docker or native deployment | Easiest to back up; persist the volume or host directory. |
| PostgreSQL | Multi-instance or cloud deployments | Confirm connection strings, migrations, and backup strategy. |
| Object storage | Centralized config storage | Watch access keys and consistency delay. |
| Git storage | Config review and rollback | Do not commit sensitive tokens in plaintext. |

With hot reload enabled, many changes take effect without restarting CPA. For provider, auth file, quota, or plugin changes, work during low traffic and watch Dashboard, Monitoring, and Logs for a few minutes afterward.

## CPAMP And CPA Boundary

Saved by CPAMP:

- CPA URL and encrypted CPA Management Key.
- Request monitoring collection mode, poll interval, batch size, and query limit.
- Model prices, API key aliases, account processing policy, and server inspection history.

Saved by CPA:

- providers, auth files, OAuth, quota, API keys, logs, plugins, and routing rules.
- `remote-management`, usage queue, storage backend, and hot reload.

Use a simple rule for ownership: if CPAMP exposes an edit surface, use the panel first; gateway runtime behavior without a panel surface still belongs in CPA config or CPA management APIs.
