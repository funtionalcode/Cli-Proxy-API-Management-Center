# CPA Manager Plus Full Upstream Sync Design

## Objective

Synchronize the complete `apps/web` functionality from `seakee/CPA-Manager-Plus` `main` at repository target `79d681c5771b536d2517a36cdcafb04f3930402e` into this repository while preserving all local customizations that were added after the previous Plus synchronization point. The latest commit in that target that changes `apps/web` is `43bd407de231f1b316122428074b8be1ab6e8b1f`.

The previous synchronization imported `apps/web` from upstream commit `cc63954dfeb5fda2d6f9f7b37437613432630a80` into this repository root. The synchronization therefore treats `cc63954` as the shared upstream baseline, the current local branch as the local side, and `79d681c5` as the final repository target.

The first execution checkpoint pinned `629d08518e963ba7da9f5ee97d4c9e2c059a1c78`. Upstream advanced repeatedly during execution: the integration added the `28c045a6` bounded-monitoring batch, the configuration/Interactions batch through `88f91180`, the `26b8f166` active-tab analytics batch, and finally the `43bd407d` GPT-5.6 pricing batch. Later commits advanced the repository target to `79d681c5` without further `apps/web` changes.

## User Experience

After the synchronization, users should receive all current CPA Manager Plus web features, including the latest xAI weekly quota display, without losing locally developed monitoring, authentication-file, proxy, provider-weight, logging, plugin, or management-panel behavior.

The application should continue to build a single `dist/management.html` artifact and retain the current repository's standalone frontend workflow.

## Scope

### Included

- The complete upstream change set under `apps/web` from `cc63954` through repository target `79d681c5`, whose latest `apps/web`-changing checkpoint is `43bd407d`.
- Source code, tests, localization, package metadata, Vite configuration, and frontend assets that correspond to this repository's root web application.
- Manual resolution of every overlapping change between upstream and local development.
- Preservation and adaptation of local tests where upstream reorganized the same modules.
- Regeneration and verification of `dist/management.html` through the repository build command.

### Excluded

- `apps/manager-server` and other CPA Manager Plus monorepo packages.
- Replacing this repository with the upstream monorepo layout.
- Deleting or modifying unrelated untracked paths such as `.claude/`, `.firecrawl/`, or `zhujiceping-vps-cn2-summary.html`.
- Rewriting local features merely to resemble upstream code when the existing behavior remains compatible.
- Backend changes in CLIProxyAPIPlus unless frontend verification proves a concrete API incompatibility; any such incompatibility requires a separate scoped change.

## Synchronization Strategy

### 1. Isolated integration branch

Implementation will run in an isolated Git worktree on `codex/sync-cpa-manager-plus-main`. The existing primary checkout and its untracked files remain untouched.

### 2. Reconstruct the upstream delta

Set the configured `upstream` remote explicitly to `seakee/CPA-Manager-Plus`, fetch `main`, and pin the authoritative commits in `refs/cpa-plus/base` and `refs/cpa-plus/target`.

The final 2026-07-11 verification resolved the remote `refs/heads/main`, local `upstream/main`, and `refs/cpa-plus/target` to `79d681c5771b536d2517a36cdcafb04f3930402e`, kept `refs/cpa-plus/base` at `cc63954dfeb5fda2d6f9f7b37437613432630a80`, and reproduced an `apps/web` manifest of 92 files with 5,318 additions and 648 deletions. `git log --oneline 43bd407d..79d681c5 -- apps/web` produces no output, proving that `43bd407d` remains the latest web-changing checkpoint. Earlier 30-, 46-, and 85-file manifests are intermediate checkpoints only.

Generate the full binary-safe diff from:

```text
cc63954dfeb5fda2d6f9f7b37437613432630a80
..
79d681c5771b536d2517a36cdcafb04f3930402e
```

restricted to `apps/web`. Apply it to the repository root with the `apps/web` prefix removed and three-way conflict support enabled.

### 3. Resolve conflicts by behavior

For every conflict:

1. Identify the upstream behavior and its upstream tests.
2. Identify the local behavior and its local tests or call sites.
3. Preserve both when they are independent.
4. Prefer the upstream architecture when it is required by new upstream consumers.
5. Reapply local behavior through the upstream architecture rather than restoring obsolete files or duplicated implementations.
6. Add or update a focused regression test whenever conflict resolution requires judgment not already covered by either side.

Conflict resolution must not use blanket `ours` or `theirs` selection for source directories.

## Local Customization Preservation

The following locally developed areas are explicit preservation requirements:

- Request-monitoring pagination and lazy aggregation behavior.
- Monitoring model-price and analytics adapters.
- Authentication-file management extensions, including inline quota state, proxy and prefix editing, JSON paste flows, status/cooldown handling, and local UI state.
- Proxy propagation during OAuth login.
- Provider priority and weight editing.
- Formatted and structured log behavior.
- Plugin management, including the multi-step installation safety gate, and standalone management-panel output.
- Test exclusion for `.claude/**` worktrees.
- Vite output naming and single-file `management.html` packaging.

This list is a preservation floor, not an exhaustive list. Any local-only commit after `ebe9ba656b19c3adfdb21c9e35d588a628a1f464` remains in scope for preservation when it overlaps upstream files.

## Bounded Monitoring Performance

The bounded-monitoring checkpoint `2337f76` includes the upstream `28c045a6` monitoring memory-usage batch, adapted to the local monitoring architecture:

