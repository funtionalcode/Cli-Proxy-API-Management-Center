# Quota

Quota answers "can this account continue serving requests now?" It combines auth files, inspection results, failure summaries, response headers, and cooldown records to decide whether an account should pause or recover.

It is about account state, not cost. Use [Usage Analytics](./usage-analytics.md) for cost breakdowns.

## Before Opening It

Quota data depends on auth files and provider responses. Before using this page, confirm:

1. The account exists in [Auth Files](./auth-files.md) and has a stable `auth_index`.
2. Requests are flowing through CPA and recent requests exist.
3. For Codex accounts, run [Codex Inspection](./codex-inspection.md) when needed.

## Data Sources

Quota clues may come from:

- Account information from CPA providers or auth files.
- Codex inspection results.
- Failure summaries such as `usage_limit_reached`.
- Recent response headers that recorded quota or reset times.
- CPAMP quota cooldown records.

Different providers return different data. Unknown means CPAMP did not get enough information. It does not mean the account is unlimited.

## Page Actions

- Search by file name, account, note, or index.
- Sort by plan, quota state, or name.
- Refresh auth files and quota to reload accounts and queryable quota.
- Follow cooldown, reauth, or health hints into Auth Files, OAuth, or inspection pages.
- When comparing accounts, rely on `auth_index` and notes, not only file names.

## Quota Cooldown

When quota cooldown is enabled and a supported account reaches a strict quota signal, CPAMP can temporarily disable the related auth file and recover it after the reset time. Supported signals currently include Codex `usage_limit_reached` with an explicit reset and xAI `subscription:free-usage-exhausted`, which uses the documented rolling 24-hour recovery window.

Cooldown records include a reason code and window kind. Current window kinds are `five_hour`, `weekly`, `monthly`, `rolling_24h`, and `unknown`. For example, if a Codex five-hour limit is exhausted while the weekly limit remains available, only the five-hour window controls the cooldown. After recovery, the credential can re-enter CPA scheduling without waiting for the weekly window.

Notes:

- Enable it with `USAGE_QUOTA_COOLDOWN_ENABLED` or the Configuration switch.
- Auto-restore depends on CPAMP continuing to run.
- While the CPAMP cooldown is active, the credential is disabled in CPA and is not selected for new requests.
- Quota cooldown restores only credentials disabled by that cooldown record. Manual, inspection-owned, or auth-failure disables are not overridden.
- Unstable `auth_index` values can prevent accurate account binding.

Quota cooldown is for clear quota exhaustion. It is not a good tool for expired login, upstream bans, or configuration errors. Use [Account Action Queue](./account-actions.md) or [OAuth Login](./oauth.md) for those.

## Troubleshooting

If an account looks usable but requests fail:

1. Read the failure summary in Monitoring.
2. Check whether Codex Inspection reports quota, workspace, or auth issues.
3. Check Auth Files for manual disabled state or cooldown.
4. Check whether the account action queue has pending candidates.
5. If the page has no quota data, confirm whether that provider supports active quota lookup or only passive header observation.
