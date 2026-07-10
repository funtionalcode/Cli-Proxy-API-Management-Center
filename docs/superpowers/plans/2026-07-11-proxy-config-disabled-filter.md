# Proxy Configuration Disabled-State Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enabled-state filter to Proxy Configuration so disabled auth files and disabled OpenAI-compatible providers are hidden by default and can be shown explicitly.

**Architecture:** Keep disabled-state derivation and filtering in the pure `proxyConfigModel` layer, then wire one controlled `Select` into `ProxyConfigsPage`. The existing proxy URL status remains independent, summary cards continue to use the unfiltered row set, and localized labels are added to all four supported locale files.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, react-test-renderer, SCSS modules, i18next.

---

### Task 1: Model disabled state and filtering

**Files:**
- Modify: `src/features/proxyConfigs/proxyConfigModel.test.ts`
- Modify: `src/features/proxyConfigs/proxyConfigModel.ts`

- [ ] **Step 1: Write failing model tests**

Extend the model test imports with `DEFAULT_PROXY_CONFIG_ENABLED_FILTER`, then add focused cases that construct a disabled OpenAI provider, disabled and enabled auth files, and ordinary provider/global rows. Assert:

```ts
expect(DEFAULT_PROXY_CONFIG_ENABLED_FILTER).toBe('enabled');
expect(rows.find((row) => row.id === 'global')?.enabledState).toBe('enabled');
expect(rows.find((row) => row.id === 'provider:gemini:0')?.enabledState).toBe('enabled');
expect(
  rows
    .filter((row) => row.provider === 'disabled-openai')
    .every((row) => row.enabledState === 'disabled')
).toBe(true);
expect(rows.find((row) => row.name === 'disabled.json')?.enabledState).toBe('disabled');
expect(rows.find((row) => row.name === 'enabled.json')?.enabledState).toBe('enabled');
```

Use the same fixture to assert the three filter modes and composition with scope/search:

```ts
expect(filterProxyConfigRows(rows, 'all', 'enabled', '').every(
  (row) => row.enabledState === 'enabled'
)).toBe(true);
expect(filterProxyConfigRows(rows, 'all', 'disabled', '').every(
  (row) => row.enabledState === 'disabled'
)).toBe(true);
expect(filterProxyConfigRows(rows, 'all', 'all', '')).toHaveLength(rows.length);
expect(filterProxyConfigRows(rows, 'auth-file', 'disabled', 'disabled.json'))
  .toHaveLength(1);
expect(filterProxyConfigRows(rows, 'provider', 'disabled', 'disabled-openai'))
  .toHaveLength(2);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/features/proxyConfigs/proxyConfigModel.test.ts --exclude ".claude/**"
```

Expected: FAIL because `DEFAULT_PROXY_CONFIG_ENABLED_FILTER`, `enabledState`, and the enabled-filter argument do not exist yet.

- [ ] **Step 3: Add the minimal model implementation**

Add the public types and default:

```ts
export type ProxyConfigEnabledState = 'enabled' | 'disabled';
export type ProxyConfigEnabledFilter = ProxyConfigEnabledState | 'all';
export const DEFAULT_PROXY_CONFIG_ENABLED_FILTER: ProxyConfigEnabledFilter = 'enabled';
```

Add `enabledState: ProxyConfigEnabledState` to `ProxyConfigRow`. Supply `enabledState: 'enabled'` for global and non-OpenAI provider rows, derive OpenAI child rows from `provider.disabled === true`, and derive auth-file rows from `file.disabled === true`.

Extend the pure filter signature and predicate:

