---
description: "Release @takazudo/zudo-design-token-lint — bump the version, write a bilingual changelog, commit + push, wait for CI, then STOP right before the tag push that triggers the npm publish workflow. The user decides when to push the tag. Triggers on rough requests like \"bump version\", \"cut a release\", \"release\", \"make a release\"."
user-invocable: true
argument-description: "Optional: major, minor, patch, next, stable — version bump strategy. Or: cancel — abort/teardown a not-yet-published release."
---

# /l-make-release

Orchestrator for releasing `@takazudo/zudo-design-token-lint`. Bumps the version, writes a bilingual changelog (EN + JA), commits + pushes to `main`, waits for CI, and **stops right before pushing the `v<version>` tag**. Pushing that tag is what triggers `.github/workflows/publish.yml`, which publishes to npm. The user decides when to push.

## Invocation & confirmation

This skill is **model-invocable**: a rough natural-language request like "bump version", "cut a release", or "release" may trigger it. **It must never mutate anything before the user explicitly confirms.** Steps 1–3 are read-only (preconditions, version computation, change analysis); the first mutation is Step 4. Always present the Step 3 proposal (current → new version + categorized changelog) and **wait for explicit user confirmation** before proceeding to Step 4. If the trigger was a loose phrase, restate the proposed bump plainly so the user can catch a wrong version strategy before anything is written.

