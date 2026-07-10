# CPA Manager Plus 79d681c5 Full Web Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the complete `apps/web` delta from `05174f662660e488e5e5a338ab5070a79e4bc79d` to `79d681c5771b536d2517a36cdcafb04f3930402e`, including CPA configuration round-trip coverage, Interactions provider support, GPT-5.6 pricing, and active-tab Usage Analytics query shaping, while preserving every local customization already merged on `codex/sync-cpa-manager-plus-main`.

**Architecture:** Treat upstream regression tests as the executable specification, then merge production changes in six isolated layers: visual YAML round trips, provider/auth API normalization, model metadata/editor controls, the unified Provider page, GPT-5.6 price calculation/editing, and tab-scoped Usage Analytics requests. Provider writes stay on the local FIFO/stable-identity architecture; analytics selectors use an independent stable request scope so tab changes do not reload them.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, react-test-renderer, Zustand, Axios, YAML document editing, SCSS modules, i18next.

---

## Pinned scope and invariants

- Previous repository target: `05174f662660e488e5e5a338ab5070a79e4bc79d`.
- New repository target: `79d681c5771b536d2517a36cdcafb04f3930402e`.
- Web-changing commits after the previous plan target: `26b8f166` (active-tab analytics scoping) and `43bd407d` (GPT-5.6 pricing).
- Incremental web delta from `88f91180`: 15 files, 692 additions, 42 deletions.
- Complete web delta from shared baseline `cc63954`: 92 files, 5,318 additions, 648 deletions.
- Expected final tracked branch diff: 108 paths, with all 92 upstream paths represented and exactly 16 documented local extras.
- Tasks 1-5 are complete in commits `19ff024b`, `1f238f42`, `6abcdc2d`, `e7ffc7c`, and `de0bfa1c`; Task 6 is complete in `0caad4ae`, Task 7 in `66d544dd`, and the independent-review persistence fix in `761eb5be`.
- Preserve the untracked `pnpm-workspace.yaml`; never modify, stage, or delete it.
- Preserve local Provider `weight`, FIFO writes, stable-identity relocation, queued `loadConfigs`, OpenAI PATCH ordering, partial-success health notifications, auth/proxy/OAuth workflows, `.claude/**` test exclusion, monitoring bounded-memory behavior, and single-file `dist/management.html` output.

## Task 1: Import the upstream configuration-coverage tests and establish RED

**Files:**

- Create: `src/components/ui/ModelInputList.test.tsx`
- Create: `src/components/ui/modelInputListUtils.test.ts`
- Modify: `src/hooks/useVisualConfig.test.ts`
- Modify: `src/services/api/providers.test.ts`
- Modify: `src/services/api/authFiles.test.ts`

- [ ] **Step 1: Apply only the test hunks from `e23a93f1`**

Use `apply_patch` to add the upstream assertions for these concrete behaviors:

```ts
expect(
  entriesToModels([{ name: 'image-model', alias: '', inputModalities: [], outputModalities: [] }])
).toEqual([{ name: 'image-model', inputModalities: [], outputModalities: [] }]);

expect(parsed['remote-management']?.['secret-key']).toBe(existingHash);
expect(parsed['quota-exceeded']).toEqual({ 'switch-project': true });
expect(parsed['ws-auth']).toBe(false);

expect(serializedModel['force-mapping']).toBe(true);
expect(serializedModel['input-modalities']).toEqual(['text', 'image']);
expect(serializedModel['output-modalities']).toEqual([]);
```

The imported tests must also cover `disable-image-generation: passthrough`, Redis retention rejecting `0`, write-only management-key keep/replace/clear, new CPA runtime settings, OAuth `force-mapping`, `rebuild-mid-system-message`, unknown raw provider-field preservation, and Interactions provider CRUD payloads.

- [ ] **Step 2: Verify RED by subsystem**

Run:

