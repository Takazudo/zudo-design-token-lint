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
node scripts/release/cli.mjs preflight [--github-mcp yes|no]
```

Preflight is read-only. It reports `yes` / `no` / `unknown` per capability **and per path**, because
a session may reach GitHub through the `gh` CLI, through GitHub MCP tools (agent tools such as
`run_workflow` and Actions run listing), or not at all:

- `gh` installed and authenticated; repo write; reading Actions runs (public reads work without a
  login);
- GitHub MCP dispatch + run reading. The CLI cannot see agent tools, so an agent first probes them
  with a **read-only** call (list `release.yml` runs) and passes the result as `--github-mcp yes|no`;
- git read access and branch push (dry-run only);
- being on `main` with a clean tree.

It prints `initiation=` and `monitoring=` as `gh`, `gh-unverified` (logged in, write not reported:
a dry-run dispatch proves it), `github-mcp`, `probe-github-mcp` or `manual`. A
successful clone does **not** imply push, tag or dispatch rights.

| Capability                               | Use                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------- |
| push to `main`                           | direct commit (Step 5a)                                             |
| push branches / open PRs, no `main` push | PR integration (Step 5b)                                            |
| `release.yml` dispatch (gh or MCP)       | `release.yml` initiation (Step 7b), the default for agents          |
| none of the above                        | prepare the PR / proposal; the owner dispatches from the Actions UI |
| local human with tag push                | Step 7a is also allowed                                             |

Agent and Cloud sessions **never push tags**: `release.yml` creates the tag. Never add a personal
access token, and never bypass branch or tag protection to make a step work. If a capability is
missing, stop at that step and report exactly which one, with the manual alternative.

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
  `node scripts/release/cli.mjs registry-state --version "$CUR"` plus `gh release view "v$CUR"`, or
  the Releases page) → this is not a new release. Use [Recovery](#recovery).
- `node scripts/release/cli.mjs candidate` summarizes all of this read-only: it reports `new` or
  `resume`, the SHA, the registry state and CI.

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

Then fix the candidate: the exact commit that will be released.

```bash
node scripts/release/cli.mjs candidate      # read-only; git + public registry, gh optional
```

`candidate` fetches `origin/main` and picks its **head** as the fixed candidate SHA. The one
exception is a resume: if the head's version is already tagged but not yet on npm, it selects the
tag's original SHA. If that version is already published, it stops and says so (bump first); to
resume only provenance and GitHub Release finalization, pass that SHA with `--sha`. It checks:

- `package.json` at that commit has the exact version, and its changelog exists;
- the remote tag `v<version>`: absent → mode `new`; at the same commit → mode `resume` (the
  original SHA is kept); at another commit → refused, because a release tag is never moved;
- the registry state: `unknown` is refused; `published` without a tag is refused;
- CI for that commit when `gh` can read runs (`ci_status=admitted|pending|missing`; red is refused).
  Without `gh` it says `unchecked`: read the `ci.yml` push run for the SHA with GitHub MCP or the
  Actions UI. `release.yml` enforces CI either way.

It prints the `release.yml` inputs as JSON, including a fresh `request_id`. **From here on the SHA is
fixed.** If `main` moves on later, nothing replaces it silently: `release.yml` warns that the
candidate is behind `main` and still releases exactly the candidate. To ship the newer commits
instead, go back to Step 2 for a new version. `--sha <sha>` selects an explicit candidate; it is
kept as given and warned about if it is not the head.

## Step 6 — Wait for CI on that exact commit

```bash
RUN=$(gh run list --workflow ci.yml --event push --commit "$SHA" --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status
```

`SHA` is the `candidate_sha` from Step 5. Without `gh`, list `ci.yml` runs with GitHub MCP (event
`push`, branch `main`) and pick the one whose `head_sha` equals `SHA`, then read it by its id. Use the
run for **this SHA**, never "the latest run". If it is empty, wait and retry.

If CI fails, fix it, land the fix (5a/5b), select the candidate again, and wait again. `ci.yml` never cancels
push runs on `main`, so every `main` commit gets its own verdict. Admission uses the **newest** CI
push run for the commit: an older green run does not outvote a newer red one.

`publish.yml` independently refuses any commit without a successful CI push run for its exact
SHA. It waits up to 30 minutes for one that is in progress.

## Step 7 — Initiate (the irreversible boundary)

Choose by capability. Both paths end in the same `publish.yml` admission.

**7a. Tag push (local human only):**

```bash
git tag "v<version>" "$SHA" && git push origin "v<version>"
PUBLISH_RUN=$(gh run list --workflow publish.yml --event push --commit "$SHA" \
  --json databaseId,headBranch -q '[.[] | select(.headBranch=="v<version>")][0].databaseId')
```

**7b. Hosted initiation via `release.yml`** (the default for agents and Cloud). Dispatch on ref
`main` with the inputs `candidate` printed: `version`, `sha`, `dry_run`, `request_id`. Always a dry
run first; it performs every admission check and mutates nothing. Then the same inputs with
`dry_run=false` and a new `request_id`.

- **gh:**

  ```bash
  gh api -X POST repos/Takazudo/zudo-design-token-lint/actions/workflows/release.yml/dispatches \
    -f ref=main -f 'inputs[version]=<version>' -f "inputs[sha]=$SHA" -f 'inputs[dry_run]=true' \
    -f 'inputs[request_id]=<request_id>' -F return_run_details=true   # prints workflow_run_id
  ```

- **GitHub MCP:** `run_workflow` with owner `Takazudo`, repo `zudo-design-token-lint`, workflow
  `release.yml`, ref `main`, inputs `{"version": "<version>", "sha": "<sha>", "dry_run": "true",
"request_id": "<request_id>"}`.
- **Manual (no dispatch capability):** the owner opens Actions → "Start release" → "Run workflow"
  on `main` and enters the same inputs. The session hands off and stops; it does not ask for a
  token.

**Exact run tracking.** The run title is `Start release v<version> (dry run) [<request_id>]`. Find
the `release.yml` `workflow_dispatch` run whose title contains `[<request_id>]`. Exactly one must
match; never use "the latest run". The `start` job dispatches `publish.yml` with request id
`<release run id>-<attempt>`, prints `publish_run_id`, and the publish run's title carries that id
in brackets.

What the `start` job does, re-admitting first because state may have changed since the dry run:

| Remote tag `v<version>` | Mode     | Action                                                                                                   |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| absent                  | `new`    | creates the tag at the fixed SHA through the API, then dispatches `publish.yml`                          |
| at the same SHA         | `resume` | keeps it (no new tag) and dispatches `publish.yml`; an existing npm publication must match by provenance |
| at another SHA          | refused  | `tag-moved`; resume with the tag's SHA or cut a new version                                              |

A tag created with `GITHUB_TOKEN` does not trigger workflows, so the explicit dispatch is required.
A re-sent start is safe: a tag that appears at the same SHA in the meantime counts as `exists`.

**When tag creation or dispatch is refused** (for example HTTP 403), the job fails before anything
is published. Its summary lists the HTTP status, message, `documentation_url`, request id,
`X-Accepted-GitHub-Permissions`, the candidate SHA, the control SHA (`github.workflow_sha`, the
commit `release.yml` ran from) and the `.github/workflows/` files that differ between the two.
These are observations, not a diagnosis. In zudo-design-token-panel a 403 on an older candidate
coincided with workflow-file differences, but that link is a **hypothesis**, not documented GitHub
behaviour. Do not add a PAT and do not bypass protection: report the fields. If the tag was created
and only the dispatch failed, resume with the same `version` and `sha`.

## Step 8 — Watch the publish run and report

```bash
gh run watch "$PUBLISH_RUN" --exit-status
gh run view "$PUBLISH_RUN"           # the "Release report" job summary has the full table
npm view @takazudo/zudo-design-token-lint dist-tags --json
```

Without `gh`, read the same run by its exact id with GitHub MCP (run, then its jobs) and the
registry with `node scripts/release/cli.mjs registry-state --version <version>`.

Report each of these:

- the `release.yml` run ID (dry run and start), and the publish run ID and attempt;
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
  than the stable version. It rereads `next` immediately before deleting. The publish and cleanup
  jobs share the job-level, non-cancelling `npm-registry-mutation` concurrency group, so a
  concurrent prerelease publish cannot interleave. GitHub keeps at most one _pending_ job per
  group: if three runs overlap, the middle run's pending job is cancelled. Nothing wrong is
  mutated, and the run shows `cancelled`; re-dispatch it. The outcome is always reported:

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

Start a **fresh** run on the tag: `gh workflow run publish.yml --ref v<version>`, GitHub MCP
`run_workflow` (workflow `publish.yml`, ref `v<version>`), or `release.yml` with the tag's own SHA
(resume mode). "Re-run all jobs"
on the old run is equivalent, but do **not** use "Re-run failed jobs": that reuses the old admission
outputs, so it cannot notice that npm already has the version. A fresh run is always safe:

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
- **"cannot publish over previously published version" right after another run published:** the
  registry CDN can briefly answer 404 for a version that has just been published, so admission
  saw `absent`. This failure is safe, because nothing is overwritten. Re-dispatch, and the new run
  takes the `published` path.
- **npm accepted the publish but a later publish-job step failed** (for example the visibility
  check timed out): the report says "published now via OIDC, but a later publish-job step failed".
  Cleanup and finalize still run. If they did not, re-dispatch.
- **Finalizing an older stable** never takes the "Latest" badge from a newer GitHub Release.
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

## Cloud sessions (Claude Code / Codex)

Environment setup (owner, once):

- repository `Takazudo/zudo-design-token-lint`;
- install script `corepack enable && pnpm install --frozen-lockfile`;
- internet access for at least `registry.npmjs.org`, `github.com`, `api.github.com`;
- GitHub access for the account running the task, through the product's GitHub connection. A `gh`
  login is optional. Add a GitHub credential only if the owner decides to; the procedure does not
  require a PAT.

Then run preflight (Step 0). A Cloud session typically has no `gh` login but has GitHub MCP tools:
it reads runs and dispatches `release.yml` with them (Step 7b), and integrates the release commit
through a PR (Step 5b). It never pushes a tag. Without dispatch tools it prepares everything up to
the printed `candidate` inputs and hands the dispatch to the owner.

A mocked or dry-run success is not a publish. Only a `publish.yml` report row "published now via
OIDC" is evidence that a release went out.
