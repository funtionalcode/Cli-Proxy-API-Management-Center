# Claude limit resets

The account detail quota tab displays the Claude OAuth reset grants returned by
the upstream. The feature shares the existing account-scoped management
`api-call` transport with quota reads and Codex reset actions. It does not add a
backend endpoint or change the backend's proxy selection.

## Request contract

- Read usage and reset inventory with
  `GET https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1`.
- Read `organization.uuid` from the existing OAuth profile request.
- Only after an operator selects an available grant and confirms, submit one
  `POST https://api.anthropic.com/api/organizations/{organization.uuid}/reset_rate_limits`
  with `program: "cedar_ember"`, the selected `grant_id`, and a fresh UUID
  `request_id`.

This is an upstream client contract, not a stable, publicly documented API.
The wire fields were cross-checked against the public client implementation at
`uwuclxdy/clauth/src/usage/claude_reset.rs` and
`pingdotgg/t3code/apps/server/src/provider/claudeResetCredits.ts`.
The requests carry a Claude CLI User-Agent aligned with the backend's current
`claude-cli/2.1.321 (external, cli)` fingerprint, plus the OAuth beta and CLI
platform headers. The usage query flags alone do not establish CLI eligibility.
Live browser verification and actual
consumption remain operator acceptance checks; automated tests use mocks only.

All reads and writes carry the selected credential's `authIndex`. They use
`Bearer $TOKEN$` for backend-side token resolution and deliberately omit both
`proxyUrl` and `proxy_url` overrides, preserving the account's configured proxy
and the backend's existing fallback policy. Multi-step actions retain the
captured management connection.

## Full and Fable resets

Both kinds use `program: "cedar_ember"` and the same POST endpoint. The selected
`grant_id` chooses the actual reset; no grant ID is hard-coded by kind.
`gives_back_weekly: true` identifies a Fable reset even when its raw `type` is
`"full"`. Otherwise, a declared full reset or a scope containing both `five_hour`
and `seven_day` identifies a Full reset. Unrecognized grants retain the upstream
label and scope rather than being presented as full-week resets.

Each grant displays its own remaining count, expiry, scope, and availability.
The total counts unexpired banked resets separately from usable-now resets:
a usable Full reset and two unavailable Fable resets still show three remaining,
with only one usable now. Fable restores its own allowance and credited weekly
usage without promising to clear the entire weekly limit.

## Safety and results

- Loading, rendering, refreshing, and cancelling never consume a reset.
- The grant is re-read before confirmation. Missing inventory remains unknown,
  rather than being presented as an observed zero.
- Expired, not-yet-started, exhausted, paused, cooling, ineligible, or server-disabled grants
  cannot be submitted. A changed connection or credential invalidates the action.
- Each action submits at most once. HTTP, network, and ambiguous-result failures
  are never automatically retried, because the grant may already be consumed.
- Only an explicit `result: "reset"` without an indeterminate reason counts as
  a new successful reset. `already_used` and other refusals are not success.
- After a submitted request, invalidate old inventory and attempt one read-only
  refresh, including after a lost response. An unsuccessful refresh leaves the
  inventory unknown and tells the operator to check before submitting again.
- Respect the selected grant's scope. A Fable grant is not assumed to clear the
  entire weekly allowance. Gateway cooldown is cleared only after a confirmed
  reset and fresh, fully observed healthy windows. Manual disables are preserved.

## Local verification

Run the Claude service, inventory, transaction hook, and panel tests with Vitest,
then run `npm run type-check` and `npm run build`. These tests intercept requests;
they never call an upstream reset endpoint. Test coverage includes the selected
account and captured connection, omitted proxy overrides, cancellation, duplicate
clicks, stale credentials, partial resets, refusals, and uncertain outcomes.
