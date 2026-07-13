# Grok Insufficient-Quota Inspection Design

## Objective

Make Grok inspection recommend disabling an authentication file whenever the account has no usable quota, while preserving the existing reauthentication and deletion decisions for invalid authentication files.

## Decision Rules

Grok inspection evaluates successful billing responses and billing-request failures through one quota-insufficiency decision.

For a successful billing response, quota is insufficient when either condition is true:

- Any reported usage dimension reaches the configured used-percent threshold.
- A reported monthly or pay-as-you-go balance has a positive limit and zero remaining balance.

The Grok default used-percent threshold is `100`. Users may continue to configure a lower threshold.

For a failed billing request, quota is insufficient when either condition is true:

- The response status is HTTP `402`.
- The error detail explicitly indicates insufficient or exhausted quota, credits, or balance.

Error-text matching is case-insensitive and limited to specific quota and balance phrases. Generic request failures must not be classified as quota exhaustion.

## Decision Priority

Status-specific authentication and file-lifecycle decisions take precedence over quota-text matching:

1. Missing `auth_index`: keep the file and report the missing identifier.
2. HTTP `401` or `403`: recommend reauthentication.
3. HTTP `404` or `410`: recommend deletion.
4. HTTP `402`: recommend disabling an enabled file.
5. HTTP `429`: keep the file because rate limiting does not prove quota exhaustion.
6. Other statuses with an explicit insufficient-quota error: recommend disabling an enabled file.
7. Other request failures: keep the file and report the probe error.

When an insufficient-quota file is already disabled, the result remains `keep` with a reason stating that the file is already disabled. Inspection must not issue a redundant disable action.

## Result Data

Quota-insufficient results use the existing inspection result model:

- `action` is `disable` for enabled files and `keep` for already-disabled files.
- `isQuota` is `true`.
- `usedPercent` contains the highest reported usage percentage when available and remains `null` for status-only failures.
- Successful responses retain their quota windows.
- Failed responses retain the HTTP status and truncated error detail for diagnosis.

No new API fields or UI components are required.

## Implementation Boundary

Keep the behavior inside `grokInspectionProbe.ts` by introducing small pure helpers for:

- Detecting zero remaining monthly or pay-as-you-go balance.
- Detecting explicit insufficient-quota error text.
- Building the enabled versus already-disabled quota decision.

The shared xAI billing request and quota-page presentation remain unchanged.

## Testing

Extend `grokInspectionProbe.test.ts` before production changes to cover:

1. The Grok default threshold is `100`.
2. Usage at the configured threshold recommends disabling an enabled file.
3. A zero monthly balance recommends disabling even when percentage fields are unavailable.
4. A zero pay-as-you-go balance recommends disabling even when percentage fields are unavailable.
5. HTTP `402` recommends disabling and preserves the error detail.
6. A non-402 error with explicit insufficient-credit text recommends disabling.
7. An already-disabled file with insufficient quota remains disabled without a redundant action.
8. Authentication, deletion, rate-limit, and generic-error decisions keep their existing priority.

After implementation, run the focused Grok probe tests, the complete test suite, targeted ESLint, TypeScript/production build, and a patch whitespace check.

## Non-Goals

- Automatically disabling files during inspection when automatic actions are not enabled.
- Changing one-click bulk disable or delete behavior.
- Treating ordinary network failures or HTTP `429` as quota exhaustion.
- Adding a new remaining-balance setting separate from the existing used-percent threshold.
- Changing Codex inspection behavior.
