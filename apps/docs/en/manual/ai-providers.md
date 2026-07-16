# AI Providers

AI Providers controls how CPA forwards client requests to upstream model services. These settings are provider credentials and routing settings, not CPAMP login or the CPA Management Key.

Use [Configuration](./configuration.md) for Manager Server connection, collector, and runtime switches.

## Supported Configuration Types

Provider entries are grouped by type. Common types include:

- Codex
- Claude Code
- Gemini / AI Studio
- Vertex
- OpenAI-compatible

Each provider has different fields, but the core questions are the same: where requests go, which credentials are used, which models are available, whether the entry is enabled, and whether headers or compatibility APIs need special handling.

## Add Or Edit A Provider

1. Click add configuration and choose the provider type.
2. Fill name, Base URL, API key, auth file, or OAuth-related fields.
3. If the page asks for `auth_index`, use a stable and unique value so usage, quota, and inspection can connect data to the same account.
4. Configure model lists or model rules. Keep client model names, provider model names, and model-price names clear.
5. Save, then send one low-cost request.
6. Open [Monitoring](./monitoring.md) and confirm provider, model, account, and status.

## Field Guidance

- **Base URL**: should point to the upstream model service or CPA-compatible endpoint, not the CPAMP docs or panel URL.
- **API Key**: a provider or client credential. Do not use CPA Management Key or CPAMP Admin Key here.
- **Auth file**: use it for OAuth or account-file providers. Maintain account state in [Auth Files](./auth-files.md).
- **Model list**: affects visible models and routing. Cost estimation also needs matching names in [Model Prices](./model-prices.md).
- **Enabled state**: disabled entries should no longer receive new routed requests.

## Verify After Saving

The reliable test is not the "saved" toast. Send a real request:

1. Ask a client to use a low-cost model.
2. In [Monitoring](./monitoring.md), confirm provider, model, account, and status code.
3. If the request succeeds but cost is empty, check [Model Prices](./model-prices.md).
4. If the request fails like an auth issue, check [Auth Files](./auth-files.md) or [OAuth Login](./oauth.md).
5. If no request event appears, troubleshoot the monitoring collection path.

## Common Problems

- **Model still unavailable after save**: confirm the entry is enabled, the model name matches, and client traffic passes through CPA.
- **Requests hit the wrong provider**: check routing rules, model aliases, and provider order.
- **Only some accounts fail**: use Auth Files or Codex Inspection and search by `auth_index`.
- **Cost estimate is wrong**: provider configuration does not set prices. Maintain the matching model in Model Prices.

