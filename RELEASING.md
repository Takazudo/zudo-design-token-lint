# Releasing `@takazudo/zudo-design-token-lint`

This is the **single canonical release procedure**. It is the same for a human, local Claude Code
(`.claude/skills/l-make-release/`) and Codex, local or Cloud (`.agents/skills/make-release/`).
Those skills are thin entry points into this file.

The procedure needs nothing outside this repository: no personal/global skills, no fixed local
paths, no npm login, no npm token. Deterministic logic lives in `scripts/release/cli.mjs`
(tested in `scripts/release/release.test.mjs`). The rules that matter are enforced **inside GitHub
Actions** (`.github/workflows/publish.yml`, `.github/workflows/release.yml`), not just written down
here.

## Authority: one human gate

- Steps 1–2 are read-only.
- The **Step 2 proposal** (current → new version, plus the categorized changes) is the only
  confirmation. Confirming it authorizes the whole flow through npm publish and the GitHub Release.
  Do not add a second "push the tag now?" prompt.
- After that, only these can stop the flow:
  - a local build or test failure (Step 4);
  - CI failing on the release commit (Step 6);
  - a refusal or failure in Actions (Step 8).
- Never run `npm publish`, `npm dist-tag` or `gh release create` yourself. Publishing, dist-tag
  maintenance and the GitHub Release are done only by `publish.yml`.

## How publishing works

```
release commit on main ── CI green ──► tag v<version> ──► publish.yml
                                       (git push, or       admit:   exact tag grammar, tag == package.json,
                                        release.yml)                 commit on origin/main, CI push run green
                                                                     for that exact SHA (run id/attempt recorded),
                                                                     registry state absent | published | unknown
                                                            build:   install, test, check-pack, pnpm pack (no id-token)
                                                            publish: pinned npm 11.21.1 publishes the tarball via
                                                                     OIDC trusted publishing (id-token, no install)
                                                            cleanup: stable only: remove `next` iff strictly older
                                                            finalize: idempotent GitHub Release from the changelog
                                                            report:  partial-success summary
```

### Authentication (no tokens)

npm authenticates the `publish` and `cleanup` jobs by exchanging the job's GitHub OIDC token. This
is npm **trusted publishing**. No repository secret is used, and there is no fallback credential.
If trusted publishing is not configured, the job fails with an explicit `auth-failed` outcome.

- `pnpm publish` (pnpm 10.32.0) has no OIDC support of its own: it packs, then spawns `npm publish`.
  The workflow therefore packs with pnpm in the unprivileged build job and publishes the tarball
  with the pinned npm directly. That is the same npm path `pnpm publish` would have used, but the
  OIDC credential is never exposed to dependency install scripts.
- npm **11.21.1** is pinned (`NPM_CLI_VERSION` in `scripts/release/cli.mjs`):
  - `npm dist-tag` supports OIDC from 11.21.0;
  - its engines (`^20.17.0 || >=22.9.0`) accept the Node 22 the workflow already uses;
  - `assert-runtime` also enforces trusted publishing's Node ≥ 22.14.0 minimum and prints both
    versions.
- The jobs run on GitHub-hosted runners only, because npm does not support self-hosted runners
  for this. Provenance comes from `--provenance`.

## Step 0 — Capability preflight (fresh checkout friendly)

```bash
git clone https://github.com/Takazudo/zudo-design-token-lint.git && cd zudo-design-token-lint
corepack enable && pnpm install --frozen-lockfile
node scripts/release/cli.mjs preflight
```

Preflight reports `yes` / `no` / `unknown` for each capability:

- gh authentication;
- repository write;
- reading Actions runs;
- git push (dry-run only);
- being on `main` with a clean tree.

It does not mutate anything. A successful clone does **not** imply push, tag or dispatch rights.
Pick the integration and initiation paths from what preflight reports:

| Capability                               | Use                                               |
| ---------------------------------------- | ------------------------------------------------- |
| push to `main` + push tags               | direct commit (Step 5a) + tag push (Step 7a)      |
| push branches / open PRs, no `main` push | PR integration (Step 5b)                          |
| Actions write (dispatch), no tag push    | `release.yml` initiation (Step 7b)                |
| read-only                                | prepare the PR / proposal only; hand off the rest |

Never add a personal access token to make a step work. If a capability is missing, stop at that
step and report exactly which one.

## Step 1 — Resume detection

```bash
git fetch origin --tags
CUR=$(node -p "require('./package.json').version")
git ls-remote --tags origin "refs/tags/v$CUR"
```

- **Tag `v$CUR` exists** → the current version is released. Cold start: continue to Step 2. A clean
  tree is required.
- **No tag, dirty tree** → stop. Ask the user to commit, stash or discard first.
- **No tag, clean tree** → the bump is already committed. Find it with
  `git log -1 --format=%H -S"\"version\": \"$CUR\"" -- package.json`. Offer to **resume at Step 6**
  with that commit; this confirmation replaces the Step 2 gate. If later commits sit on top of it,
  let the user choose:
  - release that exact commit, or
  - cut a fresh bump that includes the newer commits.
- **Published on npm but no GitHub Release** (check with
  `node scripts/release/cli.mjs registry-state --version "$CUR"` plus `gh release view "v$CUR"`) →
  this is not a new release. Use [Recovery](#recovery).

## Step 2 — Propose the version (THE GATE, non-mutating)

```bash
node scripts/release/cli.mjs plan                 # no argument: commit-judged, stable
node scripts/release/cli.mjs plan --arg "next"    # or: major | minor | patch | next [level] | stable
```

The helper does the following:

- reads the last tags;
- reads **full commit bodies**, so a `BREAKING CHANGE:` footer counts;
- categorizes the commits;
- computes the version under the policy below;
- checks that it is strictly greater than the current version;
- prints the proposal.

If the range has no `feat:` or breaking commits, it prints an explicit callout: confirm that a
patch release is really intended. Show the proposal to the user and **wait for confirmation**.

**Stable-by-default:**

- No argument: breaking → major, `feat:` → minor, otherwise patch, landing a clean `X.Y.Z` on
  `latest`.
- `next` is the explicit opt-in prerelease channel.

| Argument                 | From stable `1.1.0`                              | From prerelease `1.1.0-next.3` (last stable `v1.0.0`)          |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------- |
| _(none)_                 | `1.1.1` / `1.2.0` (feat) / `2.0.0` (break)       | `1.1.0`, escalated if commits since `v1.0.0` need it (`2.0.0`) |
| `major` `minor` `patch`  | `2.0.0` / `1.2.0` / `1.1.1` → `latest`           | `2.0.0` / `1.2.0` / `1.1.1` → `latest`                         |
| `next`                   | judged level `-next.1` (start)                   | `1.1.0-next.4` (continue)                                      |
| `next major/minor/patch` | `2.0.0-next.1` / `1.2.0-next.1` / `1.1.1-next.1` | same (restart)                                                 |
| `stable`                 | **error** (already stable)                       | `1.1.0` (literal strip)                                        |

The base tag for a no-argument promotion from a prerelease is the last **stable** tag. For
everything else it is the newest allowed tag.

## Step 3 — Bump + bilingual changelog

1. Set `version` in the root `package.json`. The doc site is never published or versioned.
2. Read `doc/src/content/CLAUDE.md`, then write both of these, matching the newest existing pair:
   - `doc/src/content/docs/changelog/v<version>.mdx` (EN)
   - `doc/src/content/docs-ja/changelog/v<version>.mdx` (JA)

   Frontmatter: `title: v<version>`, `description`, `category: changelog`, and
   `sidebar_position` = (lowest existing) − 1. Entries are `- text (shorthash)`. JA translates the
   prose and keeps code, identifiers, `sidebar_position` and `category` identical. **The EN body is
   the GitHub Release text** (`release-notes` extracts it), so write it for that audience.

3. Retire the outgoing snapshot banner. `doc/zfb.config.ts` `versions[]` entries carry
   `banner: false` only while their label is the latest release. Find them with
   `grep -nE '^[[:space:]]*banner: false' doc/zfb.config.ts`, set each to `'unmaintained'` and delete
   its "FLIP TO 'unmaintained'" comment. Afterwards `grep -cE ...` must print `0`.

   Creating a **new** snapshot is a separate judgement call; see the comment block in
   `doc/zfb.config.ts`.

## Step 4 — Local verification

```bash
pnpm test && pnpm lint && bash scripts/check-pack.sh && pnpm build:doc
node scripts/release/cli.mjs release-notes --version <version>   # must print the EN body
```

If anything fails, stop. Nothing has left the machine yet.

## Step 5 — Integrate the release commit into `main`

One atomic commit: `chore(release): bump to v<version>` containing `package.json`, both changelog
files, and `doc/zfb.config.ts` if Step 3.3 changed it.

- **5a. Direct (push permitted):** `git push origin main`.
- **5b. PR (no direct push):** push branch `release/v<version>` (never reuse a branch name) and open a
  PR to `main`. Merge it with a regular merge once its checks are green.

Then record the exact commit that will be released:
`SHA=$(git rev-parse origin/main)` after `git fetch origin`. Confirm it carries the bump:
`git show "$SHA:package.json" | grep '"version"'`.

## Step 6 — Wait for CI on that exact commit

```bash
RUN=$(gh run list --workflow ci.yml --event push --commit "$SHA" --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status
```

Use the run for **this SHA**, never "the latest run". If it is empty, wait and retry.

If CI fails, fix it, land the fix (5a/5b), re-record `SHA`, and wait again. `ci.yml` cancels
superseded runs on `main`, so release the commit whose own run is green.

`publish.yml` independently refuses any commit without a successful CI push run for its exact
SHA. It waits up to 30 minutes for one that is in progress.

## Step 7 — Initiate (the irreversible boundary)

Choose by capability. Both paths end in the same `publish.yml` admission.

**7a. Tag push:**

```bash
git tag "v<version>" "$SHA" && git push origin "v<version>"
PUBLISH_RUN=$(gh run list --workflow publish.yml --event push --commit "$SHA" \
  --json databaseId,headBranch -q '[.[] | select(.headBranch=="v<version>")][0].databaseId')
```

**7b. Hosted initiation via `release.yml`** (needs only Actions dispatch). Run a dry run first; it
performs every admission check and mutates nothing:

```bash
gh api -X POST repos/Takazudo/zudo-design-token-lint/actions/workflows/release.yml/dispatches \
  -f ref=main -f 'inputs[version]=<version>' -f "inputs[sha]=$SHA" -f 'inputs[dry_run]=true' \
  -F return_run_details=true            # prints workflow_run_id — watch exactly that run
```

Then dispatch again with `inputs[dry_run]=false`. The `start` job:

1. re-admits;
2. creates the tag at `$SHA` through the API;
3. explicitly dispatches `publish.yml` on that tag, because a tag created with `GITHUB_TOKEN`
   does not trigger workflows;
4. prints `publish_run_id`.

## Step 8 — Watch the publish run and report

```bash
gh run watch "$PUBLISH_RUN" --exit-status
gh run view "$PUBLISH_RUN"           # the "Release report" job summary has the full table
npm view @takazudo/zudo-design-token-lint dist-tags --json
```

Report each of these:

- the publish run ID and attempt;
- the admitted commit;
- the CI run ID and attempt it was admitted on;
- the npm publish outcome. `published now via OIDC` is fresh trusted-publishing evidence;
  `skipped: already on npm` is **not**;
- the stale-`next` cleanup outcome;
- the GitHub Release outcome;
- `https://www.npmjs.com/package/@takazudo/zudo-design-token-lint`.

## Dist-tag policy

- Stable `X.Y.Z` publishes to `latest`. Prereleases (`-next.N`, `-beta.N`, `-rc.N`) publish to
  `next`.
- Publishing to `latest` never advances `next` to the stable version.
- After a stable publish, the `cleanup` job removes `next` **only** when `next` is strictly older
  than the stable version. It rereads `next` immediately before deleting, inside the shared
  non-cancelling `publish` concurrency group. Its outcome is always reported:

  | Outcome                                          | Meaning                                       |
  | ------------------------------------------------ | --------------------------------------------- |
  | `removed`                                        | stale `next` deleted                          |
  | `noop-absent`                                    | no `next` tag                                 |
  | `noop-not-stale`                                 | `next` is equal or newer                      |
  | `skipped-changed`                                | `next` moved between the read and the recheck |
  | `error-query` `error-remove` `error-unconfirmed` | warning; the publish still succeeded          |

- A cleanup error never turns a successful publish into a failed one. To remediate, re-dispatch
  `publish.yml` on the tag. It skips the publish, then re-runs cleanup and finalization.
- **Stale attempts cannot regress tags.** A version that is not newer than the channel's current
  tag is refused, and so is a prerelease that is not newer than `latest`.

## Recovery

Re-dispatch the tag: `gh workflow run publish.yml --ref v<version>`, or re-run the failed run's jobs.
This is always safe:

| Registry state of `<version>`               | What the run does                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `absent`                                    | builds and publishes from the **tag's exact commit**, then cleanup and finalize       |
| `published`, provenance commit = tag commit | skips publish (reported as _not_ fresh OIDC evidence), resumes cleanup and finalize   |
| `published` from another commit             | refuses (`conflicting-publication`)                                                   |
| `unknown` (registry errors)                 | fails after bounded retries and keeps the original errors. It never guesses `absent`. |

- **GitHub Release failed after npm succeeded:** re-dispatch. Finalization is idempotent:
  - it creates the Release if it is missing;
  - it keeps a Release that matches;
  - it publishes a matching draft;
  - it refuses (`release-conflict`) to overwrite a different title, body or prerelease flag.

  Never bump, retag or republish just because of metadata.

- **Publish failed and a code change is needed:** the tag's version was never published. Cut a
  **new** version. Do not move a pushed tag.
- **`auth-failed`:** trusted publishing is misconfigured. Fix it on npmjs.com (see below) and
  re-dispatch. Do not add a token.

## Cancelling

- **Before Step 7:** nothing is published. Delete a local, unpushed tag with `git tag -d`. If the
  bump commit is still `main`'s tip, revert it (`git revert`, then integrate via 5a or 5b).
  Otherwise leave it: the next release supersedes it.
- **After Step 7:** treat the version as live. Do not delete remote tags. Retraction
  (`npm deprecate`) is the owner's decision.

## npm trusted publisher (owner settings)

On npmjs.com, open `@takazudo/zudo-design-token-lint` → Settings → Trusted publishing → GitHub
Actions and enter:

| Field                | Value                                          |
| -------------------- | ---------------------------------------------- |
| Organization or user | `Takazudo`                                     |
| Repository           | `zudo-design-token-lint`                       |
| Workflow filename    | `publish.yml`                                  |
| Environment          | _(empty — the jobs use no environment)_        |
| Permissions          | **direct publishing** + **Allow npm dist-tag** |

npm expires a new trusted-publisher configuration that has not published within 2 days. Configure
it right before a real release.

Once a real OIDC publish has succeeded:

1. delete the GitHub `NPM_TOKEN` secret;
2. revoke the old npm write tokens;
3. set Publishing access to "Require two-factor authentication and disallow tokens".

The live cutover is tracked in issue #192.

## Codex Cloud

Environment setup (owner, once):

- repository `Takazudo/zudo-design-token-lint`;
- install script `corepack enable && pnpm install --frozen-lockfile`;
- internet access for at least `registry.npmjs.org`, `github.com`, `api.github.com`;
- GitHub access for the account running the task. Add a GitHub credential only if the owner
  decides to; the procedure does not require a PAT.

Then run preflight. It decides which of Steps 5 and 7 the Cloud session can perform itself.