```bash
npx vitest run src/hooks/useVisualConfig.test.ts --reporter=dot
npx vitest run src/services/api/providers.test.ts src/services/api/authFiles.test.ts --reporter=dot
npx vitest run src/components/ui/ModelInputList.test.tsx src/components/ui/modelInputListUtils.test.ts --reporter=dot
```

Expected: failures are caused by missing new fields, serializers, Interactions APIs, modality controls, or write-only key semantics. Fix test syntax/import errors until the failures are assertion or type failures tied to missing production behavior.

- [ ] **Step 3: Commit the RED specification**

Stage only the five test files and commit with a Chinese Conventional Commit subject. Record the exact failed/passed counts in `Tests:` and state that production code is intentionally not included.

## Task 2: Implement visual YAML round-trip coverage

**Files:**

- Modify: `src/types/visualConfig.ts`
- Modify: `src/hooks/useVisualConfig.ts`
- Modify: `src/hooks/visualConfigPayloadRules.ts`
- Modify: `src/components/config/VisualConfigEditor.tsx`
- Modify: `src/components/config/VisualConfigEditor.module.scss`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Test: `src/hooks/useVisualConfig.test.ts`

- [ ] **Step 1: Add the exact visual-config types and defaults**

Add:

```ts
export type DisableImageGenerationMode = 'false' | 'true' | 'chat' | 'passthrough';
export type RemoteManagementSecretKeyAction = 'unchanged' | 'replace' | 'clear';
```

Extend `VisualConfigValues` with `rmSecretKeyAction`, `rmSecretKeyConfigured`, `pprofEnable`, `pprofAddr`, `saveCooldownStatus`, `transientErrorCooldownSeconds`, `disableClaudeCloakMode`, `gptImage2BaseModel`, and `videoResultAuthCacheTtl`. Adopt the CPA defaults `wsAuth: true`, `quotaSwitchProject: false`, and `quotaSwitchPreviewModel: false` without changing an absent YAML document unless the user dirties the field.

- [ ] **Step 2: Implement lossless load/save semantics**

In `useVisualConfig.ts`:

```ts
const hasRemoteManagementSecretKeyUpdate =
  values.rmSecretKeyAction === 'clear' ||
  (values.rmSecretKeyAction === 'replace' && values.rmSecretKey.length > 0);
```

Keep an existing secret key unchanged for unrelated edits, preserve replacement bytes without trimming, reject an empty replacement, and write `''` only for explicit clear. Add dirty-field tracking for the new settings; write absent quota/ws-auth fields only when changed; preserve `passthrough`; validate retention in `[1, 3600]`; allow signed integer transient cooldowns; and round-trip the pprof/runtime settings exactly.

- [ ] **Step 3: Expose the controls without disturbing local sections**

Add the secret-key keep/clear actions, pprof fields, new network/runtime controls, passthrough option, validation messages, and four-language text to `VisualConfigEditor`. Preserve local plugin-store, payload rules, headers, monitoring, and existing section ordering.

- [ ] **Step 4: Verify and commit Task 2**

Run:

```bash
npx vitest run src/hooks/useVisualConfig.test.ts --reporter=dot
npm run type-check
npx eslint src/hooks/useVisualConfig.ts src/hooks/useVisualConfig.test.ts src/hooks/visualConfigPayloadRules.ts src/types/visualConfig.ts --report-unused-disable-directives
git diff --check
```

Expected: all visual-config tests pass and no unrelated YAML key is rewritten. Commit only Task 2 files.

## Task 3: Implement provider/auth API coverage and Interactions normalization

**Files:**

- Modify: `src/types/config.ts`
- Modify: `src/types/provider.ts`
- Modify: `src/types/oauth.ts`
- Modify: `src/entities/config/sections.ts`
- Modify: `src/stores/useConfigStore.ts`
- Modify: `src/services/api/transformers.ts`
- Modify: `src/services/api/providers.ts`
- Modify: `src/services/api/providers.test.ts`
- Modify: `src/services/api/authFiles.ts`
- Modify: `src/services/api/authFiles.test.ts`