```ts
export const filterProxyConfigRows = (
  rows: ProxyConfigRow[],
  scope: ProxyConfigScope | 'all',
  enabledFilter: ProxyConfigEnabledFilter,
  search: string
): ProxyConfigRow[] => {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (scope !== 'all' && row.scope !== scope) return false;
    if (enabledFilter !== 'all' && row.enabledState !== enabledFilter) return false;
    if (!query) return true;
    return row.searchText.includes(query);
  });
};
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: all tests in `proxyConfigModel.test.ts` pass.

- [ ] **Step 5: Commit the model change**

Stage only the two model files and commit with the repository-required Chinese Conventional Commit format, including test evidence and scope trailers.

---

### Task 2: Wire the default filter into the page

**Files:**
- Create: `src/features/proxyConfigs/ProxyConfigsPage.test.tsx`
- Modify: `src/features/proxyConfigs/ProxyConfigsPage.tsx`

- [ ] **Step 1: Write a failing page-level regression test**

Mock `react-i18next`, `@/hooks/useHeaderRefresh`, `@/services/api`, and `@/stores`. Return one enabled auth file and one disabled auth file from `authFilesApi.list()`, with empty provider lists and an empty global proxy config.

Render `ProxyConfigsPage` in `act`, flush the resolved load promises, then inspect the `Select` whose id is `proxy-config-enabled-state` and the rendered row text:

```tsx
const enabledStateSelect = renderer.root.findAllByType(Select).find(
  (select) => select.props.id === 'proxy-config-enabled-state'
);
expect(enabledStateSelect?.props.value).toBe('enabled');
expect(getText(renderer.root)).toContain('enabled.json');
expect(getText(renderer.root)).not.toContain('disabled.json');

act(() => {
  enabledStateSelect?.props.onChange('disabled');
});
expect(getText(renderer.root)).not.toContain('enabled.json');
expect(getText(renderer.root)).toContain('disabled.json');

act(() => {
  renderer.root.findAllByType(Select).find(
    (select) => select.props.id === 'proxy-config-enabled-state'
  )?.props.onChange('all');
});
expect(getText(renderer.root)).toContain('enabled.json');
expect(getText(renderer.root)).toContain('disabled.json');
```

Also assert the selector exposes the localized key-backed options in the order `enabled`, `disabled`, `all`.

- [ ] **Step 2: Run the page test and verify RED**

Run:

```bash
pnpm exec vitest run src/features/proxyConfigs/ProxyConfigsPage.test.tsx --exclude ".claude/**"
```

Expected: FAIL because the enabled-state selector is not rendered and disabled rows are not filtered by default.

- [ ] **Step 3: Implement controlled filter state and selector**

Import `DEFAULT_PROXY_CONFIG_ENABLED_FILTER` and `ProxyConfigEnabledFilter`, then initialize:

```ts
const [enabledFilter, setEnabledFilter] = useState<ProxyConfigEnabledFilter>(
  DEFAULT_PROXY_CONFIG_ENABLED_FILTER
);
```

Pass the state into the model filter:

```ts
const visibleRows = useMemo(
  () => filterProxyConfigRows(rows, scopeFilter, enabledFilter, search),
  [enabledFilter, rows, scopeFilter, search]
);
```

Create the localized options:

```ts
const enabledFilterOptions = useMemo(
  () => [
    { value: 'enabled', label: t('proxy_configs.enabled_filter_enabled') },
    { value: 'disabled', label: t('proxy_configs.enabled_filter_disabled') },
    { value: 'all', label: t('proxy_configs.enabled_filter_all') },
  ],
  [t]
);
```

Render the new field immediately after Scope, reusing `styles.scopeField`:

```tsx
<div className={styles.scopeField}>
  <label htmlFor="proxy-config-enabled-state">
    {t('proxy_configs.enabled_filter_label')}
  </label>
  <Select
    id="proxy-config-enabled-state"
    value={enabledFilter}
    options={enabledFilterOptions}
    onChange={(value) => setEnabledFilter(value as ProxyConfigEnabledFilter)}
    ariaLabel={t('proxy_configs.enabled_filter_label')}
  />
</div>
```

- [ ] **Step 4: Run both proxy-config tests and verify GREEN**

Run:

```bash
pnpm exec vitest run \
  src/features/proxyConfigs/proxyConfigModel.test.ts \
  src/features/proxyConfigs/ProxyConfigsPage.test.tsx \
  --exclude ".claude/**"
