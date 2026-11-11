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
  dispatch or monitoring rights from a successful clone. Choose the integration path (Step 5a
  direct push or 5b PR) and the initiation path (Step 7a tag push or 7b `release.yml` dispatch)
  from what preflight reports. If a needed capability is `no` or `unknown`, stop at that step and
  report exactly what is missing.
- The only human gate is the Step 2 proposal from
  `node scripts/release/cli.mjs plan [--arg "<major|minor|patch|next [level]|stable>"]`. Present it
  and wait for explicit confirmation before the first mutation.
- Never run `npm publish`, `npm dist-tag` or `gh release create` yourself, and never request or
  configure an npm token or PAT. Publishing is OIDC-only inside `.github/workflows/publish.yml`.
- Track runs by exact run ID (`gh run watch <id> --exit-status`), never "the latest run".
- Report the fields listed in RELEASING.md Step 8. A run that skipped publishing because the version
  was already on npm is **not** evidence that OIDC publishing works.