- [ ] **Step 1: Extend canonical frontend models**

Add `interactionsApiKeys`, `interactions-api-key`, model `forceMapping`, `inputModalities`, `outputModalities`, provider `rebuildMidSystemMessage`, and OAuth alias `forceMapping`. Retain all local fields, especially `weight`, `balanceToken`, auth indexes, proxy URLs, raw unknown fields, and existing OpenAI key-entry metadata.

- [ ] **Step 2: Normalize all accepted field spellings**

In transformers/API normalization, accept kebab, camel, and snake spellings for:

```text
force-mapping / forceMapping / force_mapping
input-modalities / inputModalities / input_modalities
output-modalities / outputModalities / output_modalities
rebuild-mid-system-message / rebuildMidSystemMessage / rebuild_mid_system_message
interactions-api-key / interactionsApiKey / interactionsApiKeys
```

Preserve explicit empty modality arrays and omitted unknown raw values. Extend OAuth alias dedupe to include `forceMapping`.

- [ ] **Step 3: Add Interactions CRUD through existing preservation helpers**

Implement `getInteractionsKeys`, `saveInteractionsKeys`, `updateInteractionsKey`, and `deleteInteractionsKey` using the same raw-field-preserving merge pipeline as Gemini. Require a real API key for Gemini/Interactions serialization while retaining auth-index-only behavior only where the current backend contract allows it.

- [ ] **Step 4: Verify and commit Task 3**

Run:

```bash
npx vitest run src/services/api/providers.test.ts src/services/api/authFiles.test.ts --reporter=dot
npm run type-check
npx eslint src/services/api/providers.ts src/services/api/providers.test.ts src/services/api/authFiles.ts src/services/api/authFiles.test.ts src/services/api/transformers.ts src/types/config.ts src/types/provider.ts src/types/oauth.ts --report-unused-disable-directives
git diff --check
```

Expected: API round-trip tests pass without losing local weight/proxy/auth/raw fields. Commit only Task 3 files.

## Task 4: Add model metadata and editor coverage

**Files:**

- Create: `src/components/ui/ModelInputList.module.scss`
- Modify: `src/components/ui/ModelInputList.tsx`
- Modify: `src/components/ui/modelInputListUtils.ts`
- Test: `src/components/ui/ModelInputList.test.tsx`
- Test: `src/components/ui/modelInputListUtils.test.ts`
- Modify: `src/utils/compare.ts`
- Modify: `src/stores/useClaudeEditDraftStore.ts`
- Modify: `src/components/providers/types.ts`
- Modify: `src/components/providers/ProviderEditDrawer/ClaudeEditDrawer.tsx`
- Modify: `src/components/providers/ProviderEditDrawer/CodexEditDrawer.tsx`
- Modify: `src/components/providers/ProviderEditDrawer/GeminiEditDrawer.tsx`
- Modify: `src/components/providers/ProviderEditDrawer/OpenAIEditDrawer.tsx`
- Modify: `src/features/aiProviders/AiProvidersClaudeEditLayout.tsx`
- Modify: `src/features/aiProviders/AiProvidersClaudeEditPage.tsx`
- Modify: `src/features/aiProviders/AiProvidersCodexEditPage.tsx`
- Modify: `src/features/aiProviders/AiProvidersOpenAIEditLayout.tsx`
- Modify: `src/features/aiProviders/AiProvidersOpenAIEditPage.tsx`
- Modify: `src/features/authFiles/AuthFilesOAuthModelAliasEditPage.tsx`
- Modify: `src/features/authFiles/AuthFilesOAuthModelAliasEditPage.module.scss`

- [ ] **Step 1: Preserve advanced model metadata in conversions**

