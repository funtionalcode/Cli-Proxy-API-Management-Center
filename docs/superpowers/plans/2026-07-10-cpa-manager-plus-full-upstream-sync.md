# CPA Manager Plus Full Upstream Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the complete CPA Manager Plus `apps/web` delta from `cc63954` to repository target `05174f66` into the local standalone frontend while preserving every local customization and rebuilding `dist/management.html`; `2337f76` is the latest checkpoint in that target that changes `apps/web`.

**Architecture:** Fetch the authoritative Plus commits into local integration refs, apply upstream test changes before production changes, and integrate production files in behavior-focused batches plus a final upstream-refresh addendum. Resolve three-way conflicts against the current local branch, preserve local-only behavior through the new upstream structures, and audit the final file set against the authoritative upstream delta.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Zustand, SCSS modules, Git three-way patch application.

---

## File Map

The final upstream delta modifies 46 root-web files after stripping the `apps/web/` prefix.

- Provider controls and layout: `src/components/providers/ProviderTable/*`, `src/features/aiProviders/*`, `src/features/authFiles/AuthFilesPage.module.scss`
- Quota and monitoring: `src/components/quota/quotaConfigs.ts`, `src/features/monitoring/**`, `src/types/quota.ts`, `src/utils/quota/**`, `src/utils/usageHeaderSnapshots*`
- Plugin releases: `src/features/plugins/PluginStorePage*`, `src/features/plugins/pluginReleaseVersions*`
- Latest bounded-monitoring performance batch: `src/features/demo/demoFixtures.empty.ts`, `src/features/demo/demoFixtures.ts`, `src/features/monitoring/MonitoringCenterPage.tsx`, `src/features/monitoring/ModelPricesPage.tsx`, `src/features/monitoring/components/RealtimeEventsPanel*`, `src/features/monitoring/hooks/useMonitoringAnalytics*`, `src/features/monitoring/hooks/useMonitoringData*`, `src/features/monitoring/model/modelPricesPageModel*`, `src/features/monitoring/model/types.ts`, `src/features/monitoring/monitoringCenterUiState*`, and `src/services/api/usageService.ts`
- Shared localization and scripts: retention and other synchronized keys in `src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`, plus `package.json`
- Generated artifact: `dist/management.html`

Local behavior that must survive conflicts is defined in `docs/superpowers/specs/2026-07-10-cpa-manager-plus-full-upstream-sync-design.md`.

### Task 1: Create the isolated integration worktree and establish a green baseline

**Files:**
- Read: `package.json`
- Read: `package-lock.json`
- Read: `vite.config.ts`
- Read: `docs/superpowers/specs/2026-07-10-cpa-manager-plus-full-upstream-sync-design.md`

- [ ] **Step 1: Return the primary checkout to `master` and create the isolated worktree**

```bash
git switch master
mkdir -p /Users/funtional/.config/superpowers/worktrees/Cli-Proxy-API-Management-Center
git worktree add \
  /Users/funtional/.config/superpowers/worktrees/Cli-Proxy-API-Management-Center/sync-cpa-manager-plus-main \
  codex/sync-cpa-manager-plus-main
```

Expected: the global isolated worktree is created and the primary checkout's unrelated untracked files remain unchanged.

- [ ] **Step 2: Install dependencies without rewriting the lockfile**

```bash
npm ci
```

Expected: exit code 0 and no tracked-file changes.

- [ ] **Step 3: Run the baseline test suite**

```bash
npm test -- --reporter=dot
```

Expected: all current local tests pass; `.claude/**` remains excluded by the existing package script.

- [ ] **Step 4: Run baseline static verification**

