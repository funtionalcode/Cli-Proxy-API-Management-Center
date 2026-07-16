# Runtime Model

CPAMP does not replace CPA. Normal model traffic still goes through the CPA gateway runtime. CPAMP turns runtime state, request events, cost estimates, and account health into an operational panel.

Think of the split this way:

- CPA / CLIProxyAPI handles real model requests and owns providers, auth files, OAuth, API keys, quota, logs, and plugin runtime.
- CPAMP hosts the management panel, collects the usage queue, stores local SQLite data, and provides Dashboard, Monitoring, Usage Analytics, Codex Inspection, and automation policy.

When troubleshooting, first decide whether the issue is in CPA request routing or in CPAMP collection, storage, and display.

## Request Path

```text
Client
  -> CPA gateway runtime
      -> provider / model endpoint
      -> usage queue / request log
  -> CPAMP Manager Server
      -> monitoring / analytics / inspection / dashboard
```

This path has two practical consequences:

- Client base URLs should point to CPA, not CPAMP.
- If CPAMP pages have no data, first confirm that requests went through CPA, then check the usage queue and collector.

## Login And Keys

| Scenario | Key | Notes |
|---|---|---|
| Log in to CPAMP in Full Docker / Manager Server mode | CPAMP Admin Key | The `cpamp_...` key from startup logs or the secret file. It only manages CPAMP. |
| CPAMP connects to CPA | CPA Management Key | Setup/panel-saved connections are encrypted into SQLite; installer env/secret mode reads the key from the install directory. |
| Normal model API request | CPA API Key | Used by clients calling `/v1/...`, `/backend-api/codex/...`, and similar model APIs. |
| Log in in the CPA-hosted panel | CPA Management Key | CPA hosts the panel and the browser holds the CPA Management Key. |

When debugging 401s, read the path first. `/v1/...` belongs to the model API and uses a CPA API Key. `/v0/management/...` usually uses the CPAMP Admin Key in Manager Server mode.

## When You Still Edit CPA Config

These still belong in CPA `config.yaml` or CPA management:

- provider routing, auth file directories, OAuth, API keys, quota, logs, and gateway behavior.
- plugin runtime capabilities after installation.
- `remote-management`, `usage-statistics-enabled`, and `redis-usage-queue-retention-seconds`.
- storage backend, hot reload, and provider compatibility interfaces.

CPAMP saves only the connection and observability settings Manager Server needs. It does not rewrite the full CPA `config.yaml`.

## Recommended Reading Order

1. [Get Started](./getting-started.md)
2. [Gateway Configuration](../gateway/configuration.md)
3. [Providers And Compatibility APIs](../gateway/providers.md)
4. [Client Configuration](../gateway/clients.md)
5. [Panel Manual](../manual/dashboard.md)
