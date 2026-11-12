---
description: "Release @takazudo/zudo-design-token-lint end-to-end by following the repository's canonical RELEASING.md: propose the version (stable-by-default; `next` is opt-in), bump + bilingual changelog, land the release commit on main, wait for CI on that exact commit, tag it (git push or the release.yml workflow), then watch publish.yml publish via npm OIDC trusted publishing and finalize the GitHub Release. Single human gate: the version proposal. Triggers on rough requests like \"bump version\", \"cut a release\", \"release\", \"make a release\"."
user-invocable: true
argument-description: "Optional: major | minor | patch (direct stable), next | next major|minor|patch (opt-in prerelease), stable (promote a prerelease), or no argument (commit-judged stable). Or: cancel — abort a not-yet-published release."
---

# /l-make-release

**Read and follow `RELEASING.md` at the repository root** ([view on GitHub](https://github.com/Takazudo/zudo-design-token-lint/blob/main/RELEASING.md)). It is the single
canonical procedure, and the Codex skill `.agents/skills/make-release/` uses it too. Do not
maintain a separate copy of the steps here.

Claude-specific notes:

- Pass the user's argument through to `node scripts/release/cli.mjs plan --arg "<argument>"` (Step
  2). Show its proposal verbatim and wait for confirmation. That confirmation authorizes the whole
  flow through publish and the GitHub Release (no second prompt).
- `cancel` → RELEASING.md "Cancelling".
- **Capabilities, not assumptions (Step 0).** Before preflight, check which GitHub path this
  session has:
  - `gh`: preflight probes it itself.
  - GitHub MCP tools (Claude Code on the web / Cloud usually has these, often with no `gh` login):
    probe with one read-only call, listing `release.yml` workflow runs. Then run
    `node scripts/release/cli.mjs preflight --github-mcp yes` (or `no` if the call failed or the
    tools are absent).
  Follow its `initiation=` / `monitoring=` lines: `gh`, `github-mcp`, or `manual` (hand the printed
  inputs to the owner for Actions → "Start release" → "Run workflow"; do not ask for a token).
- Integration (Step 5): direct push if allowed, otherwise a `release/v<version>` PR (gh or GitHub
  MCP). Then `node scripts/release/cli.mjs candidate` fixes the SHA and prints the `release.yml`
  inputs. Never swap in a newer `main` SHA yourself.
- Initiation (Step 7): in this repo an agent always uses `release.yml` (7b): dry run first, then
  `dry_run=false`, each with its own `request_id`. Never `git push` a tag from Cloud. With GitHub
  MCP: `run_workflow` on `release.yml`, ref `main`, the printed inputs.
- Track every run by **exact run id**. Find a `release.yml` run by `[<request_id>]` in its title,
  and the publish run by `publish_run_id` (its title carries `[<release run id>-<attempt>]`). With
  `gh`: `gh run watch <id> --exit-status`. With MCP: re-read that run id until it completes. No
  other skill is required.
- If the start job reports a refused tag creation or dispatch (for example 403), relay its
  diagnostic table as is. Do not state a cause, add a PAT or bypass protection.
- Never run `npm publish`, `npm dist-tag` or `gh release create` yourself. Never add or ask for an
  npm token. Publishing is OIDC-only inside `publish.yml`.
- Final report: use the fields listed in RELEASING.md Step 8, including whether npm publish was a
  *fresh OIDC publish* or a *skipped already-published* run. A dry run or a mocked test is never a
  publish.