```bash
npm run type-check
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0. If a baseline command fails, record the exact pre-existing failure before applying upstream patches.

### Task 2: Fetch the authoritative upstream commits and apply upstream tests first

**Files:**
- Modify: `src/components/providers/ProviderTable/ProviderTable.test.tsx`
- Modify: `src/features/monitoring/accountOverviewCardMetrics.test.ts`
- Modify: `src/features/monitoring/accountOverviewState.test.ts`
- Modify: `src/features/monitoring/model/monitoringCenterPageModel.test.ts`
- Create: `src/features/plugins/pluginReleaseVersions.test.ts`
- Modify: `src/utils/quota/providerRequests.test.ts`
- Modify: `src/utils/usageHeaderSnapshots.test.ts`

- [ ] **Step 1: Fetch the Plus base and target commits into namespaced refs**

```bash
git remote set-url upstream https://github.com/seakee/CPA-Manager-Plus.git
git fetch --no-tags upstream --prune
git update-ref refs/cpa-plus/base cc63954dfeb5fda2d6f9f7b37437613432630a80
git update-ref refs/cpa-plus/target upstream/main
git rev-parse refs/cpa-plus/base refs/cpa-plus/target upstream/main
```

Expected after the final refresh: `refs/cpa-plus/base` resolves to `cc63954dfeb5fda2d6f9f7b37437613432630a80`, while the remote `refs/heads/main`, `refs/cpa-plus/target`, and `upstream/main` all resolve to `05174f662660e488e5e5a338ab5070a79e4bc79d`.

- [ ] **Step 2: Generate the complete upstream manifest**

```bash
git diff --name-status refs/cpa-plus/base..refs/cpa-plus/target -- apps/web \
  | sed 's#apps/web/##' > /tmp/cpa-plus-web-name-status.txt
git diff --stat refs/cpa-plus/base..refs/cpa-plus/target -- apps/web \
  > /tmp/cpa-plus-web-stat.txt
```

Expected: the final manifest lists 46 files, including the new plugin release-version module and tests plus the bounded-monitoring performance files.

Execution verification on 2026-07-10 first reached `629d08518e963ba7da9f5ee97d4c9e2c059a1c78` as an intermediate checkpoint. Upstream advanced during execution; the later re-fetch described in Task 5A added the `28c045a6` web performance commit and reached `2337f76cf54acd8d50de21e2a754abcd9b804c58`, the latest `apps/web`-changing checkpoint. Five subsequent dashboard-rollup backend, configuration, SQLite, and documentation commits advanced the final repository target to `05174f662660e488e5e5a338ab5070a79e4bc79d` without changing `apps/web`. The final manifest therefore remains 46 files with 3,043 additions and 464 deletions.

- [ ] **Step 3: Build a test-only upstream patch**

```bash
git diff --binary refs/cpa-plus/base..refs/cpa-plus/target -- \
  'apps/web/**/*.test.ts' \
  'apps/web/**/*.test.tsx' \
  > /tmp/cpa-plus-tests.patch
git apply --3way --index -p3 /tmp/cpa-plus-tests.patch
```

Expected: cleanly applied files are staged; overlapping local test files may enter a three-way conflict.

- [ ] **Step 4: Resolve test conflicts without weakening either side**

For each conflicted test file, keep all local regression cases and add the upstream cases. In particular:

```text
ProviderTable.test.tsx:
  preserve local weight-edit coverage
  add upstream inline-priority and recent-status layout coverage

providerRequests.test.ts:
  preserve local Antigravity and provider request coverage
  add xAI weekly/monthly merge, fallback, official-header, and dual-failure coverage

monitoringCenterPageModel.test.ts:
  preserve local monitoring aggregation expectations
  add xAI weekly/product rows and quota-tooltip expectations
```

Expected: `git diff --name-only --diff-filter=U` prints nothing.

- [ ] **Step 5: Unstage the imported test batch while keeping its working-tree changes**

```bash
git restore --staged .
```

Expected: the imported tests remain modified or untracked, but `git diff --cached --name-only` prints nothing.

- [ ] **Step 6: Verify the new upstream tests fail for missing production behavior**

```bash
npx vitest run \
  src/components/providers/ProviderTable/ProviderTable.test.tsx \
  src/features/plugins/pluginReleaseVersions.test.ts \
  src/features/monitoring/model/monitoringCenterPageModel.test.ts \
  src/utils/quota/providerRequests.test.ts \
  src/utils/usageHeaderSnapshots.test.ts \
  --reporter=dot
```

Expected: failures identify missing inline-priority behavior, the missing plugin release-version module, missing xAI weekly fields/requests, or missing cross-workspace quota guards.

- [ ] **Step 7: Add a compile-only plugin helper scaffold, then re-run the plugin test to obtain an assertion failure**

Create `src/features/plugins/pluginReleaseVersions.ts` with the exact upstream exports but deliberately empty behavior:

```ts
export interface PluginReleaseVersion {
  tagName: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  htmlUrl: string;
  assetNames: string[];
}

