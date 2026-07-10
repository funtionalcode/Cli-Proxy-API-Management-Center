# CPA Manager Plus Full Upstream Sync Design

## Objective

Synchronize the complete `apps/web` functionality from `seakee/CPA-Manager-Plus` `main` at commit `629d08518e963ba7da9f5ee97d4c9e2c059a1c78` into this repository while preserving all local customizations that were added after the previous Plus synchronization point.

The previous synchronization imported `apps/web` from upstream commit `cc63954dfeb5fda2d6f9f7b37437613432630a80` into this repository root. The synchronization therefore treats `cc63954` as the shared upstream baseline, the current local branch as the local side, and `629d085` as the new upstream side.

## User Experience

After the synchronization, users should receive all current CPA Manager Plus web features, including the latest xAI weekly quota display, without losing locally developed monitoring, authentication-file, proxy, provider-weight, logging, plugin, or management-panel behavior.

The application should continue to build a single `dist/management.html` artifact and retain the current repository's standalone frontend workflow.

## Scope

### Included

- The complete upstream change set under `apps/web` from `cc63954` through `629d085`.
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

The 2026-07-10 verification resolved `upstream/main` and `refs/cpa-plus/target` to `629d08518e963ba7da9f5ee97d4c9e2c059a1c78`, kept `refs/cpa-plus/base` at `cc63954dfeb5fda2d6f9f7b37437613432630a80`, and reproduced an `apps/web` manifest of 30 files with 2,616 additions and 300 deletions.

Generate the full binary-safe diff from:

```text
cc63954dfeb5fda2d6f9f7b37437613432630a80
..
629d08518e963ba7da9f5ee97d4c9e2c059a1c78
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
- Plugin management and standalone management-panel output.
- Test exclusion for `.claude/**` worktrees.
- Vite output naming and single-file `management.html` packaging.

This list is a preservation floor, not an exhaustive list. Any local-only commit after `ebe9ba656b19c3adfdb21c9e35d588a628a1f464` remains in scope for preservation when it overlaps upstream files.

## xAI Quota Behavior

The synchronized result must include the current Plus behavior introduced by upstream commit `1d9bd5ff53e25cea46e32761cce6a1f01c371190`:

- Fetch `https://cli-chat-proxy.grok.com/v1/billing?format=credits` for weekly credit usage.
- Fetch `https://cli-chat-proxy.grok.com/v1/billing` for monthly billing and pay-as-you-go data.
- Send the Grok CLI token-auth and client identity headers.
- Merge weekly and monthly responses without losing monthly fallback data.
- Keep monthly data visible when the weekly request fails.
- Display weekly usage percentage, reset time, and product-level usage in quota and monitoring views.

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

## Commit Strategy

Use focused Chinese Conventional Commits with the configured author `zhengyage <zhengyage@magicpipeline.com>`:

1. Upstream synchronization and conflict resolution, split only where a subsystem can be independently green.
2. Generated artifact or lockfile updates when required by the build.
3. Final integration corrections found by full-suite verification.

Each non-trivial commit includes the required `Tests:`, `Constraint:`, `Scope-risk:`, and `Confidence:` sections.

## Acceptance Criteria

- The repository contains the complete `apps/web` delta from `cc63954` to `629d085` or an explicitly documented local equivalent for every upstream change.
- No local post-sync customization is silently removed.
- xAI weekly, monthly, pay-as-you-go, and product usage behavior matches current CPA Manager Plus.
- Existing local monitoring and authentication-file workflows remain covered and passing.
- All final verification commands pass.
- `dist/management.html` is rebuilt successfully and contains the synchronized xAI weekly functionality.
- Unrelated untracked files remain untouched.
