# Monitoring

Monitoring is the main entry point for request failures. Dashboard tells you something is wrong. Monitoring tells you which request type, account, model, or caller is involved.

Account handling is documented separately in [Account Action Queue](./account-actions.md). This page focuses on request events.

## Availability

Monitoring requires Manager Server collection and CPA usage publishing. Usage features may be unavailable in the CPA-hosted panel compatibility mode or before Manager Server is bound.

If the page says request monitoring is disabled, enable it in [Configuration](./configuration.md) under Manager Server configuration.

## Views

- Account Overview: start here to see whether failures concentrate on one account.
- API Key Summary: see whether one caller key causes unusual traffic or cost.
- Realtime Requests: inspect one request's model, status code, latency, tokens, and failure summary.
- Summary cards: total requests, failures, success rate, latency, and tokens.
- Filters: narrow by time, provider, model, project, account, API key, status, failure type, latency, and cache state.

Failure summaries are sanitized. Raw failure bodies stay in local SQLite and are not exposed through normal APIs or JSONL exports.

## Common Investigation Flow

1. Select the time range first. Use a short range for active incidents and a larger range for trend review.
2. Check summary cards to see whether failures concentrate on a status code or model.
3. Open Account Overview to see whether only a few accounts are unhealthy.
4. Open API Key Summary to find abnormal callers.
5. Open a realtime request row and inspect model, provider, account, latency, tokens, and failure summary.
6. If the failure points to auth or quota, continue with [Auth Files](./auth-files.md), [Quota](./quota.md), or [Codex Inspection](./codex-inspection.md).

## Filters

- **Status**: split successful, failed, and unusual status codes.
- **Provider and model**: find upstream or model-alias mistakes.
- **Account and auth file**: inspect one account over time with `auth_index`.
- **API Key**: find the caller behind traffic or cost spikes.
- **Project, request type, and Trace ID**: reconstruct one business request.
- **Latency and cache state**: inspect slow requests, cache misses, or streaming behavior.

Filters should lead to the next action. Cost issues go to [Usage Analytics](./usage-analytics.md). Auth issues go to [Account Action Queue](./account-actions.md).

## Empty Monitoring

If Monitoring has no data, check this order:

1. Client requests actually go through CPA.
2. CPA usage publishing is enabled.
3. The CPAMP collector is running.
4. CPA usage queue retention is long enough.
5. More than one Manager Server is not consuming the same CPA queue.
6. RESP mode connects directly to CPA `:8317`, not through an HTTP reverse proxy.

See [Request Monitoring Troubleshooting](../troubleshooting/request-monitoring.md).

## Data Boundaries

- Monitoring only shows events CPAMP collected. Expired queue data cannot be recovered.
- Multiple Manager Servers consuming one CPA queue can cause missing data.
- Cost is estimated from model prices, not provider billing.
- Sanitized summaries are useful for troubleshooting, but do not share tokens, management keys, or auth files.