Extend `ModelEntry` and the model converters with `forceMapping`, `inputModalities`, `outputModalities`, and draft strings. `entriesToModels` must preserve explicit `[]` arrays and leave untouched modality fields `undefined`. Extend equality/baseline logic so edits are detected without dropping local priority, test-model, image, thinking, weight, or alias behavior.

- [ ] **Step 2: Add focused UI controls**

Add optional `showForceMapping` and `showModalities` props to `ModelInputList`; render a force-mapping toggle and comma/newline modality inputs only where enabled. Enable force mapping for Claude/Codex/Gemini editor flows, modalities for OpenAI flows, OAuth force mapping for alias editing, and `rebuildMidSystemMessage` for Claude. Preserve local drawer/page layouts and save gates.

- [ ] **Step 3: Verify and commit Task 4**

Run:

```bash
npx vitest run src/components/ui/ModelInputList.test.tsx src/components/ui/modelInputListUtils.test.ts --reporter=dot
npm run type-check
npx eslint src/components/ui/ModelInputList.tsx src/components/ui/ModelInputList.test.tsx src/components/ui/modelInputListUtils.ts src/components/ui/modelInputListUtils.test.ts --report-unused-disable-directives
git diff --check
```

Expected: all model metadata tests pass, explicit empty arrays survive, and existing editor workflows still type-check. Commit only Task 4 files.

## Task 5: Merge Interactions into the local FIFO Provider workbench

**Files:**

- Modify: `src/components/providers/ProviderTable/kindMeta.ts`
- Modify: `src/components/providers/ProviderTable/rowData.ts`
- Modify: `src/components/providers/ProviderDetailDrawer/ProviderDetailDrawer.tsx`
- Modify: `src/components/providers/ProviderHealthCheckDrawer/healthCheck.ts`
- Modify: `src/features/aiProviders/AiProvidersPage.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Test: `src/components/providers/ProviderHealthCheckDrawer/healthCheck.test.ts`
- Test: `src/features/aiProviders/providerWriteQueue.test.ts`
- Test: `src/components/providers/ProviderTable/ProviderTable.test.tsx`

- [ ] **Step 1: Add Interactions to provider rows and health checks**

Extend `ProviderKind`, row builders, labels/icons, detail behavior, and health-check target unions for `interactions`. Use the same stable identity contract as Gemini but keep `gemini` and `interactions` namespaced separately.

- [ ] **Step 2: Integrate Interactions with the local FIFO architecture**

Do not copy upstream's concurrent index-based setters. Add `interactionsKeys` state/ref/apply helpers and route Interactions load, health changes, enabled, disable-cooling, priority, add/edit, and deletion through the existing queue/stable-entry helpers. `loadConfigs` must fetch/apply Interactions within the same queued refresh. Preserve local partial-success counting and make Interactions a separate result in health batches.

- [ ] **Step 3: Preserve all local workbench behavior**

Keep local weight editing, priority editing, pagination, details, auth/proxy/OAuth links, OpenAI PATCH ordering, stable health keys, and cache/store synchronization. Add the Interactions editor drawer using `providerKind="interactions"` without changing Gemini behavior.

- [ ] **Step 4: Verify and commit Task 5**

Run:

```bash
npx vitest run \
  src/features/aiProviders/providerWriteQueue.test.ts \
  src/components/providers/ProviderHealthCheckDrawer/healthCheck.test.ts \
  src/components/providers/ProviderTable/ProviderTable.test.tsx \
  --reporter=dot
npm run type-check
git diff --check
```

Expected: FIFO/stable-identity regressions remain green and Interactions is independently addressable. Commit only Task 5 files.

## Task 6: Add GPT-5.6 price calculation and editing coverage

**Files:**

- Modify: `src/utils/usage.test.ts`
- Modify: `src/utils/usage.ts`
- Modify: `src/features/monitoring/model/modelPricesPageModel.test.ts`
- Modify: `src/features/monitoring/model/modelPricesPageModel.ts`
- Modify: `src/features/monitoring/ModelPricesPage.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Import the upstream GPT-5.6 tests and verify RED**

