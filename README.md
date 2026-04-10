# @zudolab/design-token-lint

[![npm version](https://img.shields.io/npm/v/@zudolab/design-token-lint.svg)](https://www.npmjs.com/package/@zudolab/design-token-lint)

Lint Tailwind CSS class names against design system tokens. Enforce semantic spacing and color tokens instead of raw numeric utilities.

Based on the [design token methodology](https://takazudomodular.com/pj/zcss/docs/methodology/) for building consistent, maintainable design systems with Tailwind CSS.

## Why

Tailwind's numeric utilities (`p-4`, `m-8`, `gap-6`) and default color palette (`bg-gray-500`, `text-blue-600`) make it easy to introduce inconsistency. This linter catches those raw values and guides developers toward semantic design tokens like `p-hgap-sm`, `bg-surface`, `text-fg`.

## Quick Start

```bash
# Install
pnpm add -D @zudolab/design-token-lint

# Run
npx design-token-lint
```

## CLI Usage

```bash
# Scan default patterns (src/, components/, lib/, app/)
design-token-lint

# Scan specific patterns
design-token-lint "src/**/*.tsx" "pages/**/*.tsx"
```

The CLI exits with code 1 if violations are found (useful for CI).

## Configuration

Create a `.design-token-lint.json` (or `design-token-lint.config.json`) in your project root:

```json
{
  "prohibited": [
    "p-{n}",
    "px-{n}",
    "py-{n}",
    "m-{n}",
    "mx-{n}",
    "my-{n}",
    "gap-{n}",
    "bg-{color}-{shade}",
    "text-{color}-{shade}",
    "border-{color}-{shade}"
  ],
  "allowed": ["p-0", "m-0", "gap-0"],
  "ignore": ["**/*.test.*", "**/*.stories.*"],
  "patterns": ["src/**/*.{tsx,jsx,astro}"]
}
```

### Config Fields

| Field              | Type       | Description                                                                                         |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------- |
| `prohibited`       | `string[]` | Patterns to flag. Placeholders: `{n}` (number), `{color}` (Tailwind color name), `{shade}` (50-950) |
| `allowed`          | `string[]` | Exceptions that are always allowed, even if they match a prohibited pattern                         |
| `ignore`           | `string[]` | File glob patterns to skip entirely                                                                 |
| `patterns`         | `string[]` | File glob patterns to scan (overrides CLI defaults when no args given)                              |
| `suggestionSuffix` | `string`   | Custom suffix for violation messages (replaces the default suggestion text)                         |

All fields fall back to built-in defaults if omitted.

#### `suggestionSuffix`

Point developers toward your project's specific token naming convention by customising the violation message suffix:

```json
{
  "suggestionSuffix": "use hgap-*/vgap-* or zd-* tokens"
}
```

This turns `Numeric spacing "p-4" — use a semantic spacing token or arbitrary value` into `Numeric spacing "p-4" — use hgap-*/vgap-* or zd-* tokens`.

### Pattern Placeholders

- **`{n}`** — Matches numeric values like `4`, `8`, `0.5`, `16`. Used for spacing rules (padding, margin, gap, inset, etc.)
- **`{color}`** — Matches standard Tailwind color names: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`
- **`{shade}`** — Matches 2-3 digit shade values like `50`, `100`, `500`, `950`

## What It Checks

### Prohibited (by default)

- **Numeric spacing**: `p-4`, `m-8`, `gap-6`, `px-3`, `mt-16`, `space-x-4`, `inset-2`, `top-4`, etc.
- **Default Tailwind colors**: `bg-gray-500`, `text-blue-600`, `border-red-300`, `ring-indigo-500`, etc.

### Allowed (always passes)

- **Semantic tokens**: `p-hgap-sm`, `gap-vgap-xs`, `m-hgap-md` (spacing with `hgap-*`/`vgap-*` suffixes)
- **Design system colors**: `bg-surface`, `text-fg`, `bg-zd-black` (any non-default color name)
- **Zero and 1px**: `p-0`, `m-0`, `gap-0`, `p-1px`
- **Arbitrary values**: `w-[28px]`, `bg-[#123]`, `p-[10px]`
- **Non-spacing/color utilities**: `flex`, `grid`, `hidden`, `w-full`, `font-bold`, etc.
- **Explicit allowlist**: Anything in your config's `allowed` array

## Ignore Comments

Suppress violations on the next line with an ignore comment:

```tsx
{/* design-token-lint-ignore */}
<div className="p-4 bg-gray-500">

/* design-token-lint-ignore */
<div className="p-4 bg-gray-500">

// design-token-lint-ignore
<div className="p-4 bg-gray-500">
```

## Programmatic API

```ts
import {
  lintContent,
  lintFile,
  checkClass,
  loadConfig,
  compileConfig,
  setConfig,
} from '@zudolab/design-token-lint';

// Lint a string
const results = lintContent('file.tsx', '<div className="p-4 bg-gray-500">');

// Lint a file
const fileResults = await lintFile('src/app.tsx');

// Check a single class
const violation = checkClass('p-4');
if (violation) {
  console.error(violation.reason);
}

// Use custom config
const config = await loadConfig(process.cwd());
const compiled = compileConfig(config);
setConfig(compiled);
```

## Supported Syntax

The extractor handles:

- `className="..."` and `class="..."` (JSX/Astro)
- `className={'...'}` and `class={'...'}` (single-quote brace)
- ``className={`...`}`` (template literals, simple cases)
- `class:list={["...", '...']}` (Astro)
- `cn(...)`, `clsx(...)`, `classNames(...)`, `twMerge(...)` utility calls

## License

MIT