- Keep the local standalone `events_page` request separate from summary and aggregate `include` requests so event pagination remains a fast path and expensive aggregates remain lazy.
- Retain only the newest 2,000 realtime events, stop pagination at that cap, and show the localized retention state instead of implying that all upstream events were loaded.
- Keep at most four presentation snapshots and remove event rows from cached snapshots so changing scopes cannot retain large event arrays.
- Thread `AbortSignal` through monitoring analytics requests, abort superseded or unmounted requests, suspend automatic polling while the document is hidden, and use 30 seconds as the default polling interval.
- Use the lightweight model-price usage-summary endpoint instead of expanding the full usage event payload, while preserving saved prices, candidate selection, manual edits, filters, and the local model-price management workflow.

## xAI Quota Behavior

The synchronized result must include the current Plus behavior introduced by upstream commit `1d9bd5ff53e25cea46e32761cce6a1f01c371190`:

- Fetch `https://cli-chat-proxy.grok.com/v1/billing?format=credits` for weekly credit usage.
- Fetch `https://cli-chat-proxy.grok.com/v1/billing` for monthly billing and pay-as-you-go data.
- Send the Grok CLI token-auth and client identity headers.
- Merge weekly and monthly responses without losing monthly fallback data.
- Keep monthly data visible when the weekly request fails.
- Display weekly usage percentage, reset time, and product-level usage in quota and monitoring views.

## GPT-5.6 Pricing Behavior

- Provide official fallback prices for `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.
- Apply Priority/Fast multiplier `2` and long-context multipliers above 272,000 input tokens.
- Use the resolved model to choose GPT-5.6 family behavior while allowing a requested alias to supply configured prices.
- Derive missing cache-read and cache-creation prices from prompt price, while preserving explicitly configured zeroes.
- Expose cache-read and cache-creation values in the model-price editor and all four shipped locales.

## Usage Analytics Request Scoping

- Build the minimum analytics include payload required by the active tab.
- Keep filter selectors in an independent request scope that does not include `activeTab`.
- Refresh main data and selectors together on manual refresh without coupling selector failures to the page error.
- Merge lightweight `models` and `api_key_hashes` selector values into the stable option cache.

## Testing Strategy

Upstream tests are treated as executable requirements. Integration proceeds in behavior-focused batches:

1. Apply or adapt the upstream tests for a subsystem and run them against the current local implementation to establish a failing baseline.
2. Apply and resolve the corresponding production changes.
3. Run the focused tests until green.
4. Run affected local regression tests before moving to the next subsystem.

For conflicts where upstream tests already pass because of superficially similar local behavior, add a focused assertion that distinguishes the new upstream requirement before resolving the production code.

The final verification set is:

```bash
npm test -- --reporter=dot
npm run type-check
npm run lint
npm run build
git diff --check
```

The generated `dist/management.html` must contain the xAI weekly billing URL and token-auth header strings.

## Error Handling and Compatibility

- A failed weekly xAI billing request must fall back to valid monthly billing data.
- If both xAI billing requests fail, the existing quota error presentation remains visible.
- Existing API-call token substitution remains the credential boundary; access tokens must not be exposed to the browser outside the existing management API request flow.
- Existing provider aliases (`xai`, `x-ai`, and `grok`) remain supported.
- Localization keys added upstream must be present in all currently shipped locales.
- If an older Manager Server returns `404`, `405`, or `method_not_allowed` for the model-price usage-summary endpoint, fall back to the existing lightweight `model_stats` analytics include. Do not fall back to the full `/usage` payload, and do not invoke `model_stats` when the summary endpoint succeeds.
- Preserve the local quota-source presentation correction: API-only, header-only, and mixed API/header entries show the correct source label and their distinct fetched/recorded timestamps.
- Preserve detailed cache token columns in the expanded account table while keeping the compact account card metric set intentionally smaller.

## Commit Strategy

Use focused Chinese Conventional Commits with the configured author `zhengyage <zhengyage@magicpipeline.com>`:

1. Upstream synchronization and conflict resolution, split only where a subsystem can be independently green.
2. Generated artifact or lockfile updates when required by the build.
3. Final integration corrections found by full-suite verification.

Each non-trivial commit includes the required `Tests:`, `Constraint:`, `Scope-risk:`, and `Confidence:` sections.

## Acceptance Criteria

- The repository contains the complete 92-file `apps/web` delta from `cc63954` to repository target `79d681c5`, totaling 5,318 additions and 648 deletions, or an explicitly documented local equivalent for every upstream change; `43bd407d` is recorded as the latest web-changing checkpoint.
- The 108-path branch manifest contains all 92 upstream paths, zero missing paths, and exactly 16 documented local extras.
- No local post-sync customization is silently removed.
- xAI weekly, monthly, pay-as-you-go, and product usage behavior matches current CPA Manager Plus.
- Monitoring preserves the dual-request lazy aggregation architecture, the 2,000-event cap, four snapshot cache limit, abort propagation, hidden-page polling suspension, 30-second default refresh, localized retention state, and lightweight summary/model-stats compatibility path.
- GPT-5.6 official/configured prices, cache tiers, resolved-model behavior, service tiers, and long-context rules match the synchronized upstream tests.
- Usage Analytics tab changes scope only the main request; selector scope, error isolation, manual refresh, and stable option merging remain covered.
- Existing local monitoring and authentication-file workflows remain covered and passing.
- All final verification commands pass.
- `dist/management.html` is rebuilt successfully and contains the synchronized xAI weekly functionality.
- Unrelated untracked files remain untouched.
