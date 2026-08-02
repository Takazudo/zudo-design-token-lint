---
description: "Release @takazudo/zudo-design-token-lint end-to-end — bump the version, write a bilingual changelog, commit + push, wait for CI, push the v* tag (which triggers the npm publish workflow), watch it to success, then create the GitHub Release. STABLE-BY-DEFAULT: with no argument it judges the level from conventional commits (breaking → major, feat → minor, else patch) and lands a clean stable version directly — no intermediate prerelease cycle. `next` is the explicit opt-in escape hatch for a prerelease soak. One invoke → published on npm: the single human gate is the Step 3 version-bump proposal, and confirming it authorizes the whole flow through publish. Triggers on rough requests like \"bump version\", \"cut a release\", \"release\", \"make a release\"."
user-invocable: true
argument-description: "Optional: major, minor, patch — force a direct STABLE bump at that level (skips any prerelease). next, or next major|minor|patch — explicit opt-in prerelease: starts or continues an X.Y.Z-next.N line. stable — promote the current prerelease to its clean triple (errors if already stable). No argument — commit-judged direct stable bump (breaking commit → major, feat: → minor, else patch); when promoting from a -next.N version, the judgment runs against the last STABLE tag. Or: cancel — abort/teardown a not-yet-published release."
---

# /l-make-release

End-to-end release orchestrator for `@takazudo/zudo-design-token-lint`. It bumps the version, writes a bilingual changelog (EN + JA), commits + pushes to `main`, waits for CI, then **pushes the `v<version>` tag** — which triggers `.github/workflows/publish.yml` (build + test + `pnpm publish`) — watches that publish run to success, and creates the GitHub Release. **One invocation takes the release all the way to npm.**

