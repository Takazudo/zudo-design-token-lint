---
description: "Release @takazudo/zudo-design-token-lint end-to-end — bump the version, write a bilingual changelog, commit + push, wait for CI, push the v* tag (which triggers the npm publish workflow), watch it to success, then create the GitHub Release. One invoke → published on npm: the single human gate is the Step 3 version-bump proposal, and confirming it authorizes the whole flow through publish. Triggers on rough requests like \"bump version\", \"cut a release\", \"release\", \"make a release\"."
user-invocable: true
argument-description: "Optional: major, minor, patch, next, stable — version bump strategy. Or: cancel — abort/teardown a not-yet-published release."
---

# /l-make-release

End-to-end release orchestrator for `@takazudo/zudo-design-token-lint`. It bumps the version, writes a bilingual changelog (EN + JA), commits + pushes to `main`, waits for CI, then **pushes the `v<version>` tag** — which triggers `.github/workflows/publish.yml` (build + test + `pnpm publish`) — watches that publish run to success, and creates the GitHub Release. **One invocation takes the release all the way to npm.**

The single human gate is the **Step 3 proposal** (current → new version + categorized changelog). Confirming it authorizes the entire flow through publish + GitHub Release — there is no second "push the tag now?" prompt.

## Invocation & confirmation

This skill is **model-invocable**: a rough natural-language request like "bump version", "cut a release", or "release" may trigger it. **It must never mutate anything before the user explicitly confirms.** Steps 1–3 are read-only (preconditions, version computation, change analysis); the first mutation is Step 4.

