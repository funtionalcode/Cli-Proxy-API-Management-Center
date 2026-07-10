# CPA Manager Plus Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize Provider list writes so rapid edits cannot overwrite each other, and expose retryable model-price usage-summary failures instead of presenting them as empty data.

**Architecture:** A small FIFO promise queue runs every Provider list mutation one at a time. Each queued mutation reads the latest list through refs only when it starts, applies its optimistic state, saves the complete list, and rolls back before the next mutation starts if the save fails. Model-price summary loading moves into a focused hook that distinguishes unsupported endpoints from real failures and exposes an explicit retry operation.

**Tech Stack:** React 19, TypeScript, Vitest, react-test-renderer, Axios, SCSS modules, i18next.

---

### Task 1: Add the serialized Provider write queue

**Files:**

- Create: `src/features/aiProviders/providerWriteQueue.ts`
- Test: `src/features/aiProviders/providerWriteQueue.test.ts`

- [ ] **Step 1: Write failing queue tests**

Add tests that enqueue two deferred writes and assert the second task does not start before the first settles. Add a rejection case proving that a failed first task does not prevent the second task from running.

```ts
const queue = createProviderWriteQueue();
const first = queue.enqueue(async () => {
  events.push('first:start');
  await firstGate.promise;
  events.push('first:end');
});
const second = queue.enqueue(async () => {
  events.push('second:start');
});

expect(events).toEqual(['first:start']);
firstGate.resolve();
await Promise.all([first, second]);
expect(events).toEqual(['first:start', 'first:end', 'second:start']);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/features/aiProviders/providerWriteQueue.test.ts --reporter=dot
```

Expected: FAIL because `createProviderWriteQueue` does not exist.

- [ ] **Step 3: Implement the minimal FIFO queue**

Create a queue whose `enqueue()` returns the individual task promise while storing a rejection-safe tail for subsequent tasks. Expose a pending-count callback so the page can keep controls disabled until the full queue drains.

```ts
export interface ProviderWriteQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export const createProviderWriteQueue = (
  onPendingChange?: (pending: number) => void
): ProviderWriteQueue => {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    enqueue<T>(task: () => Promise<T>) {
      pending += 1;
      onPendingChange?.(pending);
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      void result.then(
        () => {
          pending -= 1;
          onPendingChange?.(pending);
        },
        () => {
          pending -= 1;
          onPendingChange?.(pending);
        }
      );
      return result;
    },
  };
};
```

- [ ] **Step 4: Verify GREEN**

Run the Task 1 Vitest command and require all queue tests to pass.

### Task 2: Route Provider list mutations through the queue

**Files:**

- Modify: `src/features/aiProviders/AiProvidersPage.tsx`
- Test: `src/features/aiProviders/providerWriteQueue.test.ts`

- [ ] **Step 1: Add a failing latest-state regression test**

Add `enqueueLatestProviderListWrite` to the test import before it exists. Use the real queue with a mutable list reference. Queue a priority mutation followed by an enabled-state mutation while the first save is held. Assert that the second saved list contains both changes because each task calls `getCurrent()` only when it starts.

```ts
let current = [{ priority: 1, enabled: true }];
const saved: (typeof current)[] = [];

const priorityWrite = enqueueLatestProviderListWrite(queue, {
  getCurrent: () => current,
  apply: (next) => {
    current = next;
  },
  buildNext: (list) => list.map((item) => ({ ...item, priority: 9 })),
  save: async (next) => {
    saved.push(next);
    await firstGate.promise;
  },
});
const toggleWrite = enqueueLatestProviderListWrite(queue, {
  getCurrent: () => current,
  apply: (next) => {
    current = next;
  },
  buildNext: (list) => list.map((item) => ({ ...item, enabled: false })),
  save: async (next) => {
    saved.push(next);
  },
});

firstGate.resolve();
await Promise.all([priorityWrite, toggleWrite]);
expect(saved[1]).toEqual([{ priority: 9, enabled: false }]);
```

- [ ] **Step 2: Verify RED**

Run the Task 1 Vitest command. Expected: FAIL because `enqueueLatestProviderListWrite` does not exist.

- [ ] **Step 3: Integrate the queue**

Implement `enqueueLatestProviderListWrite` so it obtains `previousList` from `getCurrent()` inside the queued task, builds and applies `nextList`, saves it, and restores `previousList` on failure before returning. Create refs for Gemini, Codex, Claude, Vertex, and OpenAI lists. Add apply helpers that update the ref, React state, config store, and cache together. Instantiate one queue and map pending count to `configSwitchingKey`.