Use `apply_patch` to import the `43bd407d` test hunks. The cost tests must assert the official prices, the 272,000-token boundary, long-context input/output multipliers, resolved-model behavior, Priority/Fast multiplier `2`, fallback cache-read/cache-creation ratios, and explicit configured zeroes. The draft-model tests must include:

```ts
expect(
  buildPriceFromDraft({
    model: 'gpt-5.6-sol',
    prompt: '0',
    completion: '0',
    cache: '',
    cacheRead: '0',
    cacheCreation: '0',
  })
).toMatchObject({
  prompt: 0,
  completion: 0,
  cacheRead: 0,
  cacheCreation: 0,
  promptConfigured: true,
  completionConfigured: true,
  cacheReadConfigured: true,
  cacheCreationConfigured: true,
});
```

Run:

```bash
npx vitest run src/utils/usage.test.ts src/features/monitoring/model/modelPricesPageModel.test.ts --reporter=dot
```

Expected: FAIL only because GPT-5.6 fallback/configured-price behavior and the two draft fields do not exist yet.

- [ ] **Step 2: Implement the price contract minimally**

Extend `ModelPrice` with the four `*Configured` flags and recognize cache-write token aliases. Normalize provider-prefixed model names before family matching. Add these official prices:

```ts
const OFFICIAL_GPT_56_PRICES = {
  'gpt-5.6-sol': { prompt: 5, completion: 30, cacheRead: 0.5, cacheCreation: 6.25 },
  'gpt-5.6-terra': { prompt: 2.5, completion: 15, cacheRead: 0.25, cacheCreation: 3.125 },
  'gpt-5.6-luna': { prompt: 1, completion: 6, cacheRead: 0.1, cacheCreation: 1.25 },
};
```

For the behavior model (`resolvedModel || requestedModel`), apply Priority/Fast multiplier `2`; above `272_000` total input tokens multiply input charges by `2` and completion charges by `1.5`. Missing GPT-5.6 cache read/creation values derive from prompt price at `0.1` and `1.25`; a corresponding configured flag preserves an explicit `0`. The resolved model controls family behavior even when the requested alias supplies the configured price.

- [ ] **Step 3: Add cache read/creation fields to the editor**

Extend `PriceDraft` and its empty/edit/build conversions with `cacheRead` and `cacheCreation`. Use configured flags to distinguish blank from zero. Add the two inputs and table columns in `ModelPricesPage`, and add these four-language keys:

```text
model_prices.optional_price_placeholder
usage_stats.model_price_cache_read
usage_stats.model_price_cache_creation
```

- [ ] **Step 4: Verify and commit Task 6**

Run:

```bash
npx vitest run src/utils/usage.test.ts src/features/monitoring/model/modelPricesPageModel.test.ts --reporter=dot
npm run type-check
npx eslint src/utils/usage.ts src/utils/usage.test.ts src/features/monitoring/ModelPricesPage.tsx src/features/monitoring/model/modelPricesPageModel.ts src/features/monitoring/model/modelPricesPageModel.test.ts --report-unused-disable-directives
git diff --check
```

Expected: both focused suites pass, TypeScript/ESLint are clean, and existing model-price retry/fallback behavior is unchanged. Stage only Task 6 files and commit as `feat(monitoring): 支持 GPT-5.6 分层缓存定价` with the required Chinese body and verification trailers.

## Task 7: Scope Usage Analytics requests to the active tab

**Files:**

- Create: `src/features/usage-analytics/useUsageAnalytics.test.tsx`
- Modify: `src/features/usage-analytics/usageAnalyticsModel.test.ts`
- Modify: `src/features/usage-analytics/usageAnalyticsModel.ts`
- Modify: `src/features/usage-analytics/useUsageAnalytics.ts`
- Modify: `src/features/usage-analytics/UsageAnalyticsPage.tsx`
- Modify: `src/services/api/usageService.ts`

