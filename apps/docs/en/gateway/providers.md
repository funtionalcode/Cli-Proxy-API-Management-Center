# Providers And Compatibility APIs

Providers decide where client requests go. CPA executes the routing; CPAMP reads provider, auth file, model list, request event, and pricing data so it can show monitoring, cost, and account state.

## Common Provider Types

| Type | Purpose | Related CPAMP Pages |
|---|---|---|
| Codex | Codex CLI / Codex API accounts, quota, and request monitoring. | AI Providers, Auth Files, Quota, Codex Inspection. |
| Claude Code | Claude Code accounts and compatible requests. | AI Providers, Auth Files, Monitoring. |
| OpenAI compatible | OpenAI-style relays or self-hosted model services. | AI Providers, Model Prices, Usage Analytics. |
| Gemini / AI Studio | Gemini API or AI Studio integration. | AI Providers, OAuth, Monitoring. |
| Vertex | Google Cloud Vertex AI project access. | AI Providers, Auth Files, Usage Analytics. |
| xAI / Grok / Antigravity | Other provider families supported by CPA. | AI Providers, Monitoring. |

Before saving a provider, verify four things: the base URL, the auth method, the model names exposed to clients, and whether it should bind to an auth file or `auth_index`. If one of these is wrong, Monitoring may only show a failed request without pointing to the exact field.

## Compatibility APIs

Different clients use different compatibility APIs. When configuring clients or reverse proxies, route by path first:

| Path | Purpose | Typical Clients |
|---|---|---|
| `/v1/...` | OpenAI-compatible API. | OpenAI SDK, OpenCode, general model clients. |
| `/v1beta/...` | Gemini-compatible API. | Gemini SDK or compatible tools. |
| `/backend-api/codex/...` | Codex APIs. | Codex CLI. |
| provider callback | OAuth callbacks. | Codex, Claude, Google, Antigravity, and similar OAuth flows. |

Model API paths should go directly to CPA. CPAMP should handle only management and compatibility proxy paths such as `/management.html`, `/usage-service/*`, `/v0/management/*`, `/v0/resource/plugins/*`, and `/models`. See [Reverse Proxy](../deployment/reverse-proxy.md) for a complete Nginx example.

## Model List And Prices

Model prices affect CPAMP cost estimates only. They do not change CPA provider routing or the provider's actual bill. You can edit prices manually or trigger a LiteLLM / OpenRouter sync; syncing calls external price sources only when you start it.

If `/models` returns `412`, do not start with provider debugging. It usually means CPAMP setup is incomplete or missing the CPA URL / CPA Management Key.

## Troubleshooting Order

1. Confirm the provider works in CPA.
2. Check provider and auth file bindings in CPAMP AI Providers.
3. Check Auth Files for manual disables, quota cooldowns, or automation state.
4. Read failure summaries and status codes in Monitoring.
5. Use Logs for gateway runtime details.