export const getGitHubRepositorySlug = (_repository: string): string => '';
export const buildGitHubReleasesPageURL = (_repository: string): string => '';
export const isValidManualReleaseTag = (_value: string): boolean => false;
export const normalizePluginReleaseVersions = (_value: unknown): PluginReleaseVersion[] => [];
export const fetchPluginReleaseVersions = async (
  _repository: string
): Promise<PluginReleaseVersion[]> => [];
```

```bash
npx vitest run src/features/plugins/pluginReleaseVersions.test.ts --reporter=dot
```

Expected: the test loads successfully and fails assertions because the scaffold does not implement the upstream behavior.

### Task 3: Integrate provider priority controls and layout fixes while preserving local weight controls

**Files:**
- Modify: `package.json`
- Modify: `src/components/providers/ProviderTable/ProviderTable.module.scss`
- Modify: `src/components/providers/ProviderTable/ProviderTable.tsx`
- Modify: `src/features/aiProviders/AiProvidersPage.module.scss`
- Modify: `src/features/aiProviders/AiProvidersPage.tsx`
- Modify: `src/features/authFiles/AuthFilesPage.module.scss`
- Test: `src/components/providers/ProviderTable/ProviderTable.test.tsx`

- [ ] **Step 1: Generate and apply the provider production patch**

```bash
git diff --binary refs/cpa-plus/base..refs/cpa-plus/target -- \
  apps/web/package.json \
  apps/web/src/components/providers/ProviderTable/ProviderTable.module.scss \
  apps/web/src/components/providers/ProviderTable/ProviderTable.tsx \
  apps/web/src/features/aiProviders/AiProvidersPage.module.scss \
  apps/web/src/features/aiProviders/AiProvidersPage.tsx \
  apps/web/src/features/authFiles/AuthFilesPage.module.scss \
  > /tmp/cpa-plus-provider.patch
git apply --3way --index -p3 /tmp/cpa-plus-provider.patch
```

Expected: conflicts occur only where local priority/weight controls or local layout rules overlap upstream.

- [ ] **Step 2: Resolve provider behavior conflicts**

The resolved `ProviderTable` must expose both local weight editing and upstream inline priority editing. Keep upstream's simplified priority state flow and recent-status non-overlap layout, but retain the local weight value, save action, validation, and API update behavior.

The resolved package scripts must include upstream bundle scripts while preserving local test isolation:

```json
{
  "build:bundle": "vite build",
  "build:demo:bundle": "vite build --mode demo",
  "test": "vitest run --exclude \".claude/**\""
}
```

Expected: no duplicate priority editor, no removed weight editor, and no `.claude` test scanning regression.

- [ ] **Step 3: Run the provider RED tests to GREEN**

```bash
npx vitest run src/components/providers/ProviderTable/ProviderTable.test.tsx --reporter=dot
npm run type-check
```

Expected: provider tests and type checking pass.

- [ ] **Step 4: Commit the provider integration**

```bash
git restore --staged .
git add package.json src/components/providers src/features/aiProviders \
  src/features/authFiles/AuthFilesPage.module.scss
git commit
```

Commit subject: `feat(providers): 同步上游优先级编辑并保留权重配置`

Commit body must record the focused tests and the local weight-preservation constraint.

### Task 4: Integrate the plugin release version picker

**Files:**
- Modify: `src/features/plugins/PluginStorePage.module.scss`
- Modify: `src/features/plugins/PluginStorePage.tsx`
- Create: `src/features/plugins/pluginReleaseVersions.ts`
- Test: `src/features/plugins/pluginReleaseVersions.test.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Apply the plugin production patch without the locale patch**

```bash
git diff --binary refs/cpa-plus/base..refs/cpa-plus/target -- \
  apps/web/src/features/plugins/PluginStorePage.module.scss \
  apps/web/src/features/plugins/PluginStorePage.tsx \
  apps/web/src/features/plugins/pluginReleaseVersions.ts \
  > /tmp/cpa-plus-plugins.patch
git apply --3way --index -p3 /tmp/cpa-plus-plugins.patch
```

Expected: the new release loader and version-selection UI are present without replacing local plugin-store behavior.

- [ ] **Step 2: Resolve plugin page conflicts**

