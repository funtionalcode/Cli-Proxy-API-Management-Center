# Codex Inspection

Codex Inspection checks why Codex accounts cannot serve requests reliably. Compared with Monitoring, it focuses on account state: quota, auth, workspace, reset time, and recoverable actions.

If you only need one failed request, start with [Monitoring](./monitoring.md). If the issue is clearly concentrated on Codex accounts, use this page.

## What It Checks

- Account plan, quota windows, reset time, and remaining quota.
- Whether OAuth tokens expired or became invalid.
- Whether workspace state affects requests.
- Whether the account hit `usage_limit_reached`.
- Whether reauth, enable, disable, or delete actions are needed.

Different accounts may return incomplete data. Missing fields are treated as unknown, not healthy or unhealthy.

## Local And Server Inspection

The page has two modes:

- **Local inspection**: starts from the current browser session. Best for temporary checks and small batches.
- **Server inspection**: submitted to Manager Server. Best for background runs, schedules, history, and centralized action execution.

Before enabling server inspection, check:

1. CPA URL and CPA Management Key are correct.
2. Auth Files contain complete account metadata.
3. `auth_index` is stable.
4. Account action policy matches your expectations, to avoid unintended automatic disable.

## Reading Results

Results are grouped by suggested action:

- **Keep**: no action required.
- **Reauth**: OAuth or auth state is invalid. Go to [OAuth Login](./oauth.md).
- **Disable**: the account should not currently serve requests, often because quota crossed a threshold or state is abnormal.
- **Enable**: the account appears recovered and can be re-enabled.
- **Delete**: only for accounts confirmed invalid and no longer needed.

Do not read only the action. Check reason, evidence, and recent request behavior. For important accounts, disable first and observe before deleting.

## Server Schedule

Server inspection can run at a fixed interval or at specific daily time points. Saved settings normally take effect after the next worker poll.

Scheduled inspection is useful for:

- Routine health checks for many Codex accounts.
- Automatically recovering accounts after cooldown.
- Keeping inspection history and logs.

If you enable automatic actions, start conservatively. Automatically enabling clearly recovered accounts is safer than automatic delete or broad disable.

## Automatic Action Boundaries

Automation should handle clearly recoverable states, such as restoring after quota cooldown. Manually disabled accounts are not restored automatically.

If inspection results disagree with real request behavior, check the Monitoring failure summary first, then Auth Files and OAuth state.

