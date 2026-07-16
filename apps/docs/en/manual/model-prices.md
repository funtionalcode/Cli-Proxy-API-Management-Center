# Model Prices

Model Prices maintains the price table used by CPAMP cost estimates. It only affects cost displayed in the panel. It does not change provider bills or model routing.

Use [Usage Analytics](./usage-analytics.md) to see where cost went.

## When To Edit Prices

- A model in Usage Analytics has empty or clearly low cost.
- Clients use custom model names, aliases, or internal names.
- Upstream pricing changed.
- You want to use LiteLLM or OpenRouter public prices as the estimate baseline.

The price name must match the model name seen in Monitoring. If client aliases, provider model names, and price-table names differ, add the name recorded in request events.

## Common Actions

- Search model prices.
- Add or edit a model price.
- Delete prices that are no longer used.
- Manually sync from external price sources.
- Return to Usage Analytics and confirm cost is calculated.

External price sync happens only when you trigger it. Check server network and proxy policy before syncing.

## Field Guidance

Different models have different price structures. Common fields include input tokens, output tokens, cache read/write, reasoning tokens, or request-level fees. Follow the provider's published pricing.

If a field has no corresponding price, leave it empty or handle it according to the provider's billing model. Do not fill uncertain values just to make cost look complete.

## Verification

1. Find a request for the target model in [Monitoring](./monitoring.md).
2. Note the model name recorded on the request.
3. Confirm a matching price exists on this page.
4. Refresh [Usage Analytics](./usage-analytics.md) and check estimated cost for that model.

## Accuracy Boundary

- Provider invoices are always authoritative.
- CPAMP estimates from collected requests and the current price table.
- Missing token fields, rewritten model names, or stale prices all affect estimates.
- Multi-currency pricing, tiers, monthly allowances, and free credits may not fit a single price-table row.

