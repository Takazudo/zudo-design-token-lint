# CLAUDE.md

## Project

`@takazudo/zudo-design-token-lint` — a linter that enforces semantic design tokens instead of raw Tailwind numeric utilities.

**Hybrid repo:** the repository root is the npm package (primary, TypeScript + vitest); `doc/` is a separate pnpm workspace member hosting the zfb documentation site, deployed to Cloudflare Workers at `https://zudo-design-token-lint.takazudomodular.com/`.

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

**Workspace policy:**

- `pnpm-workspace.yaml` (root only) holds `allowBuilds` (esbuild, sharp, workerd) and `minimumReleaseAgeExclude` entries needed by zfb.
- `.npmrc` at the workspace root controls install-affecting settings for the whole workspace.
- `claudeResources` in `doc/src/config/settings.ts` points to `../.claude` — the repo root `.claude/` directory, one level above `doc/`.

## Commands (Root — Lint Package)

```bash
pnpm build          # Compile TypeScript to dist/ (tsc)
pnpm test           # Run tests (vitest run)
pnpm test:watch     # Watch mode
pnpm lint           # prettier --check .
pnpm lint:fix       # prettier --write .
```

## Commands (Doc Site)

Run from the repo root via workspace `--filter` shortcuts (the underlying `doc/` scripts are `zfb dev/build/preview/check`):

```bash
pnpm dev:doc        # zfb dev — start local dev server (port 4321)
pnpm build:doc      # zfb build — build static site
pnpm preview:doc    # zfb preview — preview built site
pnpm check:doc      # zfb check — type checking
```

Or run the same scripts directly from `doc/`: `pnpm dev`, `pnpm build`, `pnpm preview`, `pnpm check`.

## API Shapes (Important)

- `LintResult` is **flat**: `{ filePath, line, className, reason }` — NOT `{ filePath, violations: [...] }`
- `lintFile()` and `lintContent()` return `LintResult[]` (array, not single object)
- `Violation` has only `{ className, reason }` — no `line` or `column`
- `checkClass()` returns `Violation | null` — not `undefined`
- `ExtractedClass` has `{ className, line }` — no `column`

Keep the public documentation (`doc/src/content/docs/api/`) in sync when changing these shapes.

## Deployment

The doc site is hosted on **Cloudflare Workers** (static assets) at base `/` — no subpath prefix (`settings.base` in `doc/src/config/settings.ts` is `"/"`).

- **Live URL**: `https://zudo-design-token-lint.takazudomodular.com/`
- **Production**: push to `main` → `doc-deploy.yml` → `wrangler deploy`
- **PR Preview**: PRs targeting `main` → `doc-preview.yml` → Workers preview deployment + check matrix (preview URL posted as a PR comment)

Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## CI & Publishing

Workflows in `.github/workflows/`:

- `ci.yml` — test + build + lint (npm package) on PR and push to `main`
- `doc-deploy.yml` — build doc site + `wrangler deploy` to Cloudflare Workers on push to `main`
- `doc-preview.yml` — build doc site + Workers preview deployment on PRs
- `publish.yml` — publish the npm package when a `v*.*.*` tag is pushed

**Publishing**: push a `v*.*.*` tag to `main`; `publish.yml` runs tests + build + `pnpm publish --access public`. Requires the `NPM_TOKEN` secret.

## Dogfooding

`.design-token-lint.json` at root configures the linter on its own source code. Run `pnpm dlx @takazudo/zudo-design-token-lint` (after publish) or `node dist/cli.js` to lint.

## Commit Messages

Use conventional format: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`

## Subdirectory Rules

- **Writing or editing documentation?** Read `doc/src/content/CLAUDE.md`
