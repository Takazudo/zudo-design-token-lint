# CLAUDE.md

## Project

`@zudolab/design-token-lint` — a linter that enforces semantic design tokens instead of raw Tailwind numeric utilities.

- **Root**: The npm package (TypeScript + vitest)
- **`doc/`**: Astro-based documentation site (zudo-doc) deployed at `/pj/zudo-design-token-lint/`

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
├── doc/                          # Astro doc site
│   ├── src/                      # Astro source
│   ├── astro.config.ts           # Astro config
│   ├── tsconfig.json             # Astro TS config
│   └── package.json              # Astro site package.json
├── pnpm-workspace.yaml           # pnpm workspace: ["doc"]
└── .github/workflows/            # CI + publish workflows
```

## Commands (Root — Lint Package)

```bash
pnpm build          # Compile TypeScript to dist/ (tsc)
pnpm test           # Run tests (vitest run)
pnpm test:watch     # Watch mode
pnpm lint           # prettier --check .
pnpm lint:fix       # prettier --write .
```

## Commands (Doc Site — Workspace Shortcuts)

```bash
pnpm dev:doc        # Start Astro dev server
pnpm build:doc      # Build doc site to doc/dist/
pnpm preview:doc    # Preview built doc site
pnpm check:doc      # Astro type check
```

## API Shapes (Important)

- `LintResult` is **flat**: `{ filePath, line, className, reason }` — NOT `{ filePath, violations: [...] }`
- `lintFile()` and `lintContent()` return `LintResult[]` (array, not single object)
- `Violation` has only `{ className, reason }` — no `line` or `column`
- `checkClass()` returns `Violation | null` — not `undefined`
- `ExtractedClass` has `{ className, line }` — no `column`

Keep the public documentation (`doc/src/content/docs/api/`) in sync when changing these shapes.

## Deployment

The doc site deploys to `/pj/zudo-design-token-lint/` on Cloudflare Pages. `settings.base` in `doc/src/config/settings.ts` must match.

## CI / Publish

- `.github/workflows/ci.yml` — test + build + lint on PR and push to main
- `.github/workflows/publish.yml` — publish to npm when a `v*.*.*` tag is pushed (requires `NPM_TOKEN` secret)

## Publishing

Triggered by pushing a `v*.*.*` tag to main. The `.github/workflows/publish.yml` workflow runs tests + build + `pnpm publish --access public`. Requires `NPM_TOKEN` secret.

## Dogfooding

`.design-token-lint.json` at root configures the linter on its own source code. Run `pnpm dlx @zudolab/design-token-lint` (after publish) or `node dist/cli.js` to lint.

## Commit Messages

Use conventional format: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`

## Subdirectory Rules

- **Writing or editing documentation?** Read `doc/src/content/CLAUDE.md`