- [ ] **Step 1: Import the upstream request-orchestration tests and verify RED**

Import the `26b8f166` test hunks. `buildUsageAnalyticsInclude` must be asserted with these exact shapes:

```ts
overview: summary / comparison / timeline / model / channel / api - key / anomaly;
trends: summary / comparison / timeline / model / api - key / anomaly;
models: summary / timeline / model / api - key;
apiKeys: summary / api - key;
credentials: summary / credential / credential_timeline;
heatmap: summary / heatmap;
```

The new hook test must assert that the main `dataScopeKey` contains `activeTab`, the selector scope does not, a tab switch keeps the selector scope stable, selector errors do not become the page error, and manual refresh invokes both request refresh functions.

Run:

```bash
npx vitest run src/features/usage-analytics/usageAnalyticsModel.test.ts src/features/usage-analytics/useUsageAnalytics.test.tsx --reporter=dot
```

Expected: FAIL because the include builder is not tab-aware and no independent selector request exists.

- [ ] **Step 2: Build the tab-scoped include and selector contract**

Change the include builder signature and add the independent selector include:

```ts
buildUsageAnalyticsInclude(
  activeTab: UsageAnalyticsTab,
  granularity: UsageAnalyticsResolvedGranularity,
  drilldownPreview?: { fromMs: number; toMs: number; limit?: number } | null
): MonitoringAnalyticsInclude;

buildUsageAnalyticsFilterSelectorsInclude(): MonitoringAnalyticsInclude {
  return { filter_options: true, filter_selectors: true };
}
```

Only overview/trends may include `drilldown_preview`. Extend `MonitoringAnalyticsInclude` with `filter_selectors?: boolean` and `MonitoringAnalyticsFilterOptions` with lightweight `models?: string[]` and `api_key_hashes?: string[]`.

- [ ] **Step 3: Orchestrate stable selector loading and merge options**

Pass `activeTabState` into the main include and main `dataScopeKey`. Add a second `useMonitoringAnalytics` request whose scope contains bounds/search but not `activeTab`. Ignore its error when returning the page error, refresh it from the manual refresh handler, and expose `filterSelectorsData?.filter_options ?? adapted.filterOptions`.

In `UsageAnalyticsPage`, merge lightweight `models` and `api_key_hashes` into the existing stable option caches before rendering filter controls, preserving existing labels/aliases and deduplication.

- [ ] **Step 4: Verify and commit Task 7**

Run:

```bash
npx vitest run src/features/usage-analytics/usageAnalyticsModel.test.ts src/features/usage-analytics/useUsageAnalytics.test.tsx src/features/usage-analytics/UsageAnalyticsPage.test.tsx --reporter=dot
npm run type-check
npx eslint src/features/usage-analytics/UsageAnalyticsPage.tsx src/features/usage-analytics/usageAnalyticsModel.ts src/features/usage-analytics/usageAnalyticsModel.test.ts src/features/usage-analytics/useUsageAnalytics.ts src/features/usage-analytics/useUsageAnalytics.test.tsx src/services/api/usageService.ts --report-unused-disable-directives
git diff --check
```

Expected: focused suites pass; switching tabs changes only the main request scope; selector failure remains isolated. Stage only Task 7 files and commit as `perf(analytics): 按活动标签裁剪统计请求` with the required Chinese body and verification trailers.

## Task 8: Refresh the target, manifest, and full acceptance evidence

**Files:**

- Modify: `docs/superpowers/specs/2026-07-10-cpa-manager-plus-full-upstream-sync-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-cpa-manager-plus-full-upstream-sync.md`
- Modify: `docs/superpowers/plans/2026-07-10-cpa-manager-plus-review-fixes.md`
- Modify: this plan
- Generate but do not track: `dist/management.html`

- [x] **Step 1: Pin the new target only after implementation is green**

