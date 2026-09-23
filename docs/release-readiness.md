# Release Readiness Gate

This document defines the mandatory pre-release readiness review for CPA Manager Plus.
It runs before the release branch workflow in `docs/release.md`.

When an operator asks to publish a version such as `v1.12.14`, the release process starts here.
Do not create the release branch, write release files, promote `dev`, dispatch the release workflow,
or create a tag until this gate has passed for the reviewed candidate SHA.

The purpose of this gate is to answer one question first:

> Is the current `dev` candidate actually ready to become a release?

The gate is evidence-driven and risk-based. It must not become a fixed checklist that forces
unrelated manual testing on every release.

## Candidate And Evidence

Record the current remote `dev` tip as the **readiness candidate SHA** and evaluate the exact range
from the previous stable release tag through that SHA.

The readiness record must contain:

- target version and previous stable tag;
- readiness candidate SHA;
- release-relevant PRs and issues in the candidate range;
- product/runtime/data/upgrade/deployment/UI risk summary;
- UI risk class (`UI-0`, `UI-1`, or `UI-2`);
- required manual QA matrix, when applicable;
- findings and their disposition;
- final readiness result: `PASS` or `BLOCKED`.

Automated CI results are supporting evidence, not a substitute for manual product validation when
manual validation is required below.

## Readiness Review Dimensions

Review only dimensions materially affected by the candidate, but explicitly consider each one:

1. **Product scope and responsibility boundary**
   - Confirm the release contains only intended 1.x work.
   - Identify unfinished or accidentally included behavior.
   - Check open issues/PRs that can invalidate the release scope.
   - Reject architecture-level expansion that belongs to 2.0 or upstream CPA.

2. **Runtime and upstream contracts**
   - Check CPA/API/provider/quota/subscription contract changes.
   - Check unknown or future fields, fallback behavior, and round-trip preservation when relevant.
   - Check state-machine, concurrency, retry, and error-path changes introduced by the release.

3. **Data and upgrade safety**
   - Check SQLite schema/migrations, cache rebuild behavior, persistence compatibility, and old data.
   - Check configuration or environment-variable changes.
   - Check direct upgrade from the previous supported stable release.

4. **Deployment and packaging**
   - Check Docker, native package, compose/config, first install, and existing-install upgrade paths
     when affected.
   - Check non-default deployment modes when the changed code touches their shared path.

5. **UI and UX impact**
   - Classify UI risk using the rules below.
   - Generate a release-specific manual QA matrix from the actual changed surfaces and shared
     components instead of using a universal page list.

## UI Risk Classes

### UI-0 — no meaningful UI risk

Use `UI-0` when there is no UI change or only a trivial copy-only change with no layout or
interaction impact.

Manual UI walkthrough is not required. Automated checks and targeted content review are sufficient.

### UI-1 — targeted UI validation

Use `UI-1` for a localized change such as one page, one component, or a small interaction that does
not materially change shared layout or navigation.

Generate a targeted manual QA matrix covering the directly affected states and the most relevant
shared-component consumers. The operator may record the result without a full application walkthrough.

### UI-2 — mandatory detailed manual walkthrough

Use `UI-2` when the release changes a broad or shared UI surface, including examples such as:

- page or navigation restructuring;
- list/detail redesigns;
- table/card mode changes;
- responsive layout or column-width behavior;
- initialization or upgrade flows;
- shared dialogs, selects, tables, cards, layout primitives, or global styling/tokens;
- changes likely to alter long-text, localization, or multi-window quota layouts across screens.

`UI-2` is a hard readiness gate. The release cannot proceed until the operator explicitly confirms
that the generated manual QA matrix passed, with any findings either fixed or consciously accepted as
non-blocking.

## Manual UI QA Matrix

Build the matrix dynamically from the changed surfaces. Include only applicable dimensions, but
consider the following categories:

- **Data states:** normal, loading, empty, error, disabled/unavailable, expired, missing/unknown fields,
  and unusually dense real-world data.