There is **one gate**: the Step 3 proposal. Confirming it authorizes the whole flow — bump, push, CI, tag, publish, and GitHub Release. Do **not** add a second "push the tag now?" prompt; the user already decided at Step 3. The only thing that can halt the flow after Step 3 is a **build/test failure** (Step 5, before anything is pushed) or a **publish-workflow failure** (Step 9, after the tag is pushed) — see [Failure Recovery](#failure-recovery).

If the trigger was a loose phrase, restate the proposed bump plainly at Step 3 so the user can catch a wrong version strategy before anything is written.

**Cancel mode.** Invoking `/l-make-release cancel` — or a request like "cancel the release", "abort the release" — does NOT bump anything. It jumps straight to [Cancelling a release](#cancelling-a-release) below to undo a not-yet-published release (delete a local unpushed tag, or revert a bump commit that is still HEAD).

## What this package is

- **Single npm package** — `@takazudo/zudo-design-token-lint`. The **version source-of-truth is the root `package.json`** (`version` field).
- The workspace also contains an Astro doc site under `doc/` (`pnpm-workspace.yaml`). It is **not** published to npm and has no version of its own to bump.
- The current version is on the `1.x` line, so the version strategy below is the prerelease (`-next.N`) → stable promotion model — see Step 2.

## How publishing works (read before changing anything)

```
/l-make-release  →  confirm bump (Step 3)  →  bump + changelog + commit + push main  →  CI green
                                                                                          │
                                                  skill pushes:  git push origin v<version>
                                                                                          │
                                                  .github/workflows/publish.yml fires
                                                                                          │
                                                  builds + tests + `pnpm publish`  →  npm
                                                                                          │
                                                  skill watches the run, then creates the GitHub Release
```

The publish workflow triggers on a pushed `v*.*.*` tag — NOT on a GitHub Release. The skill creates the GitHub Release **after** the publish run succeeds (so a failed publish leaves no orphaned Release). The irreversible step is the **tag push** (`git push origin v<version>`); confirming the Step 3 proposal is what authorizes it.

## Boundaries

- The skill **does** push the `v<version>` tag, **does** trigger the publish, and **does** create the GitHub Release — but only after the Step 3 confirmation. It never bypasses that confirmation.
- A **build/test failure** (Step 5) aborts the flow **before** any commit or push — nothing reaches the remote.
- The skill never runs `pnpm publish` directly — publishing is `publish.yml`'s job, triggered by the tag push.
- npm cannot re-publish a version. If the publish workflow fails *after* the tag is pushed (Step 9), the fix is to cut a **new** version, not to retry the same one — see [Failure Recovery](#failure-recovery).

## Step 1: Preconditions

Verify ALL of the following. If any check fails, stop with a clear message.

1. Current branch is `main` (`git branch --show-current`).
2. `gh` CLI is authenticated (`gh auth status`).
3. Local `main` is up to date with `origin/main` (`git fetch origin && git status -sb`). If behind, pull first.
4. Fetch tags so the changelog base is correct: `git fetch --tags origin`.
5. At least one `v*` tag SHOULD exist (`git tag -l 'v*'`). If none exists this is the very **first** release — see the note in Step 3. (The initial `v1.0.0` was bootstrapped manually outside this skill; from then on this skill drives every release.)

### Resume detection (run before requiring a clean tree)

A previous run — or a manual edit — may have already committed the version bump without pushing the tag (e.g. CI on the bump was still running when the prior run ended). Detect that state before assuming a cold start:

```bash
git fetch --tags origin
CUR=$(node -p "require('./package.json').version")
git tag -l "v$CUR"   # empty output = no tag yet for the current version
```

- **If `v$CUR` does NOT exist**: the current version is un-tagged. First check the working tree:
  - **Dirty** (`git status --porcelain` non-empty) → **STOP**. An un-tagged current version plus uncommitted changes is ambiguous — a half-finished bump, an aborted prior run, or stray edits. Ask the user to commit, stash, or discard the changes before re-running; do NOT resume or bump over a dirty tree.
  - **Clean** → this is a RESUME. Find the commit that introduced the current version (do NOT assume it is `HEAD`):

    ```bash
    BUMP_SHA=$(git log -1 --format=%H -S"\"version\": \"$CUR\"" -- package.json)
    ```

    Tell the user the bump for `v$CUR` is already committed (`$BUMP_SHA`) and offer to **RESUME** — this skips Steps 2–6 (bump / changelog / commit) and continues from **Step 7** (CI wait) onward, tagging **`$BUMP_SHA`**, through the same push-tag → publish → GitHub Release path. The resume confirmation stands in for the Step 3 gate. If `$BUMP_SHA` is not the current `HEAD`, later commits landed on top — surface that and let the user choose: tag `$BUMP_SHA` as-is, or abort and cut a fresh bump that includes the newer commits.
- **If `v$CUR` already exists**: the current version is released. Proceed with a normal cold-start bump (Steps 2–6). Require a **clean working tree** (`git status --porcelain` empty) on this cold-start path too.

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

## Step 3: Analyze Changes and Propose — THE GATE

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

Only show sections that have entries. **Wait for explicit user confirmation before proceeding to Step 4.** Confirming here authorizes the full flow through `pnpm publish` and the GitHub Release — the only thing that can stop it afterward is a build/test failure (Step 5) or a publish-workflow failure (Step 9).

## Step 4: Bump + Bilingual Changelog

### 4a. Bump the version

Update the `version` field in the root `package.json` to the confirmed new version (without the `v` prefix). Nothing else needs to be bumped — the doc site is not published.

### 4b. Write the bilingual changelog

Read `doc/src/content/CLAUDE.md` first — it defines the bilingual + translation rules. Then create BOTH:

- `doc/src/content/docs/changelog/v<version>.mdx` (English)
- `doc/src/content/docs-ja/changelog/v<version>.mdx` (Japanese)

Match the format of the existing entries (read `doc/src/content/docs/changelog/v1.1.0-next.1.mdx` and its JA counterpart). Frontmatter:

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

If anything fails, stop and tell the user. Do not commit. This is the last halt point before anything reaches the remote.

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

If `/watch-ci` is unavailable in the running session, fall back to a direct poll:

```bash
gh run watch "$(gh run list --branch main --commit <BUMP_SHA> --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

If CI fails, fix the issue, commit the fix, push, and re-watch before proceeding. **A fix commit moves the green commit off the original `BUMP_SHA` — refresh it so the tag in Step 8 points at the commit whose CI actually passed, never the stale pre-fix commit:**

```bash
BUMP_SHA=$(git rev-parse HEAD)   # only after CI on THIS commit is green
```

Do not advance to the tag push until CI on the bump commit is green.

## Step 8: Push the Tag (triggers the publish)

Mint the tag on the **green** bump commit and push it — the push is what fires `.github/workflows/publish.yml`. Tag `$BUMP_SHA` as carried from Step 7 (refreshed if a CI-fix commit was added there), never a stale pre-fix commit:

```bash
git tag "v<version>" "$BUMP_SHA"
git push origin "v<version>"
```

The `v*.*.*` tag push triggers the publish workflow. Do NOT ask "push the tag now?" — the Step 3 confirmation already authorized this.

## Step 9: Watch the Publish Workflow

Find the run `publish.yml` started for this tag and watch it to completion. Match the run by its **head commit** (`$BUMP_SHA`, the tagged commit) — that is deterministic for a tag push, whereas `headBranch` is often empty for tag events. Retry until the run registers, and **fail rather than fall back to an unrelated run** (watching an older successful release would let Step 10 create a Release before this version actually published):

```bash
PUBLISH_RUN=""
for i in $(seq 1 12); do
  PUBLISH_RUN=$(gh run list --workflow publish.yml --limit 15 \
    --json databaseId,headSha,event \
    -q "[.[] | select(.headSha==\"$BUMP_SHA\")][0].databaseId")
  [ -n "$PUBLISH_RUN" ] && break
  sleep 5
done
if [ -z "$PUBLISH_RUN" ]; then
  echo "ERROR: could not find the publish.yml run for v<version> (commit $BUMP_SHA)." >&2
  echo "Inspect 'gh run list --workflow publish.yml' and watch the correct run manually before creating the Release." >&2
  exit 1
fi
gh run watch "$PUBLISH_RUN" --exit-status
```

If the publish workflow fails, surface the failing logs (`gh run view "$PUBLISH_RUN" --log-failed`) and **stop** — the npm publish did not complete. Do NOT create the GitHub Release. See [Failure Recovery](#failure-recovery) (the version cannot be re-published; a code fix needs a new version).

## Step 10: Create the GitHub Release

The publish succeeded — record it on GitHub. Extract the changelog body (everything after the frontmatter) as the release notes. The tag already exists on the remote, so use `--verify-tag`. Add `--prerelease` for a `-next.` / `-beta.` / `-rc.` version:

```bash
awk 'f; /^---$/{c++; if(c==2) f=1}' doc/src/content/docs/changelog/v<version>.mdx > /tmp/zdtl-release-notes.md
PRERELEASE_FLAG=$([[ "<version>" =~ -next\.|-beta\.|-rc\. ]] && echo "--prerelease" || echo "")
gh release create "v<version>" --verify-tag --title "v<version>" $PRERELEASE_FLAG \
  --notes-file /tmp/zdtl-release-notes.md
```

## Step 11: Verify dist-tag + Report, then STOP

Confirm the publish landed under the expected dist-tag:

```bash
npm view "@takazudo/zudo-design-token-lint@<version>" version
npm dist-tag ls @takazudo/zudo-design-token-lint
```

The version should appear under **`next`** for a prerelease, **`latest`** for a stable release.

**Warn-only dist-tag check**: if a **prerelease** version is showing under `latest` (or `latest` points at an older prerelease — a known artifact of the very first publish), surface a warning. Do NOT auto-fix — moving a dist-tag is a registry-level mutation that deserves a human:

```bash
npm dist-tag rm @takazudo/zudo-design-token-lint latest        # remove a stray prerelease from latest
# (or repoint once a real stable ships: npm dist-tag add @takazudo/zudo-design-token-lint <stable> latest)
```

Print a final report — published version + dist-tag, the npm package URL (`https://www.npmjs.com/package/@takazudo/zudo-design-token-lint`), the publish workflow run, and the GitHub Release URL — then **STOP**.

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

Use this when the user runs `/l-make-release cancel` (or "abort/cancel the release"), or a problem is found mid-release. What you can undo depends on **how far the flow got** — the tag push (Step 8) is the irreversible boundary.

### The tag has NOT been pushed yet (before Step 8)

Nothing is published — this is fully recoverable.

1. **Delete a local, unpushed tag** if one was minted by mistake (`git tag -d v<version>`).
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

### The tag HAS been pushed (Step 8 done)

A pushed `v*` tag may have already triggered — or completed — a publish. **Treat the version as live.** Do NOT delete the remote tag and do NOT attempt to re-publish that version (npm forbids it). If the publish failed, recover by cutting a **new** version — see [Failure Recovery](#failure-recovery). If it succeeded but you want to retract it, that is a manual `npm unpublish` / `npm deprecate` decision for the user, outside this skill.

## Failure Recovery

- **Build/test failure (Step 5)** — stop and report. Do not commit. Fix and re-run. Nothing reached the remote.
- **CI fails on the bump commit (Step 7)** — fix, commit, push, re-watch CI. Do not push the tag until CI is green.
- **Wrong version proposed** — the Step 3 confirmation gate is where this is caught. If a wrong version was already committed but the tag has NOT been pushed, use [Cancelling a release](#cancelling-a-release) to revert and re-run.
- **Publish workflow fails after the tag was pushed (Step 9)** — the tag exists on the remote but the npm publish did not complete. Inspect `gh run view "$PUBLISH_RUN" --log-failed`.
  - If the failure is **transient** (registry hiccup, runner eviction), re-run the same workflow: `gh run rerun "$PUBLISH_RUN"`. The version was never published, so a clean re-run can still succeed under the same tag.
  - If the fix needs a **code change**, the tag must move to a new commit — npm will not accept the same version twice. Delete and re-cut: `git push origin :refs/tags/v<version>` (delete the remote tag), `git tag -d v<version>` (delete locally), fix the code, then re-run `/l-make-release` (resume detection will pick the un-tagged bump up, or cut a fresh version). A version that already published successfully can never be re-published — cut a new one.
- **npm publish failed in CI with an OTP / `EOTP` / 2FA error** — `NPM_TOKEN` is not an Automation-type token. Scoped publish (`@takazudo/*`) requires 2FA, and only an Automation (or 2FA-bypassing granular) token can publish unattended in CI. Regenerate it as an **Automation** token at npmjs.com, update the repo secret (`gh secret set NPM_TOKEN`), then recover per the "code change" path above (delete + re-cut the tag, or use the workflow's `workflow_dispatch`).
