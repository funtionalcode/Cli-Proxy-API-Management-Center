# System

System shows what runtime the panel is connected to, which models are visible, and which basic details to collect before troubleshooting.

Use [Logs](./logs.md) for log content. Use [Monitoring](./monitoring.md), [Usage Analytics](./usage-analytics.md), and [Auth Files](./auth-files.md) for requests, cost, and account state.

## Main Content

- **Quick links**: main repository, Web UI repository, and documentation.
- **Model list**: available models from the current connection, grouped by source.
- **Clear login storage**: remove saved panel connection state from the browser.
- **Connection state**: confirm whether the panel is connected to a usable CPA or Manager Server.

The exact content depends on runtime mode. Full Docker, the CPA-hosted panel, native packages, and demo mode expose different capabilities.

## Model List

Use the model list to answer:

1. Which models the runtime currently exposes.
2. Which provider or configuration a model comes from.

If a client fails to request a model, first check whether the model is visible here. If it is not, inspect [AI Providers](./ai-providers.md) and model rules.

A visible model does not guarantee requests will succeed. Auth, quota, upstream state, and routing rules can still fail.

## Clear Login Storage

Clear login storage removes saved panel connection information from the current browser. Use it when:

- Switching to another CPAMP or CPA address.
- Admin credentials changed but the browser keeps using the old connection.
- Moving between local development, demo, and production environments.

This does not delete server configuration, auth files, SQLite data, or CPA configuration. It only affects the current browser.

## What To Collect For Troubleshooting

Before reporting a problem, record:

- CPAMP version and runtime mode.
- CPA version.
- Access mode: Full Docker, CPA-hosted panel, native package, or development.
- Whether the model list loads.
- Whether login storage was recently cleared or the address changed.

Then combine it with sanitized evidence from [Logs](./logs.md) and [Monitoring](./monitoring.md) for the same time window.
