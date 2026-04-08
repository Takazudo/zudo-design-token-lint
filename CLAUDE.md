# CLAUDE.md

## Repository Structure

This is a monorepo containing both an npm package and its documentation site:

```
zudo-design-token-lint/
├── packages/
│   └── design-token-lint/   # @zudolab/design-token-lint npm package
├── src/                      # Astro-based documentation site (zudo-doc)
│   ├── content/
│   │   ├── docs/             # English docs
│   │   └── docs-ja/          # Japanese docs (mirror EN structure)
│   ├── components/
│   ├── pages/
│   └── config/
├── astro.config.ts           # Astro config (doc site)
├── package.json              # Doc site root + workspace scripts
├── pnpm-workspace.yaml       # pnpm workspace definition
└── .github/workflows/ci.yml  # CI: test + build on PR
```

The root is the Astro doc site. The npm package lives in `packages/design-token-lint/`.

## Commands

### Doc Site (root)

```bash
pnpm dev       # Start doc site dev server
pnpm build     # Build doc site to dist/
pnpm preview   # Preview built doc site
pnpm check     # Astro type check
```

### NPM Package (packages/design-token-lint/)

Use the workspace shortcuts from the root:

```bash
pnpm test              # Run package tests (vitest)
pnpm test:pkg          # Same as above (explicit)
pnpm build:pkg         # Compile TypeScript to dist/
pnpm lint              # Check package formatting
```

Or `cd packages/design-token-lint` and run scripts directly:

```bash
pnpm build
pnpm test
pnpm test:watch
pnpm lint
pnpm lint:fix
```

## Documentation Structure

When adding/modifying documentation pages, **always update both EN and JA**:

- English: `src/content/docs/<topic>/index.mdx`
- Japanese: `src/content/docs-ja/<topic>/index.mdx` (mirror EN structure)

Code blocks should be identical — only translate prose. Frontmatter `title` and `description` translate; `category`, `sidebar_position` stay the same.

## Package Source Layout

```
packages/design-token-lint/src/
  cli.ts            # CLI entry point (#!/usr/bin/env node)
  config.ts         # Config loading and pattern compilation
  extractor.ts      # Class name extraction from source files
  rules.ts          # Rule matching against compiled config
  linter.ts         # Main linter combining extraction + rules
  index.ts          # Public API exports
  *.test.ts         # Tests (colocated)
```

## Deployment

The doc site is configured to deploy at `/pj/zudo-design-token-lint/` (set via `settings.base` in `src/config/settings.ts`).

## Commit Messages

Use conventional format: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`
