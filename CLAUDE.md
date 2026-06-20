# CLAUDE.md

## Project

`@takazudo/zudo-design-token-lint` — a linter that enforces semantic design tokens instead of raw Tailwind numeric utilities.

**Hybrid repo:** the repository root is the npm package (primary); `doc/` is a separate pnpm workspace member that hosts the zfb documentation site.

- **Root**: The npm package (TypeScript + vitest)
- **`doc/`**: zfb host-app — documentation site deployed to Cloudflare Workers at `https://zudo-design-token-lint.takazudomodular.com/`

## Directory Layout

```
zudo-design-token-lint/
├── src/                          # Lint package source (TypeScript)
│   ├── cli.ts                    # CLI entry point (#!/usr/bin/env node)
│   ├── config.ts                 # Config loading and pattern compilation
│   ├── extractor.ts              # Class name extraction from source files
│   ├── rules.ts                  # Rule matching against compiled config
│   ├── linter.ts                 # Main linter combining extraction + rules
│   ├── index.ts                  # Public API exports
│   └── *.test.ts                 # Tests (colocated)
├── dist/                         # Build output
├── package.json                  # Lint package manifest (primary)
├── tsconfig.json                 # Lint package TS config
├── vitest.config.ts              # Vitest config
├── .design-token-lint.json       # Dogfooding config
├── .prettierrc                   # Prettier config
├── README.md                     # Lint package README
├── LICENSE
├── pnpm-workspace.yaml           # workspace: ["doc"]; allowBuilds + minimumReleaseAgeExclude policy
├── .npmrc                        # install-affecting settings (applied workspace-wide by pnpm)
├── doc/                          # zfb doc host-app (workspace member)
│   ├── src/                      # Source (content, components, config)
│   ├── pages/                    # Host-app routing layer (zfb entry points)
│   ├── plugins/                  # zfb integration plugins (.mjs)
│   ├── scripts/                  # check-* helper scripts
│   ├── public/                   # Static assets copied to dist
│   ├── zfb.config.ts             # zfb build config (framework, collections, plugins, adapter)
│   ├── wrangler.toml             # Cloudflare Workers deploy config
│   ├── setup-preset.json         # zfb preset metadata
│   ├── tsconfig.json             # Doc site TS config
│   └── package.json              # Doc site package.json
└── .github/workflows/            # CI + publish workflows
```

**Workspace policy notes:**

- `pnpm-workspace.yaml` holds `allowBuilds` (esbuild, sharp, workerd) and `minimumReleaseAgeExclude` entries needed by zfb — these live at the workspace root and are read only from there.
- `.npmrc` at the workspace root controls install-affecting settings for the whole workspace.
- `claudeResources` in `doc/src/config/settings.ts` points to `../. claude` (the repo root `.claude/` directory), one level above the `doc/` subdir.

## Commands (Root — Lint Package)

```bash
pnpm build          # Compile TypeScript to dist/ (tsc)
pnpm test           # Run tests (vitest run)
pnpm test:watch     # Watch mode
pnpm lint           # prettier --check .
pnpm lint:fix       # prettier --write .
```

## Commands (Doc Site — Workspace Shortcuts)

Run from the repo root via `--filter`. The underlying `doc/` scripts are `zfb dev/build/preview/check`.

```bash
pnpm dev:doc        # zfb dev  — start local dev server (port 4321)
pnpm build:doc      # zfb build — build static site
pnpm preview:doc    # zfb preview — preview built site
pnpm check:doc      # zfb check — type checking
```

Or run the same commands directly inside `doc/`:

```bash
cd doc
pnpm dev            # zfb dev
pnpm build          # zfb build
pnpm preview        # zfb preview
pnpm check          # zfb check
```

## API Shapes (Important)

- `LintResult` is **flat**: `{ filePath, line, className, reason }` — NOT `{ filePath, violations: [...] }`
- `lintFile()` and `lintContent()` return `LintResult[]` (array, not single object)
- `Violation` has only `{ className, reason }` — no `line` or `column`
- `checkClass()` returns `Violation | null` — not `undefined`
- `ExtractedClass` has `{ className, line }` — no `column`

Keep the public documentation (`doc/src/content/docs/api/`) in sync when changing these shapes.

## Deployment

The doc site is hosted on **Cloudflare Workers** (static assets) at base `/`.

- **Live URL**: `https://zudo-design-token-lint.takazudomodular.com/`
- **Base path**: `/` — no subpath prefix. `settings.base` in `doc/src/config/settings.ts` is `"/"`.
- **Production**: Push to `main` triggers `.github/workflows/doc-deploy.yml` → `wrangler deploy` → Cloudflare Workers
- **PR Preview**: PRs targeting `main` trigger `.github/workflows/doc-preview.yml` → Workers preview deployment + check matrix

Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## CI / Publish

- `.github/workflows/ci.yml` — test + build + lint (npm package) on PR and push to main
- `.github/workflows/doc-deploy.yml` — build doc site + `wrangler deploy` to Cloudflare Workers on push to main
- `.github/workflows/doc-preview.yml` — build doc site + Workers preview deployment on PRs; posts preview URL as PR comment
- `.github/workflows/publish.yml` — publish npm package when a `v*.*.*` tag is pushed (requires `NPM_TOKEN` secret)

## Publishing

Triggered by pushing a `v*.*.*` tag to main. The `.github/workflows/publish.yml` workflow runs tests + build + `pnpm publish --access public`. Requires `NPM_TOKEN` secret.

## Dogfooding

`.design-token-lint.json` at root configures the linter on its own source code. Run `pnpm dlx @takazudo/zudo-design-token-lint` (after publish) or `node dist/cli.js` to lint.

## Commit Messages

Use conventional format: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`

## Subdirectory Rules

- **Writing or editing documentation?** Read `doc/src/content/CLAUDE.md`
