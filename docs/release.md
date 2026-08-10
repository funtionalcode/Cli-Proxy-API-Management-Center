# Release Process

This document defines the release note conventions used by the repo-local
`/release` workflow and `.github/workflows/release.yml`.

The `/release` workflow is CPA Manager Plus specific. It is suitable as a
repo-local Claude command or repo-local Codex skill, but it should not be
installed as a global cross-project skill.

`docs/release-notes/` is reserved for versioned release note files only. Do not
place process documentation or README files inside that directory.

Formal release notes are technical release records. Community-facing release
copy is authored separately so it can prioritize user value and readability
without weakening the technical notes.

## Release Branch Flow

`main` is the stable default branch. `dev` is the integration branch. Every
release follows this sequence:

```text
release/<version> -> dev -> main -> v<version> tag -> GitHub Release
```

1. Freeze the intended release scope on `dev`; do not merge unrelated work
   until the tag is created.
2. Create `release/<version>` from `dev`, add the two release-note files and
   the Telegram post, then merge its release PR into `dev` with a merge commit
   (not squash or rebase).
3. Record the resulting `dev` commit from that release PR as the release SHA.
   Before promotion, confirm that `dev` still points to that exact SHA.
4. Open a same-repository `dev -> main` promotion PR. It must pass the normal
   PR checks and the `Verify dev promotion source` gate before merging with a
   merge commit. Squash and rebase merges are rejected by release preflight.
5. Reconfirm that the resulting `main` commit contains the recorded release
   `dev` SHA, then run the release workflow dry-run from that `main` commit.
6. Create the tag from the exact `main` commit that passed the dry-run.

Do not open a release PR directly to `main`: branch protection permits only
the repository's `dev` branch to promote into `main`.

`main` can contain a prior `dev -> main` merge commit that is not an ancestor
of the current `dev` ref. This is normal. Before a new release, require that
`main` has no non-merge commits absent from `dev`; investigate and stop if it
does. The release scope is still invalid if `dev` advances after the release PR
is merged: refresh the notes and repeat the release preflight rather than
including unreviewed changes in the tag.

## Release Note Files

```text
docs/release-notes/<tag>-<lang>.md
```

- `<tag>` keeps the `v` prefix, for example `v1.0.2` or `v1.1.0-beta.1`.
- `<lang>` is `zh` for the authored Chinese source or `en` for the English
  mirror translation. The release validator requires both exact filenames;
  historical `zh-CN` files are not used as a publishing fallback.

Examples:

```text
docs/release-notes/v1.0.2-zh.md
docs/release-notes/v1.0.2-en.md
```

## Community Release Post

Each new release must include a reviewed Telegram post:

```text
docs/release-posts/<tag>-telegram.html
```

Example:

```text
docs/release-posts/v1.0.2-telegram.html
```

The repo-local `/release` workflow drafts this file before confirmation and
shows the exact message in the release plan. Commit it in the same release PR
as the Chinese and English release notes. Do not generate or rewrite the post
inside GitHub Actions.

Write the post for users and community members rather than code reviewers:

- use `## <M> 月 <D> 日 v<version>` as the Markdown heading, with `更新内容`,
  `注意事项`, `发布截图`, and `致谢` sections as applicable; end the Markdown
  summary and release closeout with the separate title
  `CPA-Manager-Plus [<M>月<D>日：<primary benefit>，<supporting benefit>]`;
- make the standalone title reflect the release's main user value, without
  implementation trivia; it is not part of the date/version heading;
- list every release-relevant, user-visible semantic change in `更新内容`; do
  not impose a fixed item count, but merge implementation commits that result
  in the same user behavior;
- keep each bullet to one concise sentence with the product subject and its
  user-visible result; retain necessary product terms but omit CRUD lists,
  commit/file counts, internal paths, tests, demo fixtures, and pure CI noise;
- include `注意事项` only for upgrade, data, compatibility, configuration, or
  meaningful behavior changes that users need to act on or understand;
- include `发布截图` only when a specific screen or workflow should be shown;
- keep `发布截图` and the standalone community-summary title in the Markdown
  release summary only; Telegram HTML must omit both because the workflow does
  not attach media and the title is not part of the message format;
- include acknowledgements only for external contributors and preserve their
  GitHub profile links;
- keep claims factual and grounded in the formal release notes;
- keep the complete HTML body within 3,500 characters.

Markdown community-summary template:

```markdown
## <M> 月 <D> 日 v<version>

### 更新内容

- <用户可感知的更新>

### 注意事项

- <需要升级、配置或兼容性关注的事项>

### 发布截图

<具体页面或操作路径；没有推荐时省略本节>

### 致谢

- [@contributor](https://github.com/contributor) - <贡献带来的用户价值>

CPA-Manager-Plus [<M>月<D>日：<primary benefit>，<supporting benefit>]
```

Omit optional sections that have no content. The Telegram HTML mirrors only
the applicable `更新内容`, `注意事项`, and `致谢` sections; do not append the
standalone Markdown community-summary title.

Telegram posts use a conservative HTML subset supported by the Bot API:

```text
<b> <i> <code> <a href="https://example.com">...</a>
```

Escape other HTML characters. Do not include inline keyboard JSON, bot tokens,
chat IDs, thread IDs, or any other secret in the post file. The release
workflow adds one `View Release` button at send time.

After the GitHub Release job succeeds, `.github/workflows/release.yml` reads the
tag-matched post and sends it through Telegram Bot API `sendMessage`. Configure
these repository secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TELEGRAM_MESSAGE_THREAD_ID  # optional, for a forum topic
```

Missing configuration or a missing post file skips the notification with an
Actions warning. Telegram delivery failure must not roll back or invalidate an
otherwise successful GitHub Release.

## Release CI Contract

`.github/workflows/release.yml` is intentionally fail-closed. A tag push must
use the strict `v<major>.<minor>.<patch>` format with an optional prerelease
suffix such as `-rc.1`; build metadata, floating tags, and malformed versions
are rejected. Numeric prerelease identifiers must not contain leading zeroes.

The PR workflow automatically validates newly added versioned files under
`docs/release-notes/` and `docs/release-posts/` before they can pass the stable
`Required checks` aggregate. The three files for each new release tag must
exist and satisfy the same content rules used by release preflight.

The preflight validates all of the following before building or publishing:

- `docs/release-notes/<tag>-zh.md`, `docs/release-notes/<tag>-en.md`, and
  `docs/release-posts/<tag>-telegram.html` exist and are non-empty;
- the two release notes contain reciprocal tag-pinned GitHub blob links;
- the candidate SHA is the current `main` tip;
- `main` is a two-parent `dev -> main` promotion merge, and `dev` is the
  two-parent release-PR merge;
- the final `main` tree exactly matches the promoted `dev` tree;
- the release merge introduces exactly the three versioned release files and
  no unrelated changes.

There is no commit-log or previous-tag fallback. A missing note or post stops
the workflow before any asset or container publishing. Run the validator
locally with:

```bash
npm run release:validate -- --tag v1.2.3 --content-only
```

For a complete topology check, provide the candidate SHA and fetched protected
refs. The workflow's `workflow_dispatch` path performs this same validation in
dry-run mode and may only be dispatched from `main`; it builds the HTML,
native packages, and Docker image with publishing disabled, while skipping
GitHub Release and Telegram delivery.

Release jobs share a non-canceling `release-publish` concurrency group, so two
tags cannot publish concurrently. Assets are uploaded as an Actions artifact
and reused by the GitHub Release job, which prevents a second build from
silently producing a different release payload. DockerHub publishing is
optional when its credentials are absent; GHCR remains the configured image
registry for normal tag runs.

Telegram delivery is deliberately non-blocking after the GitHub Release is
created. The job summary records `sent`, `skipped-config`,
`skipped-missing-post`, `skipped-invalid-thread`, or `failed-delivery` without
exposing secret values. A failed notification never rolls back a successful
release.

Recovery rules:

1. If pre-tag dry-run fails, fix the source or release files, repeat the Release
   PR/promotion as needed, and rerun the dry-run before creating a tag.
2. If a tagged run fails because the immutable source is invalid, fix it under
   a new version and create a new tag; never move the failed tag. For a transient
   asset or Docker failure, rerun the same immutable tag only after checking
   which registry or artifact stage already succeeded. Publishing across
   registries is deterministic but not transactional.
3. If GitHub Release succeeds and Telegram fails, repair the secret/post or
   retry the workflow and verify the job summary; the release itself remains
   valid.

Before enabling production releases, repository administrators must enforce
the remote controls that local files cannot provide: protected `dev` and
`main` branches, a tag ruleset that permits only the release automation to
create `v*` tags, and immutable GitHub Releases/tags. Never delete, retarget,
or overwrite a published release tag as a recovery step.

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

| Type     | Group       |
| -------- | ----------- |
| feat     | Features    |
| fix      | Fixes       |
| perf     | Performance |
| refactor | Refactor    |
| docs     | Docs        |
| chore    | Chore       |
| ci       | CI          |
| build    | Build       |
