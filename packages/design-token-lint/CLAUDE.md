# CLAUDE.md — packages/design-token-lint

## Package

`@zudolab/design-token-lint` — lint Tailwind CSS class names against design system tokens. Enforces semantic spacing and color tokens instead of raw numeric utilities.

## Commands

Run from this directory, or use the workspace shortcuts from the root.

```bash
pnpm build          # Compile TypeScript to dist/
pnpm test           # Run tests (vitest run)
pnpm test:watch     # Watch mode
pnpm lint           # prettier --check .
pnpm lint:fix       # prettier --write .
```

## Source Layout

```
src/
  cli.ts            # CLI entry point (#!/usr/bin/env node)
  config.ts         # Config loading and pattern compilation
  extractor.ts      # Class name extraction from source files
  rules.ts          # Rule matching against compiled config
  linter.ts         # Main linter combining extraction + rules
  index.ts          # Public API exports
  *.test.ts         # Tests (colocated)
```

## API Shapes (Important)

- `LintResult` is **flat**: `{ filePath, line, className, reason }` — NOT `{ filePath, violations: [...] }`
- `lintFile()` and `lintContent()` return `LintResult[]` (array, not single object)
- `Violation` has only `{ className, reason }` — no `line` or `column`
- `checkClass()` returns `Violation | null` — not `undefined`
- `ExtractedClass` has `{ className, line }` — no `column`

Keep the public documentation (`src/content/docs/api/`) in sync when changing these shapes.

## Publishing

Triggered by pushing a `v*.*.*` tag to main. The `.github/workflows/publish.yml` workflow runs tests + build + `pnpm publish --access public`. Requires `NPM_TOKEN` secret.

The `repository.directory` field in `package.json` points npm at this subdirectory within the monorepo.

## Dogfooding

`.design-token-lint.json` in this directory configures the linter on its own source code. Run `pnpm dlx @zudolab/design-token-lint` (after publish) or `node dist/cli.js` to lint.
