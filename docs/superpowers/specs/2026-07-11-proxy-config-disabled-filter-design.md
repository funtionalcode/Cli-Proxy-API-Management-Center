# Proxy Configuration Disabled-State Filter Design

## Objective

Add a disabled-state filter to the Proxy Configuration page so disabled items are hidden by default while remaining discoverable through an explicit filter.

## User Experience

The toolbar gains a new status selector next to the existing scope selector. It has three options:

- Enabled: the default; shows only rows that are not disabled.
- Disabled: shows only disabled rows.
- All: shows both enabled and disabled rows.

The status filter composes with the existing scope and search filters. Changing the status filter does not change the summary cards because those cards currently describe the complete configuration inventory rather than the filtered table.

## Disabled-State Semantics

Each `ProxyConfigRow` receives an explicit enabled state:

- Global proxy configuration is enabled.
- Gemini, Codex, Claude, and Vertex API-key rows are enabled because their current entry types do not expose a disabled field.
- OpenAI-compatible API-key rows inherit the containing `OpenAIProviderConfig.disabled` value. If the provider is disabled, every API-key row generated for that provider is disabled.
- Authentication-file rows are disabled when `AuthFileItem.disabled === true`.
- Missing, false, null-like, or unknown disabled values are treated as enabled.

The proxy URL status (`override`, `inherit`, `direct`, `unset`, or `invalid`) remains independent from the enabled state.

## Data Model and Filtering

Introduce a dedicated `ProxyConfigEnabledState` type with `enabled` and `disabled` values, plus a `ProxyConfigEnabledFilter` type that also includes `all`.

`buildProxyConfigRows` assigns the enabled state while it still has access to the source Provider or authentication-file record. `filterProxyConfigRows` accepts the enabled filter together with scope and search, and applies all three conditions in one pure filtering pass.

Export a default filter constant set to `enabled` and use it to initialize the page state. Keeping the default in the model makes the product default explicit and directly testable.

## UI Layout

Add a status field using the existing `Select` component. The desktop toolbar becomes:

1. Search
2. Scope
3. Status
4. Refresh

On mobile, the existing one-column toolbar behavior remains unchanged. The new field reuses the scope field styling rather than introducing a new visual system.

## Localization

Add localized labels for the status filter and its Enabled, Disabled, and All options in:

- English
- Simplified Chinese
- Traditional Chinese
- Russian

## Testing

Extend `proxyConfigModel.test.ts` before production changes to cover:

1. Authentication files map `disabled=true` to a disabled row.
2. A disabled OpenAI-compatible provider marks all of its API-key rows disabled.
3. Global and Provider rows without an explicit disabled field remain enabled.
4. Enabled, disabled, and all filters return the expected rows.
5. Status filtering composes with scope and search filtering.
6. The exported default filter is `enabled`.

After implementation, run the focused model tests, the full test suite, TypeScript checking, and the production build.

## Non-Goals

- Persisting the selected status filter across sessions.
- Adding enable/disable mutation controls to the Proxy Configuration page.
- Changing summary-card counts to reflect table filters.
- Adding disabled fields to Provider types that do not currently expose them.
- Refactoring unrelated proxy editing or authentication-file behavior.
