# Grok Insufficient-Quota Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Grok inspection recommend disabling authentication files when configured usage is exhausted, a reported balance is zero, or the billing request reports insufficient quota.

**Architecture:** Keep all new behavior in the existing Grok probe model. Add pure quota-signal helpers, preserve the current status-priority order, and reuse the existing `CodexInspectionResultItem` fields and action executor.

**Tech Stack:** TypeScript, React/Vite project conventions, Vitest, ESLint.

---

### Task 1: Successful Billing Exhaustion

**Files:**

- Modify: `src/features/monitoring/model/grokInspectionProbe.test.ts`
- Modify: `src/features/monitoring/model/grokInspectionProbe.ts`

- [x] **Step 1: Add failing tests for the default threshold and zero balances**

Add assertions that the Grok default threshold is `100`, and add successful billing cases where percentage fields are unavailable but either monthly or pay-as-you-go remaining balance is zero:

```ts
it('uses a 100 percent default threshold for Grok inspection', () => {
  expect(DEFAULT_GROK_INSPECTION_SETTINGS.usedPercentThreshold).toBe(100);
});

it('disables an enabled Grok account when monthly balance is zero', async () => {
  mockFetchXaiQuota.mockResolvedValue(
    createBilling({
      usagePercent: null,
      productUsage: [],
      monthlyLimitCents: 10000,
      usedCents: 10000,
      includedUsedCents: 10000,
      usedPercent: null,
      onDemandCapCents: null,
      onDemandUsedCents: null,
      onDemandUsedPercent: null,
    })
  );

  const result = await inspectSingleGrokAccount(baseAccount, settings);

  expect(result.action).toBe('disable');
  expect(result.actionReason).toBe('Grok 余额为 0，建议禁用认证文件');
  expect(result.isQuota).toBe(true);
});

it('disables an enabled Grok account when pay-as-you-go balance is zero', async () => {
  mockFetchXaiQuota.mockResolvedValue(
    createBilling({
      usagePercent: null,
      productUsage: [],
      monthlyLimitCents: null,
      usedCents: null,
      includedUsedCents: null,
      usedPercent: null,
      onDemandCapCents: 5000,
      onDemandUsedCents: 5000,
      onDemandUsedPercent: null,
    })
  );

  const result = await inspectSingleGrokAccount(baseAccount, settings);

  expect(result.action).toBe('disable');
  expect(result.actionReason).toBe('Grok 余额为 0，建议禁用认证文件');
  expect(result.isQuota).toBe(true);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/features/monitoring/model/grokInspectionProbe.test.ts
```

Expected: the zero-balance cases fail because the current probe only checks percentages and returns `keep`.

- [x] **Step 3: Implement explicit zero-balance detection**

Add a helper that only treats a balance as exhausted when both a positive limit and a used amount are reported:

```ts
const hasZeroRemainingBalance = (billing: XaiBillingSummary) => {
  const monthlyExhausted =
    billing.monthlyLimitCents !== null &&
    billing.monthlyLimitCents > 0 &&
    billing.includedUsedCents !== null &&
    billing.includedUsedCents >= billing.monthlyLimitCents;
  const onDemandExhausted =
    billing.onDemandCapCents !== null &&
    billing.onDemandCapCents > 0 &&
    billing.onDemandUsedCents !== null &&
    billing.onDemandUsedCents >= billing.onDemandCapCents;

  return monthlyExhausted || onDemandExhausted;
};
```

Combine it with the existing configured-threshold check. Use `Grok 余额为 0` in the reason when the explicit balance signal is what triggered the decision, and keep the existing threshold reason otherwise. Already-disabled files must return `keep` with the matching already-disabled reason.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/features/monitoring/model/grokInspectionProbe.test.ts
```

Expected: all Grok probe tests pass.

### Task 2: Failed Billing Exhaustion

**Files:**

- Modify: `src/features/monitoring/model/grokInspectionProbe.test.ts`
- Modify: `src/features/monitoring/model/grokInspectionProbe.ts`

- [x] **Step 1: Add failing tests for HTTP 402 and explicit quota text**

Add cases for an HTTP `402`, a non-402 insufficient-credit message, an already-disabled file, and priority preservation:

```ts
it('disables an enabled Grok account when billing returns 402', async () => {
  mockFetchXaiQuota.mockRejectedValue(createStatusError(402, '402 payment required'));

  const result = await inspectSingleGrokAccount(baseAccount, settings);

  expect(result.action).toBe('disable');
  expect(result.isQuota).toBe(true);
  expect(result.errorKind).toBe('quota_exhausted');
  expect(result.errorDetail).toContain('payment required');
});