**Cancel mode.** Invoking `/l-make-release cancel` — or a request like "cancel the release", "abort the release" — does NOT bump anything. It jumps straight to [Cancelling a release](#cancelling-a-release) below to undo a not-yet-published release (delete a local unpushed tag, or revert a bump commit that is still HEAD).

## What this package is

- **Single npm package** — `@takazudo/zudo-design-token-lint`. The **version source-of-truth is the root `package.json`** (`version` field).
- The workspace also contains an Astro doc site under `doc/` (`pnpm-workspace.yaml`). It is **not** published to npm and has no version of its own to bump.

## How publishing works (read before changing anything)

```
/l-make-release  →  bump + changelog + commit + push main  →  CI green  →  STOP
                                                                            │
                                          user runs: git push origin v<version>
                                                                            │
                                          .github/workflows/publish.yml fires
                                                                            │
                                          builds + tests + `pnpm publish`  →  npm
```

The publish workflow triggers on a pushed `v*.*.*` tag — NOT on a GitHub Release. There is no draft-Release intermediate. The irreversible step is **`git push origin v<version>`**; everything this skill does happens before it.

## Boundaries

- This skill **never** pushes the `v<version>` tag — it prints the command for the user to run.
- This skill **never** publishes to npm — `publish.yml` does that when the tag is pushed.

## Step 1: Preconditions

Verify ALL of the following. If any check fails, stop with a clear message.

1. Current branch is `main` (`git branch --show-current`).
2. Working tree is clean (`git status --porcelain` returns empty).
3. `gh` CLI is authenticated (`gh auth status`).
4. Local `main` is up to date with `origin/main` (`git fetch origin && git status -sb`). If behind, pull first.
5. Fetch tags so the changelog base is correct: `git fetch --tags origin`.
6. At least one `v*` tag SHOULD exist (`git tag -l 'v*'`). If none exists this is the very **first** release — see the note in Step 3. (The initial `v1.0.0` was bootstrapped manually outside this skill; from then on this skill drives every release.)

## Step 2: Determine Next Version

Read the current version from the root `package.json`:

```bash
node -p "require('./package.json').version"
```

Apply the rules based on the optional argument:

### No argument

- If current is `X.Y.Z-next.N` (prerelease): propose `X.Y.Z-next.{N+1}` (e.g. `1.1.0-next.3` → `1.1.0-next.4`).
- If current is stable `X.Y.Z`: propose `X.{Y+1}.0-next.1` (e.g. `1.0.0` → `1.1.0-next.1`).

### `next` argument (from stable)

- Force-start a new minor prerelease: `X.{Y+1}.0-next.1` (e.g. `1.0.0` → `1.1.0-next.1`).

### `major` argument

- Bump major, reset minor+patch, start prerelease: `{X+1}.0.0-next.1` (e.g. `1.2.0` → `2.0.0-next.1`).

### `minor` argument

- Bump minor, reset patch, start prerelease: `X.{Y+1}.0-next.1`.

### `patch` argument

- Bump patch, start prerelease: `X.Y.{Z+1}-next.1`.

### `stable` argument

- Strip the `-next.N` suffix from the current prerelease (e.g. `1.1.0-next.5` → `1.1.0`).
- Requires the current version to be a `-next.N` prerelease. If it is already stable, stop with an error.

> The normal flow is: cut one or more `…-next.N` prereleases (which publish to the `next` dist-tag for testing), then run `/l-make-release stable` to promote the same version to a stable `latest` release.

## Step 3: Analyze Changes and Propose

Find the latest version tag and analyze commits since it:

```bash
git fetch --tags origin
LAST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -1)
git log "${LAST_TAG}..HEAD" --oneline   # if no tag exists, use the full history
```

Categorize each commit by its conventional-commit prefix:

- **Breaking Changes**: commits with `!` suffix (e.g. `feat!:`) or `BREAKING CHANGE` in the body
- **Features**: `feat:` prefix
- **Bug Fixes**: `fix:` prefix
- **Other Changes**: everything else (`docs:`, `chore:`, `refactor:`, `ci:`, `test:`, `style:`, `perf:`, etc.)

Present the proposal to the user:

```
Proposed bump: {current} → {new} ({type})

Breaking Changes:
- description (hash)

Features:
- description (hash)

Bug Fixes:
- description (hash)

Other Changes:
- description (hash)
```

Only show sections that have entries. **Wait for explicit user confirmation before proceeding to Step 4.**

## Step 4: Bump + Bilingual Changelog

### 4a. Bump the version

Update the `version` field in the root `package.json` to the confirmed new version (without the `v` prefix). Nothing else needs to be bumped — the doc site is not published.

### 4b. Write the bilingual changelog

Read `doc/src/content/CLAUDE.md` first — it defines the bilingual + translation rules. Then create BOTH:

- `doc/src/content/docs/changelog/v<version>.mdx` (English)
- `doc/src/content/docs-ja/changelog/v<version>.mdx` (Japanese)

Match the format of the existing entries (read `doc/src/content/docs/changelog/v0.2.0.mdx` and its JA counterpart). Frontmatter:

```mdx
---
title: v<version>
description: <one-line summary>
sidebar_position: <computed>
category: changelog
---

<short intro sentence>

- entry (hash)
- entry (hash)
```

Rules:

- `sidebar_position` = (lowest existing changelog `sidebar_position`) − 1. Existing entries count **down** (`9999`, `9998`, `9997`, …) so newer releases sort above older ones under the category's `sortOrder: "desc"`. Read the existing entries to find the current lowest value.
- The JA file mirrors the EN file: **translate prose to Japanese**, keep code blocks / inline code / identifiers / `sidebar_position` / `category` identical (see `doc/src/content/CLAUDE.md`).
- Each entry: a short description; append the commit short hash in parentheses when it maps to a single commit.

## Step 5: Build + Test

```bash
pnpm build && pnpm test
```

Also confirm the new changelog passes the Astro content schema:

```bash
pnpm build:doc
```

If anything fails, stop and tell the user. Do not proceed.

## Step 6: Atomic Commit + Push

Stage and commit the bumped files atomically in a **single commit**:

```bash
git add package.json \
  doc/src/content/docs/changelog/v<version>.mdx \
  doc/src/content/docs-ja/changelog/v<version>.mdx
git commit -m "chore(release): bump to v<version>"
git push origin main
BUMP_SHA=$(git rev-parse HEAD)
```

> **Assumption:** `main` is unprotected, so the bump commit can be pushed directly (this also mirrors how CI fires on push to `main`). If branch protection is ever added to `main`, this step must change to a PR-based flow — open a branch, push the bump there, open a PR, merge it, and use the merge commit as `BUMP_SHA`.

## Step 7: Wait for CI on the Bump Commit

Delegate CI polling to `/watch-ci` — do NOT reimplement polling:

```
Skill(skill="watch-ci", args="--branch main --commit <BUMP_SHA>")
```

If CI fails, fix the issue, commit the fix, push, and re-invoke `/watch-ci` before proceeding.

## Step 8: Notify + STOP (do NOT push the tag)

Print the message below **verbatim** (substitute the actual version for `<version>`). Then STOP — do not push the tag, do not publish.

```
============================================================
Release bump committed and pushed to main.
CI on the bump commit: PASSED.

NEXT STEP — push the tag to trigger the npm publish workflow:

  git tag v<version> && git push origin v<version>

That fires .github/workflows/publish.yml, which builds, tests, and
publishes @takazudo/zudo-design-token-lint to npm.

Dist-tag (handled automatically by the workflow):
  - prerelease (…-next.N) → published under the "next" dist-tag
  - stable (X.Y.Z)        → published under "latest"

After pushing the tag, watch the run and verify:

  gh run watch
  npm view @takazudo/zudo-design-token-lint version dist-tags
============================================================
```

## Dist-tag policy

Implemented in `.github/workflows/publish.yml` — the dist-tag is derived purely
from the version string (the workflow always passes `--tag` explicitly), documented
here so the version strategy in Step 2 makes sense:

- **Prerelease** versions (matching `-next.`, `-beta.`, or `-rc.`) publish to the npm `next` dist-tag. `npm i @takazudo/zudo-design-token-lint@next` installs the latest prerelease.
- **Stable** versions (clean `X.Y.Z`) publish to `latest`. `next` is **not** auto-advanced, so a tagless `npm i @takazudo/zudo-design-token-lint` always gets the newest stable.

`next` is an opt-in **preview side-channel**, kept distinct from `latest` and never mirrored onto it. After a stable ships, `@next` may still point at the previous prerelease (older than `latest`) until the next prerelease is published — this is expected and harmless: consumers on `@next` are opting into previews, and the next prerelease moves the tag forward. To jump `@next` ahead manually if ever needed:

```bash
npm dist-tag add @takazudo/zudo-design-token-lint@<newest-prerelease> next
```

## Cancelling a release

Use this when the user runs `/l-make-release cancel` (or "abort/cancel the release"), or a problem is found after the bump commit but **before** the tag was pushed.

1. **Delete a local, unpushed tag** if one was created by mistake (`git tag -d v<version>`). If the tag was already pushed, do NOT delete it remotely — a pushed `v*` tag may have already triggered a publish; treat it as live.
2. **Decide whether to undo the bump commit.** Check where it sits:

   ```bash
   git rev-list --count <BUMP_SHA>..HEAD
   ```

   - **`0` — the bump is still HEAD** (nothing built on top): revert it. The atomic Step 6 commit means one revert undoes `package.json` and both changelog files together:

     ```bash
     git revert --no-edit <BUMP_SHA>
     git push origin main
     ```

   - **`>0` — the bump is buried under later commits**: do NOT revert or rewrite history. The stale version number is harmless — the next release simply bumps from it and supersedes the abandoned version. Leave it.

## Failure Recovery

- **Build/test failure (Step 5)** — stop and report. Do not commit. Fix and re-run.
- **CI fails on the bump commit (Step 7)** — fix, commit, push, re-invoke `/watch-ci`. Do not advance to Step 8 until CI is green.
- **Wrong version proposed** — the Step 3 confirmation gate is where this is caught. If a wrong version was already committed but the tag has NOT been pushed, use [Cancelling a release](#cancelling-a-release) to revert and re-run.
- **npm publish failed in CI with an OTP / `EOTP` / 2FA error** — `NPM_TOKEN` is not an Automation-type token. Regenerate it as an **Automation** token (or a granular token with 2FA bypass) at npmjs.com and update the repo secret, then re-push the tag (delete + re-push, or use the workflow's `workflow_dispatch`).