- **Variant states:** table/card or other display modes, plan/provider/model variants, quota-window
  counts, and feature-specific states changed by the release.
- **Localization:** Chinese, English, Russian, and any other affected locale; explicitly inspect long
  translated labels and overflow when layout-sensitive UI changed.
- **Appearance and layout:** light/dark/system where relevant, supported viewport widths, wrapping,
  clipping, unexpected horizontal scrolling, alignment, and unstable column/card sizing.
- **Interaction:** search, filter, sort, navigation, back/return state, menus, dialogs, tooltips,
  destructive actions, and keyboard/focus behavior where the changed surface uses them.
- **Shared-component regression:** identify other screens that consume changed shared components and
  include representative regression checks outside the primary feature page.

For a `UI-2` release, the generated checklist must name the concrete pages/components and states to
walk through. A generic `Manual UI check` checkbox is not sufficient evidence.

## Findings And Blocking Rules

Classify findings by release impact rather than by how difficult they are to fix:

- **Blocking:** broken primary workflow, data loss/corruption risk, migration failure, serious runtime
  contract break, inaccessible critical action, severe layout failure, or a regression that materially
  violates the intended release behavior.
- **Non-blocking:** known limitation or cosmetic issue that does not invalidate the release and is
  explicitly accepted for this version.
- **Out of scope:** valid issue not introduced by or required for this release. Track separately; do not
  expand the release into unrelated refactoring.

A finding must not silently disappear from the readiness record. Record whether it was fixed,
accepted as non-blocking, or moved out of scope.

## SHA Binding And Invalidation

Readiness approval is bound to the exact readiness candidate SHA, not to the moving `dev` branch.

If `dev` advances after `PASS`:

1. stop the release flow;
2. compare the old candidate SHA with the new `dev` SHA;
3. re-evaluate only the dimensions affected by the new delta;
4. preserve prior manual evidence only when the new delta cannot affect it;
5. run new targeted manual QA when the delta touches previously reviewed UI/runtime/data paths;
6. record the new readiness candidate SHA before continuing.

A release-notes-only or other provably non-runtime delta does not require blindly repeating unrelated
UI walkthroughs. A shared UI/runtime change does.

The same rule applies if a blocking finding is fixed: the fix produces a new candidate SHA and the
readiness record must identify which prior evidence remains valid and which checks were repeated.

## Required Handoff To The Release Workflow

Gate 0 passes only when all of the following are true:

- the candidate scope is understood and acceptable;
- no unresolved blocking readiness finding remains;
- required automated evidence is green or explicitly accounted for;
- required `UI-1`/`UI-2` manual QA is complete;
- `UI-2` has explicit operator confirmation;
- the readiness candidate SHA still equals the current remote `dev` tip.

The handoff to `docs/release.md` must include at least:

```text
Release Readiness
Version: vX.Y.Z
Candidate dev SHA: <full SHA>
UI risk: UI-0 | UI-1 | UI-2
Runtime risk: Low | Medium | High
Data/upgrade risk: Low | Medium | High
Deployment risk: Low | Medium | High
Manual QA: N/A | PASS | BLOCKED
Findings: <summary or None>
Result: PASS
```

Only after this handoff is `PASS` may the normal release branch, release-content, promotion, dry-run,
and tag/publish gates proceed.

## Relationship To The Existing Release Gates

The complete normal release model is:

```text
Gate 0  Release Readiness
  -> Gate 1  Integrate and Validate
  -> Gate 2  Tag and Publish
```

Gate 0 validates the product candidate. Gate 1 validates the exact release integration and build.
Gate 2 authorizes the irreversible tag/publication operation.

Do not treat the operator's initial request to `publish vX.Y.Z` as permission to skip Gate 0 or as
advance authorization for Gate 2. It starts the release process; irreversible publication still
requires the exact final tag/SHA/dry-run evidence defined by `docs/release.md`.