```

Expected: both files pass.

- [ ] **Step 5: Commit the page wiring**

Stage only the page and page-test files and commit with a Chinese Conventional Commit subject and the required body fields.

---

### Task 3: Complete layout and localization

**Files:**
- Modify: `src/features/proxyConfigs/ProxyConfigsPage.module.scss`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/features/proxyConfigs/ProxyConfigsPage.test.tsx`

- [ ] **Step 1: Add failing locale assertions to the page test**

Import all four locale JSON files and assert the new keys exist and are non-empty:

```ts
const locales = [en, zhCN, zhTW, ru];
for (const locale of locales) {
  expect(locale.proxy_configs.enabled_filter_label).toBeTruthy();
  expect(locale.proxy_configs.enabled_filter_enabled).toBeTruthy();
  expect(locale.proxy_configs.enabled_filter_disabled).toBeTruthy();
  expect(locale.proxy_configs.enabled_filter_all).toBeTruthy();
}
```

- [ ] **Step 2: Run the page test and verify RED**

Run the Task 2 focused page-test command. Expected: FAIL because the four locale bundles do not yet contain the new keys.

- [ ] **Step 3: Add translations and desktop layout**

Add these locale values under `proxy_configs`:

| Key | English | 简体中文 | 繁體中文 | Русский |
| --- | --- | --- | --- | --- |
| `enabled_filter_label` | Status | 状态 | 狀態 | Статус |
| `enabled_filter_enabled` | Enabled | 启用 | 啟用 | Включено |
| `enabled_filter_disabled` | Disabled | 禁用 | 停用 | Отключено |
| `enabled_filter_all` | All | 全部 | 全部 | Все |

Update each `empty_message` to refer generically to filters rather than only Scope. Change the desktop toolbar to four columns while retaining the existing mobile one-column override:

```scss
grid-template-columns:
  minmax(260px, 1fr)
  minmax(160px, 220px)
  minmax(160px, 220px)
  auto;
```

- [ ] **Step 4: Verify focused tests, types, and formatting**

Run:

```bash
pnpm exec vitest run \
  src/features/proxyConfigs/proxyConfigModel.test.ts \
  src/features/proxyConfigs/ProxyConfigsPage.test.tsx \
  --exclude ".claude/**"
pnpm run type-check
pnpm exec prettier --check \
  src/features/proxyConfigs/proxyConfigModel.ts \
  src/features/proxyConfigs/proxyConfigModel.test.ts \
  src/features/proxyConfigs/ProxyConfigsPage.tsx \
  src/features/proxyConfigs/ProxyConfigsPage.test.tsx \
  src/features/proxyConfigs/ProxyConfigsPage.module.scss \
  src/i18n/locales/en.json \
  src/i18n/locales/zh-CN.json \
  src/i18n/locales/zh-TW.json \
  src/i18n/locales/ru.json
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit layout and localization**

Stage only the SCSS, locale files, and any page-test locale assertions, then commit with the required Chinese body and verification trailers.

---

### Task 4: Full verification and completion audit

**Files:**
- Inspect all files changed by Tasks 1-3.

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass; `.claude/**` is excluded by the project script.

- [ ] **Step 2: Run type checking, lint, and production build**

```bash
pnpm run type-check
pnpm run lint
pnpm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Audit the exact diff and repository state**

```bash
git diff --check master...HEAD
git diff --stat master...HEAD
git diff master...HEAD -- \
  src/features/proxyConfigs \
  src/i18n/locales/en.json \
  src/i18n/locales/zh-CN.json \
  src/i18n/locales/zh-TW.json \
  src/i18n/locales/ru.json
git status --short --branch
```

Confirm every changed production line maps to the approved design, summary cards still use `rows`, the default is exported as `enabled`, and no unrelated/untracked user files are staged.

- [ ] **Step 4: Complete the branch workflow**

Use `superpowers:finishing-a-development-branch`, present verified integration options, and follow the user's selected integration path. Do not push unless the user explicitly asks in the current workflow.