**STABLE-BY-DEFAULT.** With no argument, this skill judges the bump level from conventional commits and lands a clean `X.Y.Z` version directly on the npm `latest` tag — no intermediate `-next.N` cycle. A prerelease soak is available but is now an explicit opt-in via the `next` argument, not the default path. See [Step 2](#step-2-determine-next-version) for the full argument matrix and the [History](#history) note on why this changed.

The single human gate is the **Step 3 proposal** (current → new version + categorized changelog). Confirming it authorizes the entire flow through publish + GitHub Release — there is no second "push the tag now?" prompt.

## Invocation & confirmation

This skill is **model-invocable**: a rough natural-language request like "bump version", "cut a release", or "release" may trigger it. **It must never mutate anything before the user explicitly confirms.** Steps 1–3 are read-only (preconditions, version computation, change analysis); the first mutation is Step 4.

There is **one gate**: the Step 3 proposal. Confirming it authorizes the whole flow — bump, push, CI, tag, publish, and GitHub Release. Do **not** add a second "push the tag now?" prompt; the user already decided at Step 3. The only thing that can halt the flow after Step 3 is a **build/test failure** (Step 5, before anything is pushed) or a **publish-workflow failure** (Step 9, after the tag is pushed) — see [Failure Recovery](#failure-recovery).

If the trigger was a loose phrase, restate the proposed bump plainly at Step 3 so the user can catch a wrong version strategy before anything is written. This matters more now than under the old prerelease-first model: a no-argument invocation lands directly on `latest` in one cycle, so Step 3 is the only checkpoint before a stable version becomes permanent.

**Cancel mode.** Invoking `/l-make-release cancel` — or a request like "cancel the release", "abort the release" — does NOT bump anything. It jumps straight to [Cancelling a release](#cancelling-a-release) below to undo a not-yet-published release (delete a local unpushed tag, or revert a bump commit that is still HEAD).

## What this package is

- **Single npm package** — `@takazudo/zudo-design-token-lint`. The **version source-of-truth is the root `package.json`** (`version` field).
- The workspace also contains an Astro doc site under `doc/` (`pnpm-workspace.yaml`). It is **not** published to npm and has no version of its own to bump.
- The version strategy is **stable-by-default** (see Step 2): a bare invocation lands a clean `X.Y.Z` directly on `latest`. The `-next.N` prerelease line is available on demand via the `next` argument, for a deliberate soak before a risky release.

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

    Tell the user the bump for `v$CUR` is already committed (`$BUMP_SHA`) and offer to **RESUME** — this skips Steps 2–6 (bump / changelog / commit) and continues from **Step 7** (CI wait) onward, tagging **`$BUMP_SHA`**, through the same push-tag → publish → GitHub Release path. The resume confirmation stands in for the Step 3 gate. If `$BUMP_SHA` is not the current `HEAD`, later commits landed on top — surface that and let the user choose: tag `$BUMP_SHA` as-is, or abort and cut a fresh bump that includes the newer commits. This resume logic is **version-agnostic** — it works identically whether `$CUR` is a stable `X.Y.Z` or a `-next.N` prerelease, since it only cares about the version string already sitting in `package.json`.
- **If `v$CUR` already exists**: the current version is released. Proceed with a normal cold-start bump (Steps 2–6). Require a **clean working tree** (`git status --porcelain` empty) on this cold-start path too.

## Step 2: Determine Next Version

Read the current version from the root `package.json`:

```bash
node -p "require('./package.json').version"
```

Every argument sets two things: **which component bumps** (major / minor / patch) and **which channel the result lands on** (`latest` for stable, `next` for a prerelease). Stable is the mainline — a bare invocation, and the bare `major`/`minor`/`patch` forms, all land directly on `latest`. `next` is the one explicit opt-in for a prerelease soak.

### No argument — commit-judged, direct stable

1. **Judge the level** from the Step 3 commit categorization (run this analysis before finalizing the version — see [Step 3](#step-3-analyze-changes-and-propose--the-gate)):
   - any **Breaking Change** (`!` suffix or `BREAKING CHANGE` in the body) → **major**
   - else any `feat:` → **minor**
   - else → **patch**
2. **Compute the target version:**
   - **From a stable `X.Y.Z`** — analyze commits since the **last tag** (any tag, since the last tag IS the last stable one when the current version is already stable) and bump the judged component directly: patch → `X.Y.{Z+1}`, minor → `X.{Y+1}.0`, major → `{X+1}.0.0`.
   - **From a prerelease `X.Y.Z-next.N`** — **promote to a stable version**, but derive the level by analyzing commits against the **last STABLE tag** (not the prerelease tag), so a `feat:` or breaking commit landed *during* the `-next` soak still counts toward the level even if the prerelease line understated it when it started. In the common case this reproduces the release triple already in `X.Y.Z-next.N` (drop the suffix); it only escalates past that triple when the last-stable-tag analysis finds a level higher than what the prerelease line assumed.
3. **No-qualifying-commits case.** If the commits since the base tag contain no `feat:`/breaking commit at all — note a `fix:`-only range is normal and does NOT trigger this case, only a range with nothing above `docs:`/`chore:`/`refactor:`/`ci:`/`test:`/etc. does — the "else → patch" rule still applies — propose a patch bump — but **flag this explicitly at the Step 3 gate** (e.g. "No feat: or breaking commits found since `<base-tag>`; proposing a patch bump — confirm this is what you want to release"). This exists to catch an accidental invocation with nothing release-worthy to ship, since a no-argument release now lands on `latest` in one step with no prerelease buffer.

### `major` | `minor` | `patch` argument — force a direct stable bump

Bump that component of the current version's **release triple** (its `X.Y.Z`, ignoring any `-next.N` suffix) and land the result **stable**, straight to `latest` — no intermediate prerelease, whether the current version is already stable or a prerelease:

- `major`: `{X+1}.0.0`
- `minor`: `X.{Y+1}.0`
- `patch`: `X.Y.{Z+1}`

> **Deliberate deviation from the zfb release skill**, which this repo's flow is otherwise modeled on: in zfb, a bare `major`/`minor`/`patch` argument forces a **prerelease** (`X.Y.Z-next.1`) and `stable <level>` is the separate form for a direct stable bump. This repo folds that into the bare level args instead — `major`/`minor`/`patch` go straight to stable — because this repo doesn't use `next` as a matter of course, and the Step 3 confirmation gate already shows the exact resulting version before anything is written. If a prerelease at a specific level is wanted, use `next major` / `next minor` / `next patch` (below).

### `next` argument (optionally `next major|minor|patch`) — explicit opt-in prerelease

The prerelease escape hatch. Starts or continues an `X.Y.Z-next.N` line; never touches `latest`.

- **Bare `next`, from a stable `X.Y.Z`** — judge the level the same way as the no-argument case (commits since the last tag: breaking → major, `feat:` → minor, else → patch) and **start** a prerelease at that level instead of landing it stable: `X.Y.{Z+1}-next.1` / `X.{Y+1}.0-next.1` / `{X+1}.0.0-next.1`.
- **Bare `next`, from a prerelease `X.Y.Z-next.N`** — **continue** the existing line: `X.Y.Z-next.{N+1}`.
- **`next major` | `next minor` | `next patch`** — force a prerelease **restart** at that specific component, computed off the current release triple (same base as the bare level args above), regardless of whether the current version is stable or already a prerelease: `{X+1}.0.0-next.1` / `X.{Y+1}.0-next.1` / `X.Y.{Z+1}-next.1`. Use this to start a soak on a *different* triple than the judged level would pick, or to restart a soak from scratch on the current triple.

### `stable` argument — promote the current prerelease

- Strip the `-next.N` suffix from the current prerelease (e.g. `1.1.0-next.5` → `1.1.0`). This is a **literal strip**, not a commit-judged promotion — it does not re-derive the level from commits the way the no-argument case does. Use the no-argument path instead when you want the last-stable-tag commit analysis to potentially escalate the triple.
- Requires the current version to be a `-next.N` prerelease. **If it is already stable, stop with an error** — there is nothing to promote. (To force a specific stable bump from a stable version, use the bare `major`/`minor`/`patch` arguments above.)

### Exhaustive version-decision table

Worked from the two starting states this repo actually moves between, using the current real version as the canonical prerelease row (`1.1.0-next.3`, npm `latest=1.0.0`, `next=1.1.0-next.3`, last stable tag `v1.0.0`) and its stable analogue (`1.1.0`) as the other starting state. The "no-arg" and bare-`next` rows show all three commit-judgment outcomes since the actual result depends on the commits found; every other row is fixed.

**Starting state: stable `1.1.0`**

| Argument | Resulting version | Channel |
|---|---|---|
| *(no arg)* | `1.1.1` (else) / `1.2.0` (`feat:`) / `2.0.0` (breaking) | `latest` (direct) |
| `major` | `2.0.0` | `latest` (direct) |
| `minor` | `1.2.0` | `latest` (direct) |
| `patch` | `1.1.1` | `latest` (direct) |
| `next` | `1.1.1-next.1` (else) / `1.2.0-next.1` (`feat:`) / `2.0.0-next.1` (breaking) | `next` (start) |
| `next major` | `2.0.0-next.1` | `next` (restart) |
| `next minor` | `1.2.0-next.1` | `next` (restart) |
| `next patch` | `1.1.1-next.1` | `next` (restart) |
| `stable` | **ERROR** — already stable, nothing to promote | — |

**Starting state: prerelease `1.1.0-next.3`** (npm `latest=1.0.0`, `next=1.1.0-next.3`, last stable tag `v1.0.0`)

| Argument | Resulting version | Channel |
|---|---|---|
| *(no arg)* | `1.1.0` (typical — commits since `v1.0.0` don't exceed minor) / escalates to `2.0.0` if a breaking commit landed since `v1.0.0` | `latest` (promote, escalation-aware) |
| `major` | `2.0.0` | `latest` (direct) — **canonical worked case**: `1.1.0-next.3` → `major` → `2.0.0` |
| `minor` | `1.2.0` | `latest` (direct) |
| `patch` | `1.1.1` | `latest` (direct) |
| `next` | `1.1.0-next.4` | `next` (continue) |
| `next major` | `2.0.0-next.1` | `next` (restart) |
| `next minor` | `1.2.0-next.1` | `next` (restart) |
| `next patch` | `1.1.1-next.1` | `next` (restart) |
| `stable` | `1.1.0` | `latest` (promote, literal strip) |

Two derivation rules that make the prerelease-row `no-arg` and `stable` cells differ:

- **No-arg promotion uses the last STABLE tag, not the prerelease tag.** `stable` (bare) always just strips the suffix (`1.1.0-next.3` → `1.1.0`, full stop). No-arg instead re-runs the commit-judgment analysis against `v1.0.0` (the last stable tag) — so if, say, a `feat!:` commit landed partway through the `-next.1` → `-next.3` soak, no-arg promotion would land `2.0.0`, not `1.1.0`, even though `stable` would still literal-strip to `1.1.0`. This is why the epic calls out "`feat:` commits during the `-next` line still count toward the level" for no-arg specifically.
- **No-qualifying-commits still proposes patch, but is flagged.** Whether starting from stable or prerelease, if the relevant commit range has no `feat:`/breaking commits at all, no-arg proposes a patch bump per the "else" branch — but Step 3 must call this out explicitly rather than silently proposing it, since a no-argument release now goes straight to `latest`.

### Validation (all forms)

After computing the proposed version, before any mutation, it MUST be strictly greater than the current version under semver precedence (a prerelease sorts below its own stable: `1.1.0-next.1` < `1.1.0`). If it is not, stop with an error showing both versions — never bump sideways or backwards.

## Step 3: Analyze Changes and Propose — THE GATE

Find the changelog base tag, then analyze commits since it:

```bash
git fetch --tags origin
```

**Pick the base tag by what you are computing:**

- **Normal case** (no-arg / `major` / `minor` / `patch` / `next` / `next <level>` from a stable current version, or any forced form) — base = the latest `v*` tag:

  ```bash
  BASE_TAG=$(git tag -l 'v*' --sort=-v:refname | head -1)
  ```

- **No-arg promotion from a prerelease** (current version is `X.Y.Z-next.N` and no argument was given) — base = the latest **stable** tag, per the last-stable-tag rule in Step 2:

  ```bash
  BASE_TAG=$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
  ```

  Match stable tags **positively** (bare `vMAJOR.MINOR.PATCH`), not by excluding a `-` suffix — a negative pattern like `grep -v -- '-'` is not portable (`ugrep`, which shadows `grep` on some setups, rejects a bare `-` as a pattern and fails the whole pipeline).

```bash
git log "${BASE_TAG}..HEAD" --oneline   # for the human-readable proposal list (subject + hash)
git log "${BASE_TAG}..HEAD"             # full form, WITHOUT --oneline — read commit bodies too;
                                         # a `BREAKING CHANGE:` footer can appear with no `!` on the
                                         # subject line, and --oneline alone would hide it entirely
```

Categorize each commit by its conventional-commit prefix. Since this categorization now directly decides a stable version (not just changelog wording), read both the subject **and** the body of every commit — do not rely on `--oneline` alone for the categorization pass:

- **Breaking Changes**: commits with a `!` before the colon (e.g. `feat!:`, `feat(scope)!:`) OR a `BREAKING CHANGE` footer in the body, even when the subject line itself is a plain `feat:`/`fix:`
- **Features**: `feat:` prefix, including a scoped subject like `feat(scope):`
- **Bug Fixes**: `fix:` prefix, including a scoped subject like `fix(scope):`
- **Other Changes**: everything else (`docs:`, `chore:`, `refactor:`, `ci:`, `test:`, `style:`, `perf:`, etc.)

This categorization is also what feeds Step 2's no-argument (and bare-`next`) level judgment — do it before finalizing the proposed version. A scoped `feat(scope):` or a body-only `BREAKING CHANGE:` footer that gets missed here silently under-bumps a stable release with no prerelease buffer to catch it later, so err on the side of reading full commit bodies rather than trusting subject lines alone.

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

Only show sections that have entries. **If this is the no-qualifying-commits case** (no argument given, and no `feat:`/breaking commit found in the range — a `fix:`-only or docs/chore-only range both qualify, since neither escalates the level past patch), prepend an explicit callout above the proposal: `No feat: or breaking commits found since <base-tag> — proposing a patch bump. Confirm this is intended before continuing.` Do not say "no fixes found" — a range full of legitimate `fix:` commits also hits this branch and is a perfectly normal patch release; the callout exists to catch a range with nothing release-worthy at all (bare `docs:`/`chore:`/`ci:`), not to cast doubt on fix-only patches.

**Wait for explicit user confirmation before proceeding to Step 4.** Confirming here authorizes the full flow through `pnpm publish` and the GitHub Release — the only thing that can stop it afterward is a build/test failure (Step 5) or a publish-workflow failure (Step 9).

## Step 4: Bump + Bilingual Changelog

### 4a. Bump the version

Update the `version` field in the root `package.json` to the confirmed new version (without the `v` prefix). Nothing else needs to be bumped — the doc site is not published.

### 4b. Write the bilingual changelog

Read `doc/src/content/CLAUDE.md` first — it defines the bilingual + translation rules. Then create BOTH:

- `doc/src/content/docs/changelog/v<version>.mdx` (English)
- `doc/src/content/docs-ja/changelog/v<version>.mdx` (Japanese)

Match the format of the existing entries (read the most recent EN/JA pair under `doc/src/content/docs/changelog/` and `doc/src/content/docs-ja/changelog/`). Frontmatter:

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

Under stable-by-default, `$PRERELEASE_FLAG` is empty on the common path (a no-arg or bare-level release lands stable) and set only when `next` was explicitly used.

## Step 11: Verify dist-tag + Report, then STOP

Confirm the publish landed under the expected dist-tag:

```bash
npm view "@takazudo/zudo-design-token-lint@<version>" version
npm dist-tag ls @takazudo/zudo-design-token-lint
```

The version should appear under **`next`** for a prerelease, **`latest`** for a stable release.

**Stable-release assertion — no stale `next`.** When `<version>` is **stable** (no `-next.`/`-beta.`/`-rc.` suffix), explicitly check the `next` dist-tag entry in the `npm dist-tag ls` output:

- **Expected: no `next` entry at all**, OR a `next` entry whose version is `>=` the just-published `latest` (that second case only applies during a deliberate opt-in soak still in flight on `next` — not the common path). `publish.yml` removes a graduated `next` tag automatically as a guarded step on stable publish (see [Dist-tag policy](#dist-tag-policy) below), so under normal operation `next` should simply be absent after a stable release.
- **Failure case: a `next` entry pointing at an OLDER prerelease than the version just published to `latest`.** This is a stale tag that survived the automated removal (e.g. the guarded step in `publish.yml` didn't run, or ran before this publish in a race). Report it as requiring remediation and give the exact command:

  ```bash
  npm dist-tag rm @takazudo/zudo-design-token-lint next
  ```

  Do NOT run this automatically — moving/removing a dist-tag is a registry-level mutation that deserves a human decision, even though the command itself is safe and idempotent.

**Prerelease-release check (unchanged mechanics)**: if a **prerelease** version is showing under `latest` (or `latest` points at an older prerelease — a known artifact of the very first publish), surface a warning. Do NOT auto-fix:

```bash
npm dist-tag rm @takazudo/zudo-design-token-lint latest        # remove a stray prerelease from latest
# (or repoint once a real stable ships: npm dist-tag add @takazudo/zudo-design-token-lint <stable> latest)
```

Print a final report — published version + dist-tag, the npm package URL (`https://www.npmjs.com/package/@takazudo/zudo-design-token-lint`), the publish workflow run, and the GitHub Release URL — then **STOP**.

## Dist-tag policy

Implemented in `.github/workflows/publish.yml` — the dist-tag is derived purely
from the version string (the workflow always passes `--tag` explicitly), documented
here so the version strategy in Step 2 makes sense:

- **Stable** versions (clean `X.Y.Z`) publish to `latest` — this is the **mainline**. A tagless `npm i @takazudo/zudo-design-token-lint` always gets the newest stable.
- **Prerelease** versions (matching `-next.`, `-beta.`, or `-rc.`) publish to the npm `next` dist-tag. `npm i @takazudo/zudo-design-token-lint@next` installs the latest prerelease. `next` is an **opt-in** preview side-channel, not part of the default install path.
- **Stale-`next` removal is automated by `publish.yml`.** After a stable publish, the workflow runs a guarded step that removes the `next` dist-tag if it points at a version older than the one just published to `latest` — so `@next` can never silently resolve to a stale prerelease once its line has graduated. This mirrors zudo-doc's "Scheme B" release policy. Step 11 above re-verifies this landed; if it didn't, the remediation is a single `npm dist-tag rm` (also shown there).

If a deliberate soak is genuinely still in flight (a `next` prerelease published *after* the current `latest`), that is expected and is not the stale case the automated removal targets — it only fires when `next` is older than the version it would otherwise shadow.

## Cancelling a release

Use this when the user runs `/l-make-release cancel` (or "abort/cancel the release"), or a problem is found mid-release. What you can undo depends on **how far the flow got** — the tag push (Step 8) is the irreversible boundary. This logic is version-agnostic: it works the same whether the release being cancelled was a stable bump or a `next` prerelease.

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
- **Wrong version proposed** — the Step 3 confirmation gate is where this is caught. Under stable-by-default this matters more than it used to: a no-argument or bare-level release lands directly on `latest` with no prerelease buffer, so a version mistake caught only after Step 8 is permanent (npm never allows re-publishing a version). If a wrong version was already committed but the tag has NOT been pushed, use [Cancelling a release](#cancelling-a-release) to revert and re-run. If in doubt about the level, use `next` to soak first.
- **Publish workflow fails after the tag was pushed (Step 9)** — the tag exists on the remote but the npm publish did not complete. Inspect `gh run view "$PUBLISH_RUN" --log-failed`.
  - If the failure is **transient** (registry hiccup, runner eviction), re-run the same workflow: `gh run rerun "$PUBLISH_RUN"`. The version was never published, so a clean re-run can still succeed under the same tag.
  - If the fix needs a **code change**, the tag must move to a new commit — npm will not accept the same version twice. Delete and re-cut: `git push origin :refs/tags/v<version>` (delete the remote tag), `git tag -d v<version>` (delete locally), fix the code, then re-run `/l-make-release` (resume detection will pick the un-tagged bump up, or cut a fresh version). A version that already published successfully can never be re-published — cut a new one.
- **npm publish failed in CI with an OTP / `EOTP` / 2FA error** — `NPM_TOKEN` is not an Automation-type token. Scoped publish (`@takazudo/*`) requires 2FA, and only an Automation (or 2FA-bypassing granular) token can publish unattended in CI. Regenerate it as an **Automation** token at npmjs.com, update the repo secret (`gh secret set NPM_TOKEN`), then recover per the "code change" path above (delete + re-cut the tag, or use the workflow's `workflow_dispatch`).
- **Stale `next` dist-tag survives a stable release (Step 11)** — the guarded removal step in `publish.yml` should handle this automatically; if `npm dist-tag ls` still shows a `next` entry older than the just-published `latest`, remediate by hand: `npm dist-tag rm @takazudo/zudo-design-token-lint next`. Safe and idempotent — re-running it when `next` is already gone is a no-op error you can ignore.

## History

Prior to the 260802 policy sweep, this skill defaulted to a **prerelease-first** model: a bare invocation always cut a `-next.N` version, and a separate `stable` invocation promoted it to `latest`. That model was retired in favor of **stable-by-default** — a bare invocation now judges the level from commits and lands a clean stable version in one cycle, mirroring the same policy shift made upstream in zfb's own `l-make-release` skill ("STABLE-BY-DEFAULT") and in zudo-doc's release runbook ("Scheme B"). `next` remains available as the documented escape hatch for a deliberate soak — it just isn't the default path anymore.