Preserve local plugin configuration, install/update actions, and page layout. Add the upstream release list loader, selected-version state, version picker, fallback to latest release, and loading/error behavior through the existing page structure.

Expected exported API in `pluginReleaseVersions.ts`:

```ts
export interface PluginReleaseVersion {
  tagName: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  htmlUrl: string;
  assetNames: string[];
}

export const getGitHubRepositorySlug: (repository: string) => string;
export const buildGitHubReleasesPageURL: (repository: string) => string;
export const isValidManualReleaseTag: (value: string) => boolean;
export const normalizePluginReleaseVersions: (value: unknown) => PluginReleaseVersion[];

export async function fetchPluginReleaseVersions(
  repository: string
): Promise<PluginReleaseVersion[]>;
```

- [ ] **Step 3: Merge plugin locale keys into all four locale files**

Apply only the plugin-related keys from the upstream locale diff. Do not replace complete locale objects, because the local files contain post-sync monitoring and proxy strings.

- [ ] **Step 4: Run plugin tests to GREEN**

```bash
npx vitest run src/features/plugins/pluginReleaseVersions.test.ts --reporter=dot
npm run type-check
```

Expected: plugin release parsing, sorting, deduplication, and page types pass.

- [ ] **Step 5: Commit the plugin integration**

```bash
git restore --staged .
git add src/features/plugins src/i18n/locales
git commit
```

Commit subject: `feat(plugins): 同步上游插件版本选择功能`

### Task 5: Integrate upstream quota, monitoring, and xAI weekly usage behavior

**Files:**
- Modify: `src/components/quota/quotaConfigs.ts`
- Modify: `src/features/monitoring/accountOverviewCardMetrics.test.ts`
- Modify: `src/features/monitoring/accountOverviewState.test.ts`
- Modify: `src/features/monitoring/accountOverviewState.ts`
- Modify: `src/features/monitoring/components/AccountOverviewCard.tsx`
- Modify: `src/features/monitoring/components/accountOverviewPresentation.ts`
- Modify: `src/features/monitoring/model/monitoringCenterPageModel.test.ts`
- Modify: `src/features/monitoring/model/monitoringCenterPageModel.ts`
- Modify: `src/features/monitoring/styles/_monitoring-account-overview.scss`
- Modify: `src/types/quota.ts`
- Modify: `src/utils/quota/constants.ts`
- Modify: `src/utils/quota/providerRequests.test.ts`
- Modify: `src/utils/quota/providerRequests.ts`
- Modify: `src/utils/usageHeaderSnapshots.test.ts`
- Modify: `src/utils/usageHeaderSnapshots.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Apply the quota and monitoring production patch without locale files**

```bash
git diff --binary refs/cpa-plus/base..refs/cpa-plus/target -- \
  apps/web/src/components/quota/quotaConfigs.ts \
  apps/web/src/features/monitoring \
  ':(exclude)apps/web/src/features/monitoring/**/*.test.ts' \
  ':(exclude)apps/web/src/features/monitoring/**/*.test.tsx' \
  apps/web/src/types/quota.ts \
  apps/web/src/utils/quota/constants.ts \
  apps/web/src/utils/quota/providerRequests.ts \
  apps/web/src/utils/usageHeaderSnapshots.ts \
  > /tmp/cpa-plus-quota-monitoring.patch
git apply --3way --index -p3 /tmp/cpa-plus-quota-monitoring.patch
```

Expected: three-way conflicts are limited to locally extended types/constants and monitoring presentation code.

- [ ] **Step 2: Resolve xAI types and request behavior**

The resolved constants must contain:

```ts
export const XAI_BILLING_WEEKLY_URL =
  'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
export const XAI_BILLING_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
export const XAI_GROK_CLIENT_VERSION = '0.2.91';
export const XAI_GROK_USER_AGENT =
  'grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)';

