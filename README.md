# @takazudo/zudo-design-token-lint

[![npm version](https://img.shields.io/npm/v/@takazudo/zudo-design-token-lint.svg)](https://www.npmjs.com/package/@takazudo/zudo-design-token-lint)

📖 **Documentation:** <https://zudo-design-token-lint.takazudomodular.com/>

Lint Tailwind CSS class names against design system tokens. Enforce semantic spacing and color tokens instead of raw numeric utilities.

Based on the [design token methodology](https://takazudomodular.com/pj/zudo-css-wisdom/docs/methodology/) for building consistent, maintainable design systems with Tailwind CSS.

## Why

Tailwind's numeric utilities (`p-4`, `m-8`, `gap-6`) and default color palette (`bg-gray-500`, `text-blue-600`) make it easy to introduce inconsistency. This linter catches those raw values and guides developers toward semantic design tokens like `p-hgap-sm`, `bg-surface`, `text-fg`.

## Quick Start

```bash
# Install
pnpm add -D @takazudo/zudo-design-token-lint

# Run
npx design-token-lint
```

> Bleeding-edge builds are published under the `next` dist-tag: `pnpm add -D @takazudo/zudo-design-token-lint@next`.

## CLI Usage

```bash
# Scan default patterns (src/, components/, lib/, app/)
design-token-lint

# Scan specific patterns
design-token-lint "src/**/*.tsx" "pages/**/*.tsx"

# Other flags
design-token-lint -h            # or --help
design-token-lint -V            # or --version
design-token-lint --json        # print results as a JSON array on stdout
design-token-lint --format github  # print GitHub Actions ::error annotations on stdout
```

### Exit Codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | No violations found                                                             |
| `1`  | Violations found                                                                |
| `2`  | No files matched the configured patterns, or a config/unexpected error occurred |

Set `TOKEN_LINT_ALLOW_EMPTY=1` (also accepts `true`/`yes`/`on`) to exit `0` instead of `2` when no files match — useful as a first-run/bootstrap escape hatch.

### Output Formats

- `--json` — prints the results as a JSON array on stdout (the human-readable display still goes to stderr).
- `--format github` — prints one `::error file=...,line=...::...` GitHub Actions workflow command per violation on stdout instead of the human display, so CI runs get inline annotations. Auto-selected when the `GITHUB_ACTIONS` env var is truthy (set automatically by GitHub Actions), unless `--format` is passed explicitly.

See the [CLI doc page](https://zudo-design-token-lint.takazudomodular.com/docs/guide/cli/) for full details.

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

| Field              | Type       | Description                                                                                                              |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `prohibited`       | `string[]` | Patterns to flag. Placeholders: `{n}` (number), `{color}` (Tailwind color name), `{shade}` (50-950)                      |
| `allowed`          | `string[]` | Exceptions that are always allowed, even if they match a prohibited pattern                                              |
| `ignore`           | `string[]` | File glob patterns to skip entirely                                                                                      |
| `patterns`         | `string[]` | File glob patterns to scan (overrides CLI defaults when no args given)                                                   |
| `suggestionSuffix` | `string`   | Custom suffix for violation messages (replaces the default suggestion text)                                              |
| `semanticPrefixes` | `string[]` | Value prefixes that bypass spacing rules (default: `["hgap-", "vgap-"]`)                                                 |
| `classAttributes`  | `string[]` | HTML/JSX attribute names the extractor scans for class names (default: `["className", "class"]`)                         |
| `classFunctions`   | `string[]` | Utility function names the extractor scans for class name arguments (default: `["cn", "clsx", "classNames", "twMerge"]`) |

All fields fall back to built-in defaults if omitted.

#### `allowed`

An allowlist checked before prohibited patterns are matched. Each entry can take either form:

- **Bare/normalized form** (e.g. `p-4`) — also allows every variant, negative, important-modifier, and opacity form built from it: `hover:p-4`, `-p-4`, `p-4!`, `sm:-p-4!`, `bg-red-500/50`, etc.
- **Exact/verbatim form** (e.g. `hover:p-2`, `-mt-4`, `bg-red-500/50`) — allows only that specific string, copied straight from a violation message, without opening up the bare form or every other variant.

#### `semanticPrefixes`

Value prefixes that mark a spacing value as an already-semantic token, bypassing the numeric-spacing check regardless of whether the value happens to look numeric. Override the default to match your project's naming convention:

```json
{
  "semanticPrefixes": ["hsp-", "vsp-"]
}
```

With this override, `p-hsp-sm` and `gap-vsp-md` are explicitly declared as semantic tokens instead of the default `hgap-`/`vgap-` prefixes. Set to `[]` to remove the prefix allowlist entirely.

> **Note**: The built-in prohibited patterns only flag purely numeric values (`p-4`, `m-8`, ...), so an alphabetic suffix like `hgap-sm` already fails that check regardless of this setting — `semanticPrefixes` mainly matters as an explicit declaration of your semantic-token vocabulary, or if you add a custom prohibited pattern with looser value matching.

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
- **Logical and v4 color utilities**: `border-s-red-500`, `border-e-red-500`, `ring-offset-blue-600`, `inset-ring-gray-400`, `inset-shadow-gray-900`, `text-shadow-gray-900`, etc.

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
} from '@takazudo/zudo-design-token-lint';

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

## Known Limitations

This linter uses static analysis (regex-based extraction), which has inherent limitations:

- **Conditional expressions**: Ternaries like `isActive ? "p-4" : "m-8"` are not extracted — classes inside ternaries are silently skipped
- **Template interpolation**: ``className={`p-${size}`}`` extracts the literal string `p-${size}`, which matches no rules, so dynamic classes are never linted
- **Escaped quotes**: `className="p-4 \"m-8\""` may extract incorrectly due to unhandled escape sequences

These are inherent to the static analysis approach and are not bugs.

## License

MIT
