# Request Monitoring Troubleshooting

When Dashboard or Monitoring is empty, do not start by refreshing the page or changing filters. First locate the broken link: CPA publishing, Manager Server collection, SQLite insertion, or frontend display.

## Quick Checks

1. Confirm CPA has produced real requests.
2. Confirm CPA usage publishing is enabled.
3. Open Manager Server `/status` and check `collector`, `lastConsumedAt`, `lastInsertedAt`, and `lastError`.
4. Confirm no other Manager Server is consuming the same CPA queue.
5. Confirm `pollIntervalMs` is less than or equal to CPA usage queue retention.

## `/status` Fields

| Field | Meaning | How to read it |
|---|---|---|
| `collector` / `mode` | Current collector state and mode. | Should match `USAGE_COLLECTOR_MODE` or panel configuration. |
| `queue` | CPA usage queue name. | Usually `usage` by default. |
| `lastConsumedAt` | Last time an event was read from the CPA queue. | Empty for a long time means no event has been consumed. |
| `lastInsertedAt` | Last time an event was written to SQLite. | If events are consumed but not inserted, check `lastError` and skipped counts. |
| `totalInserted` | Total inserted events. | Growth means the collection path is working. |
| `totalSkipped` | Total skipped events. | Can be duplicate, invalid, or already processed events. |
| `lastError` | Latest error. | Use it first to locate network, auth, or data format issues. |

## Collection Modes

`USAGE_COLLECTOR_MODE=auto` tries:

1. RESP Pub/Sub.
2. HTTP queue.
3. RESP pop.

Behind a reverse proxy:

- RESP Pub/Sub and RESP pop must connect directly to the CPA API port, usually `8317`.
- HTTP reverse proxies cannot proxy RESP.
- HTTP queue can go through an HTTP proxy.
- If only an HTTP proxy path is available, confirm CPA is at least `v6.10.8+`.

## Retention And Polling

CPA usage queue retention defaults to 60 seconds and is capped at 3600 seconds. `pollIntervalMs` cannot exceed retention.

Typical problems:

- Manager Server was stopped longer than retention, so old events expired and cannot be recovered.
- `pollIntervalMs` is too large, so events expire before the next poll.
- Multiple Manager Servers consume the same queue and one instance removes events first.

## Common Symptoms

### The panel is empty and `lastConsumedAt` is also empty

Check:

- Whether CPA usage publishing is enabled.
- Whether the CPA URL is reachable from Manager Server.
- Whether the CPA Management Key is correct.
- Whether collector mode matches the network path.

### `lastConsumedAt` has a value, but `lastInsertedAt` does not change

Check:

- Whether `lastError` contains SQLite, JSON, or field compatibility errors.
- Whether the SQLite data directory is writable.
- Whether restored `usage.sqlite` and `data.key` do not match.

### Events are missing intermittently

Check:

- Whether retention is too short.
- Whether Manager Server is restarted frequently.
- Whether multiple Manager Servers consume the same queue.
- Whether CPA and Manager Server clocks have a large skew.

## Fix Order

1. Let Manager Server connect directly to CPA `:8317` first to rule out proxy issues.
2. Temporarily set `USAGE_COLLECTOR_MODE` to `auto`.
3. Increase CPA usage queue retention and keep `pollIntervalMs` lower.
4. Ensure only one Manager Server consumes the same CPA queue.
5. If monitoring is still empty, keep `/status`, Manager Server logs, and CPA usage configuration for further diagnosis.
