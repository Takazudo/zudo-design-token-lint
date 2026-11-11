---
description: "Release @takazudo/zudo-design-token-lint end-to-end by following the repository's canonical RELEASING.md: propose the version (stable-by-default; `next` is opt-in), bump + bilingual changelog, land the release commit on main, wait for CI on that exact commit, tag it (git push or the release.yml workflow), then watch publish.yml publish via npm OIDC trusted publishing and finalize the GitHub Release. Single human gate: the version proposal. Triggers on rough requests like \"bump version\", \"cut a release\", \"release\", \"make a release\"."
user-invocable: true
argument-description: "Optional: major | minor | patch (direct stable), next | next major|minor|patch (opt-in prerelease), stable (promote a prerelease), or no argument (commit-judged stable). Or: cancel — abort a not-yet-published release."
---

# /l-make-release

**Read and follow [`RELEASING.md`](../../../RELEASING.md) at the repository root.** It is the single
canonical procedure, and the Codex skill `.agents/skills/make-release/` uses it too. Do not
maintain a separate copy of the steps here.

Claude-specific notes:

- Pass the user's argument through to `node scripts/release/cli.mjs plan --arg "<argument>"` (Step
  2). Show its proposal verbatim and wait for confirmation. That confirmation authorizes the whole
  flow through publish and the GitHub Release (no second prompt).
- `cancel` → RELEASING.md "Cancelling".
- Run `node scripts/release/cli.mjs preflight` first (Step 0). Choose the integration path (5a/5b)
  and the initiation path (7a/7b) from what the preflight shows this session can actually do.
- Monitor CI and the publish run by **exact run id** with `gh run watch <id> --exit-status`, as
  shown in RELEASING.md. No other skill is required.
- Never run `npm publish`, `npm dist-tag` or `gh release create` yourself. Never add or ask for an
  npm token. Publishing is OIDC-only inside `publish.yml`.
- Final report: use the fields listed in RELEASING.md Step 8, including whether npm publish was a
  *fresh OIDC publish* or a *skipped already-published* run.
