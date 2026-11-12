---
name: make-release
description: Release the @takazudo/zudo-design-token-lint npm package by following the repository's RELEASING.md (version proposal, bump + bilingual changelog, land on main, CI on the exact commit, tag or release.yml dispatch, watch publish.yml, which publishes via npm OIDC and finalizes the GitHub Release). Use when asked to bump the version, cut or make a release, publish, or resume a failed release of this package. Do not use for doc-site deploys (those happen automatically on push to main) or for other packages.
---

# make-release

Follow [`RELEASING.md`](../../../RELEASING.md) at the repository root exactly. It is the single
canonical release procedure, and the Claude Code entry point `.claude/skills/l-make-release/` uses
it too.

Codex-specific notes:

- Start with `node scripts/release/cli.mjs preflight`. In Codex Cloud, do not assume push, tag,
  dispatch or monitoring rights from a successful clone. If this session has GitHub tools besides
  `gh`, probe them with one read-only call (list `release.yml` runs) and rerun preflight with
  `--github-mcp yes|no`. Follow its `initiation=` / `monitoring=` lines (`gh`, `github-mcp` or
  `manual`). If a needed capability is `no` or `unknown`, stop at that step and report exactly what
  is missing, with the manual alternative from RELEASING.md.
- The only human gate is the Step 2 proposal from
  `node scripts/release/cli.mjs plan [--arg "<major|minor|patch|next [level]|stable>"]`. Present it
  and wait for explicit confirmation before the first mutation.
- After the release commit is on `main`, run `node scripts/release/cli.mjs candidate`. It fixes the
  SHA (the CI-green `main` head, or the existing tag's SHA for a resume) and prints the
  `release.yml` inputs. Never replace that SHA with a newer `main` yourself.
- Initiate through `release.yml` (Step 7b): dry run first, then `dry_run=false`. A Cloud session
  never pushes a tag. Without any dispatch capability, hand the printed inputs to the owner.
- Never run `npm publish`, `npm dist-tag` or `gh release create` yourself, and never request or
  configure an npm token or PAT. Do not bypass branch or tag protection. Publishing is OIDC-only
  inside `.github/workflows/publish.yml`.
- Track runs by exact run ID: a `release.yml` run by `[<request_id>]` in its title, the publish run
  by the printed `publish_run_id`. Never use "the latest run".
- If tag creation or dispatch is refused, report the diagnostic table from the run summary. Its
  fields are observations; do not state a cause.
- Report the fields listed in RELEASING.md Step 8. A run that skipped publishing because the version
  was already on npm, a dry run, or a mocked test is **not** evidence that OIDC publishing works.