Wrap health-check bulk saves, enabled toggles, websocket toggles, cloak toggles, disable-cooling toggles, and priority writes in `providerWriteQueue.enqueue()`. Inside every task, read the list ref at task execution time, compute `previousList` and `nextList`, apply optimistically, save the full list, and restore `previousList` on failure before allowing the next queued task to start.

- [ ] **Step 4: Verify Provider tests**

Run:

```bash
npx vitest run src/features/aiProviders/providerWriteQueue.test.ts src/components/providers/ProviderTable/ProviderTable.test.tsx --reporter=dot
```

Expected: all tests pass and rapid priority/toggle writes preserve both fields.

### Task 3: Surface model-price summary failures and retry

**Files:**

- Create: `src/features/monitoring/hooks/useModelPriceUsageSummary.ts`
- Create: `src/features/monitoring/hooks/useModelPriceUsageSummary.test.tsx`
- Modify: `src/features/monitoring/ModelPricesPage.tsx`
- Modify: `src/features/monitoring/ModelPricesPage.module.scss`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Write failing hook tests**

Mock `usageServiceApi.getModelPriceUsageSummary` and verify:

1. HTTP 404 enables `modelStatsFallbackEnabled` without exposing an error.
2. HTTP 500 exposes the real error and does not enable fallback.
3. Calling `retry()` after a failure starts a new request and clears the error after success.
4. Unmount aborts the active request and ignores late completion.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/features/monitoring/hooks/useModelPriceUsageSummary.test.tsx --reporter=dot
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook and page error state**

Move the current summary effect into `useModelPriceUsageSummary`. Return:

```ts
{
  usageSummary,
  loading,
  error,
  modelStatsFallbackEnabled,
  retry,
}
```

Only 404, 405, and `method_not_allowed` enable fallback. Preserve saved prices on all failures. In `ModelPricesPage`, render an inline error panel with the actual message and `common.retry`; when fallback analytics fails, show that error through the same panel.

- [ ] **Step 4: Verify GREEN**

Run the hook test plus `modelPricesPageModel.test.ts`. Expected: all tests pass.

### Task 4: Re-run synchronization acceptance gates

**Files:**

- Inspect: all branch changes
- Generate but do not track: `dist/management.html`

- [ ] **Step 1: Format and focused verification**

Run:

```bash
npm test -- --reporter=dot
npm run type-check
npm run lint
git diff --check
```

Expected: 0 test failures, 0 TypeScript errors, 0 ESLint errors, and no whitespace errors.

- [ ] **Step 2: Rebuild and inspect xAI markers**

Run:

```bash
npm run build
test -s dist/management.html
rg -n 'billing\\?format=credits|x-xai-token-auth|x-grok-client-version' dist/management.html
```

Expected: production build succeeds and all three xAI official-request markers remain present.

- [ ] **Step 3: Refresh and re-run the manifest audit**

Update Task 6 in `docs/superpowers/plans/2026-07-10-cpa-manager-plus-full-upstream-sync.md` to assert 55 branch paths and 9 explicit extras. The extras must be the original four paths plus this review-fix plan, `providerWriteQueue.ts`, its test, `useModelPriceUsageSummary.ts`, and its test. Execute the refreshed audit. Expected: upstream paths 46, branch paths 55, missing upstream paths 0, and extras 9 with an exact path comparison.

- [ ] **Step 4: Review and commit**

Inspect `git diff --stat master...HEAD`, `git diff --check master...HEAD`, and `git status --short`. Commit with author `zhengyage <zhengyage@magicpipeline.com>`, a Chinese Conventional Commit subject, Chinese body, and required `Tests:`, `Constraint:`, `Scope-risk:`, and `Confidence:` sections.

## Final target audit addendum (2026-07-11)

The review-fix plan's earlier `46 upstream / 55 branch / 9 extras` checkpoint is historical. The completed synchronization advanced through configuration/Interactions, GPT-5.6 pricing, and active-tab analytics scoping to:

```text
repository target = 79d681c5771b536d2517a36cdcafb04f3930402e
latest apps/web checkpoint = 43bd407de231f1b316122428074b8be1ab6e8b1f
upstream paths = 92
branch paths = 108
missing upstream paths = 0
documented local extras = 16
upstream stat = 5,318 additions / 648 deletions
```

The final verification passed `98` test files and `849` tests, type-check, ESLint with zero errors, whitespace checks, and the single-file production build. The local FIFO Provider queue, stable identities, model-price retry/fallback, bounded monitoring, xAI requests, plugin gate, auth/proxy/OAuth workflows, `.claude/**` exclusion, and `dist/management.html` output remain present. The exact extras list is recorded in the full upstream-sync plan's final addendum.