export const XAI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': XAI_GROK_CLIENT_VERSION,
  accept: '*/*',
  'user-agent': XAI_GROK_USER_AGENT,
};
```

`fetchXaiQuota` must issue weekly and monthly requests with `Promise.allSettled`, merge valid summaries, fall back to monthly when weekly fails, and throw the weekly error when both requests fail.

- [ ] **Step 3: Resolve quota and monitoring presentation conflicts**

Preserve the local request-monitoring model and its pagination/lazy aggregation boundaries. Add upstream weekly and product usage rows to the existing xAI account view, use upstream quota tooltip metadata, and add the cross-workspace guard for Codex usage-header snapshots.

Local preservation corrections applied during this task must also remain in place:

- API-only, usage-header-only, and mixed API/header quota entries expose the correct source tooltip and separate fetched/recorded timestamps.
- The expanded account table retains cached-token, cache-creation-token, and cache-read-token details while the compact card keeps its intentionally smaller metric set.

The xAI presentation must include:

```text
weekly limit -> creditUsagePercent + currentPeriod.end
product rows -> productUsage[].product + productUsage[].usagePercent
monthly credits -> monthlyLimit/used fields
pay as you go -> onDemandCap/onDemandUsed fields
```

- [ ] **Step 4: Merge remaining quota and monitoring locale keys**

Add upstream keys for weekly xAI usage, product usage, reset labels, quota source tooltips, monitoring filter context, and pay-as-you-go display to all four locales while preserving all local-only keys.

- [ ] **Step 5: Run quota and monitoring tests to GREEN**

```bash
npx vitest run \
  src/utils/quota/providerRequests.test.ts \
  src/utils/usageHeaderSnapshots.test.ts \
  src/features/monitoring/accountOverviewCardMetrics.test.ts \
  src/features/monitoring/accountOverviewState.test.ts \
  src/features/monitoring/model/monitoringCenterPageModel.test.ts \
  --reporter=dot
npm run type-check
```

Expected: all focused tests pass, including xAI weekly fallback and Codex cross-workspace isolation.

- [ ] **Step 6: Run local monitoring regression tests**

```bash
npx vitest run \
  src/features/monitoring/hooks/useMonitoringData.test.ts \
  src/features/monitoring/model/analyticsAdapters.test.ts \
  src/features/monitoring/model/modelPricesPageModel.test.ts \
  --reporter=dot
```

Expected: local monitoring pagination, analytics, and price behavior remain green.

- [ ] **Step 7: Commit the quota and monitoring integration**

```bash
git restore --staged .
git add src/components/quota src/features/monitoring src/types/quota.ts \
  src/utils/quota src/utils/usageHeaderSnapshots.ts \
  src/utils/usageHeaderSnapshots.test.ts src/i18n/locales
git commit
```

Commit subject: `feat(quota): 同步上游额度与监控更新`

### Task 5A: Re-fetch upstream and integrate bounded monitoring memory usage (executed addendum)

This addendum records the independent batch executed after upstream `main` advanced beyond the intermediate `629d085` checkpoint. It reached the latest `apps/web`-changing checkpoint at `2337f76`; the final repository target later advanced to `05174f66` through five commits outside `apps/web`. It does not replace the earlier feature batches.

**Test-first files:**
- Modify: `src/features/monitoring/components/RealtimeEventsPanel.test.tsx`
- Modify: `src/features/monitoring/hooks/useMonitoringAnalytics.test.tsx`
- Modify: `src/features/monitoring/hooks/useMonitoringData.test.ts`
- Modify: `src/features/monitoring/model/modelPricesPageModel.test.ts`
- Modify: `src/features/monitoring/monitoringCenterUiState.test.ts`

**Production and fixture files:**
- Modify: `src/features/demo/demoFixtures.empty.ts`
- Modify: `src/features/demo/demoFixtures.ts`
- Modify: `src/features/monitoring/MonitoringCenterPage.tsx`
- Modify: `src/features/monitoring/ModelPricesPage.tsx`
- Modify: `src/features/monitoring/components/RealtimeEventsPanel.tsx`
- Modify: `src/features/monitoring/hooks/useMonitoringAnalytics.ts`
- Modify: `src/features/monitoring/hooks/useMonitoringData.ts`
- Modify: `src/features/monitoring/model/modelPricesPageModel.ts`
- Modify: `src/features/monitoring/model/types.ts`
- Modify: `src/features/monitoring/monitoringCenterUiState.ts`
- Modify: `src/services/api/usageService.ts`
- Modify: `src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`

- [x] **Step 1: Re-fetch the authoritative remote and repin the target**

```bash
git ls-remote upstream refs/heads/main
git fetch upstream main
git update-ref refs/cpa-plus/target upstream/main
git rev-parse refs/cpa-plus/target upstream/main
```

Execution evidence: after the final re-fetch, the remote branch, `upstream/main`, and `refs/cpa-plus/target` resolved to `05174f662660e488e5e5a338ab5070a79e4bc79d`. The new web delta was introduced by `28c045a6` and ends at web checkpoint `2337f76cf54acd8d50de21e2a754abcd9b804c58`; `git diff --quiet 2337f76..05174f66 -- apps/web` confirms that the five later commits are outside `apps/web`.

- [x] **Step 2: Import and run the five performance tests before production changes**

```bash
npx vitest run \
  src/features/monitoring/components/RealtimeEventsPanel.test.tsx \
  src/features/monitoring/hooks/useMonitoringAnalytics.test.tsx \
  src/features/monitoring/hooks/useMonitoringData.test.ts \
  src/features/monitoring/model/modelPricesPageModel.test.ts \
  src/features/monitoring/monitoringCenterUiState.test.ts \
  --reporter=dot