it('disables an enabled Grok account for explicit insufficient-credit errors', async () => {
  mockFetchXaiQuota.mockRejectedValue(createStatusError(400, 'insufficient credits'));

  const result = await inspectSingleGrokAccount(baseAccount, settings);

  expect(result.action).toBe('disable');
  expect(result.isQuota).toBe(true);
  expect(result.errorKind).toBe('quota_exhausted');
});
```

Also assert that `401/403`, `404/410`, and `429` retain their existing actions even when their message includes a quota word.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/features/monitoring/model/grokInspectionProbe.test.ts
```

Expected: the new insufficient-quota error cases fail because current error handling returns `keep`.

- [x] **Step 3: Implement explicit insufficient-quota error handling**

Add narrowly scoped case-insensitive patterns and a shared quota result builder:

```ts
const INSUFFICIENT_QUOTA_PATTERNS = [
  /insufficient\s+(?:quota|credit|credits|balance)/i,
  /(?:quota|credit|credits|balance)\s+(?:exhausted|depleted|insufficient)/i,
  /(?:额度|余额|积分).*(?:不足|耗尽|用完)/,
];

const isInsufficientQuotaError = (statusCode: number | null, detail: string) =>
  statusCode === 402 || INSUFFICIENT_QUOTA_PATTERNS.some((pattern) => pattern.test(detail));
```

Evaluate this after authentication and deletion statuses but before `429` and generic failures. Return `disable` for enabled files, `keep` for already-disabled files, `isQuota: true`, `errorKind: 'quota_exhausted'`, and preserve status and error detail.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/features/monitoring/model/grokInspectionProbe.test.ts
```

Expected: all Grok probe tests pass.

### Task 3: Partial Billing Failure Preservation

**Files:**

- Modify: `src/utils/quota/formatters.ts`
- Modify: `src/utils/quota/providerRequests.ts`
- Modify: `src/utils/quota/providerRequests.test.ts`
- Modify: `src/features/monitoring/model/grokInspectionProbe.ts`
- Modify: `src/features/monitoring/model/grokInspectionProbe.test.ts`

- [x] **Step 1: Add failing tests for partial quota errors and false-positive text**

Verify that strict xAI quota fetching rejects an `insufficient_quota` failure from either billing endpoint even when the other endpoint succeeds. Verify that Grok inspection enables strict handling and that `insufficient credit card details` remains a generic error.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/utils/quota/providerRequests.test.ts src/features/monitoring/model/grokInspectionProbe.test.ts
```

Expected: the partial failure resolves instead of rejecting, Grok does not pass the strict option, and credit-card setup text is misclassified.

- [x] **Step 3: Implement strict partial quota-error propagation**

Add shared insufficient-quota recognition, normalize underscore and hyphen separators, exclude singular `credit` from quota terms, and add an optional `rejectOnInsufficientQuota` fetch setting that defaults to `false`. Enable the option only from Grok inspection.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/utils/quota/providerRequests.test.ts src/features/monitoring/model/grokInspectionProbe.test.ts
```

Expected: both focused test files pass.

### Task 4: Verification

**Files:**

- Verify: `src/features/monitoring/model/grokInspectionProbe.ts`
- Verify: `src/features/monitoring/model/grokInspectionProbe.test.ts`

- [x] **Step 1: Run targeted static checks**

Run:

```bash
npx eslint src/features/monitoring/model/grokInspectionProbe.ts src/features/monitoring/model/grokInspectionProbe.test.ts --ext ts,tsx --report-unused-disable-directives
npx prettier --check src/features/monitoring/model/grokInspectionProbe.ts src/features/monitoring/model/grokInspectionProbe.test.ts
git diff --check
```

Expected: all commands exit with status `0`.

- [x] **Step 2: Run complete automated verification**

Run:

```bash
npm test
npm run build
```

Expected: all test files pass and the production build exits with status `0`.

- [x] **Step 3: Review the final patch**

Confirm that only the Grok probe, its tests, and approved design/plan documentation changed. Confirm that unrelated untracked files remain untouched.