Run:

```bash
git ls-remote upstream refs/heads/main
git update-ref refs/cpa-plus/target 79d681c5771b536d2517a36cdcafb04f3930402e
git rev-parse refs/cpa-plus/base refs/cpa-plus/target upstream/main
```

Expected: remote, tracking branch, and target all equal `79d681c5`; base remains `cc63954`. If the remote has advanced again, do not update the target ref; audit the new delta and revise this plan first.

- [x] **Step 2: Regenerate the complete manifest**

Regenerate from `cc63954..79d681c5` and assert:

```text
upstream paths = 92
branch paths = 108
missing upstream paths = 0
documented local extras = 16
upstream stat = 5,318 additions / 648 deletions
```

Exact sorted extras from the manifest audit:

```text
docs/superpowers/plans/2026-07-10-cpa-manager-plus-88f91180-config-coverage.md
docs/superpowers/plans/2026-07-10-cpa-manager-plus-full-upstream-sync.md
docs/superpowers/plans/2026-07-10-cpa-manager-plus-review-fixes.md
docs/superpowers/specs/2026-07-10-cpa-manager-plus-full-upstream-sync-design.md
src/components/providers/ProviderHealthCheckDrawer/ProviderHealthCheckDrawer.tsx
src/components/providers/ProviderHealthCheckDrawer/healthCheck.test.ts
src/components/providers/ProviderHealthCheckDrawer/index.ts
src/components/providers/index.ts
src/features/aiProviders/AiProvidersGeminiEditPage.tsx
src/features/aiProviders/providerWriteQueue.test.ts
src/features/aiProviders/providerWriteQueue.ts
src/features/monitoring/ModelPricesPage.module.scss
src/features/monitoring/accountOverviewCardMetrics.ts
src/features/monitoring/components/accountOverviewPresentation.test.ts
src/features/monitoring/hooks/useModelPriceUsageSummary.test.tsx
src/features/monitoring/hooks/useModelPriceUsageSummary.ts
```

- [x] **Step 3: Restore locked dependencies and run full verification**

Run:

```bash
npm install --package-lock-only
git diff --exit-code -- package-lock.json
npm ci
npm test -- --reporter=dot
npm run type-check
npm run lint
git diff --check
npm run build
test -s dist/management.html
rg -n 'billing\?format=credits|x-xai-token-auth|x-grok-client-version' dist/management.html
```

Expected: zero test failures, zero TypeScript errors, zero ESLint errors, a successful single-file build, and all xAI markers present. Do not use pnpm and do not touch `pnpm-workspace.yaml`.

Execution evidence: `npm install --package-lock-only` left `package-lock.json` unchanged; `npm ci` succeeded; Vitest passed `98` files and `850/850` tests after the independent-review fix; type-check passed; ESLint exited zero with no errors and three `no-explicit-any` warnings in synchronized provider/auth API tests; `git diff --check` passed; the build produced non-empty `dist/management.html` containing all three xAI markers.

Independent review found that localStorage normalization dropped the four configured-price flags. Commit `761eb5be` restores real boolean flags and adds a save/load/calculateCost round-trip test, preserving GPT-5.6 explicit zeroes when Manager Server fallback storage is used.

- [x] **Step 4: Audit preservation and authorship**

Run exact searches for `events_page`, `model_stats`, `usage-summary`, `weight`, `priority`, `pluginReleaseVersions`, `x-xai-token-auth`, `.claude/**`, `management.html`, `proxy`, `authIndex`, `OAuth`, `interactions-api-key`, `force-mapping`, `input-modalities`, and `rebuild-mid-system-message`. Check conflict markers, accidental `apps/web` imports, `git status --short`, and every commit author in `master..HEAD`.

- [x] **Step 5: Commit the final audit documents**

Stage only the four documentation files. The final status may contain the pre-existing untracked `pnpm-workspace.yaml`; it must not contain any other unexplained path.