```

The tests define the 2,000-event retention limit, event-free presentation snapshots, request cancellation, lightweight model-price summary, and 30-second default refresh behavior.

- [x] **Step 3: Integrate the bounded-memory production behavior while preserving local monitoring boundaries**

The resolved implementation keeps the standalone `events_page` hook and the separate summary/aggregate include hook, caps retained realtime events at the newest 2,000, caches at most four presentation snapshots without event rows, passes `AbortSignal` through monitoring analytics, pauses automatic polling while the document is hidden, changes the default interval to 30 seconds, adds the localized retention message, and uses the lightweight model-price usage-summary endpoint.

- [x] **Step 4: Add the local old-server compatibility fallback**

When the usage-summary endpoint returns `404`, `405`, or `method_not_allowed`, enable the existing lightweight `model_stats` analytics include with its fixed range and 60-second throttle. Keep this fallback disabled after a successful summary response, and never fall back to the full `/usage` payload.

- [x] **Step 5: Verify and commit the refresh batch**

Verification covered the five focused tests, the complete monitoring test directory, usage-service tests, type checking, focused lint, four-locale JSON/key checks, `npm run build:bundle`, and `git diff --check`.

Executed commits:

- `e6c857ac perf(monitoring): 同步上游内存占用优化`
- `292de1c5 fix(model-prices): 兼容旧版轻量统计接口`

### Task 6: Audit completeness against the full upstream delta

**Files:**
- Inspect: `/tmp/cpa-plus-web-name-status-latest.txt`
- Inspect: all files changed on the integration branch

- [ ] **Step 1: List upstream files not represented in the local branch diff**

```bash
sed 's/^[AMD][[:space:]]*//' /tmp/cpa-plus-web-name-status-latest.txt | sort \
  > /tmp/cpa-plus-upstream-files.txt
git diff --name-only master...HEAD | sort > /tmp/cpa-plus-local-files.txt
comm -23 /tmp/cpa-plus-upstream-files.txt /tmp/cpa-plus-local-files.txt
```

Expected final evidence: the repository target is `05174f66`, the latest web-changing checkpoint is `2337f76`, and their `apps/web` diff is empty. The upstream set contains 46 paths, the branch set contains 50 paths, and `comm -23` prints nothing. The four branch-only paths are exactly the two synchronization documents, `src/features/monitoring/accountOverviewCardMetrics.ts`, and `src/features/monitoring/components/accountOverviewPresentation.test.ts`. If the command prints missing paths, verify every printed path already matches the target with this exact audit loop:

```bash
comm -23 /tmp/cpa-plus-upstream-files.txt /tmp/cpa-plus-local-files.txt \
  | while IFS= read -r path; do
      if ! git cat-file -e "HEAD:$path" 2>/dev/null; then
        printf 'missing local path: %s\n' "$path"
        continue
      fi
      if ! git diff --quiet \
        "refs/cpa-plus/target:apps/web/$path" \
        "HEAD:$path"; then
        printf 'unaccounted upstream delta: %s\n' "$path"
      fi
    done
```

Expected: the audit loop prints nothing.

- [ ] **Step 2: Check for unresolved conflicts and accidental upstream-path imports**

```bash
git diff --name-only --diff-filter=U
find . -path './.git' -prune -o -path './apps/web*' -print
rg -n '^(<<<<<<<|=======|>>>>>>>)' src package.json vite.config.ts
```

Expected: no unresolved files, no imported `apps/web` tree, and no conflict markers.

- [ ] **Step 3: Verify local preservation requirements**

```bash
rg -n 'events_page|include.*summary|include.*events' src/features/monitoring
rg -n '2_000|MONITORING_PRESENTATION_CACHE_LIMIT|AbortController|visibilityState|30000' \
  src/features/monitoring
