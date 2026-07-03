# Testing Strategy

This is a hybrid repo with two independently-testable parts, each following a
different **archetype** from the zudo-test-wisdom
[Project Archetype Playbook](https://github.com/Takazudo/zudo-test-wisdom)
(levels = what a test can see, tiers = where/when it runs — T0 inner loop,
T1 PR gate, T3 scheduled re-exam).

## Root — `npm Library / CLI` archetype

The repository root ships `@takazudo/zudo-design-token-lint`: a CLI + library
that emits text/data (lint results), with no DOM or browser runtime.
Correctness is fully expressible as input → output, plus a check that the
published tarball actually installs and runs.

### L1 — Unit tests (T0/T1)

`vitest run` (`pnpm test`) over `src/*.test.ts`, colocated with source:
`config.test.ts`, `extractor.test.ts`, `rules.test.ts`, `linter.test.ts`,
`cli.test.ts`, `edge-cases.test.ts`. Covers config loading/validation,
class-name extraction, rule matching, and `runMain()` in-process (argv
parsing, `--json`/`--format`, exit codes) without spawning a process.

### L3 — Golden fixtures + subprocess CLI tests (T1)

- `src/golden.test.ts` runs the real CLI pipeline (`runMain`) against the
  committed `test/fixtures/sample-project/` and diffs the full `LintResult[]`
  output against committed `test/fixtures/expected.json` — a regression net
  over the combined engine behavior (multiline `cn()`, trailing `!`
  modifiers, v4/logical color rules, ignore comments) interacting through one
  config.
- `src/cli-subprocess.test.ts` spawns the **compiled** `dist/cli.js` as a real
  child process (`node:child_process execFile`), rather than calling
  `runMain` in-process. This exercises the actual entry point: argv off
  `process.argv`, the shebang, `process.exit(code)`, and `isMainModule()`
  detection — none of which the in-process tests touch. The root `pretest`
  script (`pnpm run build`) guarantees `dist/cli.js` is fresh before these
  run.

### Pack/publish pipeline check (T1 + release gate)

`scripts/check-pack.sh` — the archetype's core insight is that **the artifact
that ships is not the source tree**. The script:

1. `pnpm pack`s the current tree into a tarball.
2. `npm i`s that tarball into a scratch project in a `mktemp` dir, exactly
   like a real consumer would.
3. Asserts `npx design-token-lint --version` exits 0 and matches
   `package.json`'s version, a one-file violation fixture exits 1 and reports
   the violation, and the ESM exports map resolves (`import()` exposes
   `lintContent` as a function).

Wired into `ci.yml` on every PR (cheap — catches a `files[]`/`bin`/`exports`
regression early) and into `publish.yml` **before** the `pnpm publish`
invocation (both the `next` and `latest` dist-tag paths run through the same
step, so both are gated).

### Scheduled registry drift net (T3)

`.github/workflows/registry-smoke.yml` — the package is consumed by pin
across other projects, which is exactly the archetype's trigger for a
scheduled re-exam: a PR gate's lockfile-pinned install can never see what
changed in the registry since the lockfile was generated. Runs weekly
(`23 4 * * 1` — an off-minute, not top-of-hour) plus `workflow_dispatch`,
installing `@latest` and `@next` fresh from npm into scratch projects and
re-running the version + violation-exit-code assertions. Deliberately does
**not** check out the repo — it tests what is live on the registry right
now, decoupled from the current state of `main`.

### Deliberate deltas from the archetype baseline

- **Subprocess CLI tests are an addition beyond golden fixtures.** The
  baseline calls for L1 + L3 golden fixtures; this repo also spawns the
  compiled binary as a real child process (`cli-subprocess.test.ts`). Kept
  because the CLI's `isMainModule()`/shebang/`process.exit` plumbing has
  broken silently before under `pnpm`'s `.bin` symlink indirection — see the
  realpath-comparison comment in `src/cli.ts`.
- **A `lint` step (`prettier --check`) runs in T1** (`ci.yml`), which the
  archetype baseline doesn't call out explicitly. Cheap, kept.
- **Dogfooding.** `.design-token-lint.json` at the repo root configures the
  linter to lint its own source (`pnpm dlx @takazudo/zudo-design-token-lint`
  once published, or `node dist/cli.js` locally) — not a CI gate today, but
  worth naming since it's part of how this package's own rules get exercised.
- **No T2/T4.** No full-e2e split and no local heavy lane — nothing in this
  package is heavy enough to justify either, matching the archetype's "T0–T1
  only" guidance for a small CLI/library.

## `doc/` — `SSG / Docs Site` archetype

`doc/` is a separate pnpm workspace member: the zfb-built documentation site,
deployed to Cloudflare Workers. Output is prose/markup with no interactive
islands today, so the dangerous failures are a broken build, invalid HTML,
and rotted links — not logic bugs.

### Core gate: L3 build + HTML-validate + link check (T1)

`.github/workflows/doc-preview.yml` runs on every PR targeting `main` and
mirrors the **local `b4push` gate** (`doc/scripts/run-b4push.sh`) step for
step:

| #   | `b4push` step               | `doc-preview.yml` job      |
| --- | --------------------------- | -------------------------- |
| 1   | Format check (mdx)          | Format Check               |
| 2   | Template drift check        | Template Drift Check       |
| 3   | Pin parity check            | Pin Parity Check           |
| 4   | Wrangler pin check          | (part of Type Check job)   |
| 5   | Type checking (`zfb check`) | Type Check                 |
| 6   | Build (`zfb build`)         | Build Site                 |
| 7   | HTML validation             | HTML validate              |
| 8   | Link check                  | Build Site (`check:links`) |
| 9   | Z-index token drift check   | (part of Type Check job)   |

`b4push` is the **T4 local convenience lane** (bounded, run before pushing);
`doc-preview.yml` is the **T1 enforced gate** that actually blocks a PR.
`doc-deploy.yml` repeats the build/html-validate/history pipeline on push to
`main` and adds the `wrangler deploy` + notify steps — release path, not an
extra test layer.

### Deliberate deltas from the archetype baseline

- **Extra zfb/zudo-doc-specific gates layered onto the generic SSG core.**
  The archetype's minimum viable suite is build + html-validate + link-check;
  this repo also runs a **template drift check** (detects the doc app
  drifting from the `create-zudo-doc` scaffold), a **pin parity check** and
  **wrangler pin check** (keep `@takazudo/zfb`/zudo-doc and the pinned
  `wrangler` version in lockstep — a stale pin would silently break local
  `zfb dev`/`preview`), and a **z-index token drift check** (generated CSS
  block vs. the token source of truth). These are specific to this repo's
  zfb/zudo-doc toolchain, not part of the generic archetype.
- **The full link check runs on every PR, not deferred to `main`.** The
  archetype suggests running the exhaustive link crawl on `main` and keeping
  PRs cheaper; here `check:links` runs unconditionally in the `build-site`
  job on every PR. Kept as-is — the doc site is small enough that the full
  crawl is still fast.
- **No L2 DOM tests.** The archetype says add L2 only for interactive
  islands; this site has none today, so none exist — consistent with the
  baseline, not a divergence. The escalation trigger (an interactive island:
  search, tabs, a client router) is the signal to revisit this.
- **No L4/L5/L6.** No browser-driven E2E, no visual regression, no AI
  verification — there's no user flow or design-critical surface to justify
  them on a prose/markup site.
