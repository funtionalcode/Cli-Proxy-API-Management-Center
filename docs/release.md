# Release Process

This document defines the release note conventions used by the repo-local
`/release` workflow and `.github/workflows/release.yml`.

The `/release` workflow is CPA Manager Plus specific. It is suitable as a
repo-local Claude command or repo-local Codex skill, but it should not be
installed as a global cross-project skill.

`docs/release-notes/` is reserved for versioned release note files only. Do not
place process documentation or README files inside that directory.

## Release Note Files

```text
docs/release-notes/<tag>-<lang>.md
```

- `<tag>` keeps the `v` prefix, for example `v1.0.2` or `v1.1.0-beta.1`.
- `<lang>` is `zh` for the authored Chinese source or `en` for the English
  mirror translation.
- `zh-CN` is supported by CI as a compatibility fallback, but normal authored
  files should use `zh` and `en`.

Examples:

```text
docs/release-notes/v1.0.2-zh.md
docs/release-notes/v1.0.2-en.md
```

## CI Lookup

On tag pushes, the `Generate release notes` step checks the current tag in this
priority order:

```text
docs/release-notes/<tag>-zh.md
docs/release-notes/<tag>-zh-CN.md
docs/release-notes/<tag>-en.md
```

- If a file is found, it becomes the GitHub Release body.
- If no file is found, CI falls back to `git log --pretty="- %h %s"` for the
  range from the previous tag to the current tag.

The filename must match the pushed tag exactly. Otherwise, CI will use the git
log fallback.

## Writing Template

Chinese is the authored source. Other languages should preserve the same
structure, links, and statistics. Language switch links must be tag-pinned
GitHub blob URLs under `docs/release-notes/` because GitHub Releases render the
curated note body outside that directory.

```markdown
# CPA Manager Plus <version>

> <n> commits · <files> files changed · +<added> / -<deleted>

> [English ->](https://github.com/seakee/CPA-Manager-Plus/blob/<version>/docs/release-notes/<version>-en.md)

## Overview

<One short paragraph describing the release theme and context.>

## Highlights

### Features
- <User-facing capability description> (`<scope>`)

### Fixes
- <What was fixed and the affected scope>

<Keep only non-empty groups as needed: Performance / Refactor / Docs / Chore / CI / Build. Drop merge commits and noise.>

## Upgrade Notes

<Breaking changes, migration steps, or risk notes. Use "None" if not applicable.>

## Acknowledgements

<List external contributors only. Omit the section when there are none.>

- @<contributor> - <one sentence summarizing the contribution>

---

**Full Changelog**: https://github.com/seakee/CPA-Manager-Plus/compare/<previous tag>...<version>
```

## Commit Type Groups

| Type | Group |
|------|-------|
| feat | Features |
| fix | Fixes |
| perf | Performance |
| refactor | Refactor |
| docs | Docs |
| chore | Chore |
| ci | CI |
| build | Build |