rg -n 'usage-summary|model_stats|method_not_allowed' \
  src/features/monitoring src/services/api/usageService.ts
rg -n 'weight|priority' src/components/providers src/features/aiProviders
rg -n 'pluginReleaseVersions|PluginInstallGateModal|gate_step3_action' src/features/plugins
rg -n 'x-xai-token-auth|x-grok-client-version' src/utils/quota
rg -n '\.claude/\*\*' package.json
rg -n 'management\.html' vite.config.ts
rg -n 'proxy|authIndex|OAuth' src/features/authFiles src/features/aiProviders src/features/oauth
```

Expected: the dual monitoring hooks and lazy aggregation, bounded-memory behavior, lightweight summary fallback, weight and priority controls, plugin gate, official xAI headers, test exclusion, single-file output, and local authentication/proxy workflows are all still present.

### Task 7: Run full verification and rebuild the deliverable

**Files:**
- Update if generated: `package-lock.json`
- Generate but do not track: `dist/management.html`

- [ ] **Step 1: Reconcile dependencies**

```bash
npm install --package-lock-only
npm ci
```

Expected: the lockfile changes only if required by the synchronized `package.json`.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test -- --reporter=dot
```

Expected: all tests pass with zero failures and `.claude/**` is excluded.

- [ ] **Step 3: Run static checks**

```bash
npm run type-check
npm run lint
git diff --check
```

Expected: all commands exit 0 without errors.

- [ ] **Step 4: Build and inspect the management panel**

```bash
npm run build
test -s dist/management.html
rg -n 'billing\\?format=credits|x-xai-token-auth|x-grok-client-version' dist/management.html
```

Expected: `dist/management.html` is non-empty and contains all three xAI weekly request markers.

- [ ] **Step 5: Review the final diff for local feature loss**

```bash
git diff --stat master...HEAD
git diff --check master...HEAD
git status --short
```

Expected: only planned tracked files are changed; no unrelated untracked files were copied into the worktree.

- [ ] **Step 6: Commit the lockfile correction when required**

```bash
git add package-lock.json
git commit
```

Commit subject: `chore(build): 更新管理面板同步产物`

Skip this commit when `package-lock.json` is unchanged. `dist/management.html` is ignored and remains a verified local build artifact rather than a committed file.

### Task 8: Final completion audit

**Files:**
- Inspect: `docs/superpowers/specs/2026-07-10-cpa-manager-plus-full-upstream-sync-design.md`
- Inspect: `docs/superpowers/plans/2026-07-10-cpa-manager-plus-full-upstream-sync.md`

- [ ] **Step 1: Check every acceptance criterion against evidence**

Record the evidence for:

```text
remote, upstream/main, and repository target pinned to 05174f662660e488e5e5a338ab5070a79e4bc79d
latest apps/web-changing checkpoint recorded as 2337f76cf54acd8d50de21e2a754abcd9b804c58, with no apps/web diff through the repository target
complete 46-file / 3,043-addition / 464-deletion upstream manifest accounted for
all 46 upstream paths present in the 50-path branch diff, with exactly four documented local extras
local post-sync features preserved
xAI weekly/monthly/pay-as-you-go/product usage verified by focused tests
provider priority and local weight controls verified
plugin version picker verified
monitoring 2,000-event cap, four snapshots, AbortSignal, hidden polling, 30-second default, retention locales, usage summary, and old-server model_stats fallback verified
full test, type-check, lint, build, and diff checks passing
management.html containing official xAI weekly markers
unrelated untracked files untouched
```

- [ ] **Step 2: Inspect commits and authorship**

```bash
git log --format='%h %an <%ae> %s' master..HEAD
```

Expected: every new commit uses `zhengyage <zhengyage@magicpipeline.com>` and Chinese Conventional Commit subjects.

- [ ] **Step 3: Mark the goal complete only after all evidence is present**

Do not report completion if any upstream file is unexplained, any required command is unrun, or any preservation check is indirect.
