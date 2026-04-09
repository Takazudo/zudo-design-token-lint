# CLAUDE.md

## Project

Monorepo for `@zudolab/design-token-lint` — a linter that enforces semantic design tokens instead of raw Tailwind numeric utilities.

- **Root**: Astro-based documentation site (zudo-doc) deployed at `/pj/zudo-design-token-lint/`
- **`packages/design-token-lint/`**: The npm package (TypeScript + vitest)

## Directory Layout

```
zudo-design-token-lint/
├── packages/
│   └── design-token-lint/       # npm package (see packages/design-token-lint/CLAUDE.md)
├── src/
│   ├── content/
│   │   ├── docs/                # English docs (see src/content/CLAUDE.md)
│   │   └── docs-ja/             # Japanese docs (mirror EN structure)
│   ├── components/              # Astro + Preact components (scaffolded)
│   ├── pages/                   # Astro routes (scaffolded)
│   └── config/settings.ts       # Doc site settings (base path, footer, nav)
├── astro.config.ts              # Astro config
├── pnpm-workspace.yaml          # pnpm workspace
└── .github/workflows/           # CI + publish workflows
```

## Commands (Root — Doc Site)

```bash
pnpm dev            # Start Astro dev server (predev kills port 4321 first)
pnpm build          # Build doc site to dist/
pnpm preview        # Preview built doc site
pnpm check          # Astro type check
```

## Commands (Workspace Shortcuts)

```bash
pnpm test           # Run package tests (delegates to @zudolab/design-token-lint)
pnpm build:pkg      # Build the npm package
pnpm lint           # Lint the npm package (prettier --check)
pnpm lint:fix       # Auto-fix package formatting
```

## Deployment

The doc site deploys to `/pj/zudo-design-token-lint/` on Cloudflare Pages. `settings.base` in `src/config/settings.ts` must match.

## CI / Publish

- `.github/workflows/ci.yml` — test + build + lint on PR and push to main
- `.github/workflows/publish.yml` — publish to npm when a `v*.*.*` tag is pushed (requires `NPM_TOKEN` secret)

## Commit Messages

Use conventional format: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`

## Subdirectory Rules

- **Working on the npm package?** Read `packages/design-token-lint/CLAUDE.md`
- **Writing or editing documentation?** Read `src/content/CLAUDE.md`
