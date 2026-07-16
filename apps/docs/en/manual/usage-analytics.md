# Usage Analytics

Usage Analytics answers "where did the money go?" and "which requests caused the abnormal pattern?" It uses request-monitoring events and [Model Prices](./model-prices.md). It does not change provider billing.

## Pick The Range First

Start with time range and granularity:

- Today or the last hour is best for a recent incident.
- 7 days or 30 days is better for trend review.
- Custom range is useful for billing periods or incident windows.
- Finer granularity helps find spikes. Coarser granularity helps read trends.

Filters include model, API key, provider, status, auth file, latency, and cache state. Once filters are applied, trend charts, rankings, and preview rows all use the same request set.

## Main Views

- **Overview**: request count, tokens, cost, failure rate, and latency.
- **Model ranking**: the most expensive, most active, or least healthy models.
- **API Key ranking**: callers responsible for cost or failures.
- **Credential ranking**: account-level usage, useful with quota and inspection.
- **Trend charts**: request volume, cost, tokens, and failure rate over time.
- **Anomaly points**: sudden changes in cost, tokens, or failures.
- **Heatmap**: peak and quiet hours for scheduling decisions.
- **Request preview**: jump back to Monitoring for individual requests.

## Cost Spike Workflow

1. Check whether only cost increased, or whether request count and failure rate also increased.
2. Open model ranking to find expensive model concentration.
3. Open API Key ranking to find unusual callers.
4. Open credential ranking to find account or project concentration.
5. Jump to request details and confirm model names, tokens, and caller.

If the model name is an alias or internal name, add the matching entry in [Model Prices](./model-prices.md), or cost will be underestimated or empty.

## Accuracy Boundary

- Provider bills are the source of truth.
- CPAMP estimates cost from request events and model prices.
- If model names are rewritten by clients, providers, or route aliases, maintain the corresponding name in Model Prices.
- Missing token fields can make cost incomplete.
- Requests lost while Manager Server was stopped or queue data expired cannot be reconstructed.

