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

| Field                 | Type                            | Description                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prohibited`          | `(string \| ProhibitedEntry)[]` | Patterns to flag. Placeholders: `{n}` (number), `{color}` (Tailwind color name), `{shade}` (50-950). An entry may be a plain string or a structured `{pattern, reason?, category?}` object — see [Structured `prohibited` Entries](#structured-prohibited-entries)       |
| `allowed`             | `string[]`                      | Exceptions that are always allowed, even if they match a prohibited pattern                                                                                                                                                                                              |
| `ignore`              | `string[]`                      | File glob patterns to skip entirely (default: `["**/*.test.*", "**/*.stories.*"]`) — the CLI additionally always excludes `**/node_modules/**` and `**/dist/**`                                                                                                          |
| `patterns`            | `string[]`                      | File glob patterns to scan (overrides CLI defaults when no args given)                                                                                                                                                                                                   |
| `suggestionSuffix`    | `string`                        | Custom suffix for violation messages (replaces the default suggestion text)                                                                                                                                                                                              |
| `suggestions`         | `Record<string, string>`        | Map from a banned class's normalized base form to your project's replacement token, appended as a "did you mean" hint — see [`suggestions`](#suggestions)                                                                                                                |
| `semanticPrefixes`    | `string[]`                      | Namespace prefixes for your semantic-token vocabulary — a value under a listed namespace has the namespace stripped and its remaining tail re-tested against the same rule (default: `["hgap-", "vgap-", "hsp-", "vsp-"]`) — see [`semanticPrefixes`](#semanticprefixes) |
| `classAttributes`     | `string[]`                      | HTML/JSX attribute names the extractor scans for class names (default: `["className", "class"]`)                                                                                                                                                                         |
| `classFunctions`      | `string[]`                      | Utility function names the extractor scans for class name arguments (default: `["cn", "clsx", "classNames", "twMerge"]`)                                                                                                                                                 |
| `extends`             | `string \| string[]`            | Named preset(s) to inherit `prohibited`/`allowed` patterns from — see [`extends`](#extends)                                                                                                                                                                              |
| `prohibitedAdd`       | `(string \| ProhibitedEntry)[]` | Patterns appended to the resolved `prohibited` list (inherited or default)                                                                                                                                                                                               |
| `allowedAdd`          | `string[]`                      | Patterns appended to the resolved `allowed` list (inherited or default)                                                                                                                                                                                                  |
| `css`                 | `object`                        | Opt-in CSS/SCSS declaration scanning: `{ zIndex?, colorLiterals?, patterns? }` (all default-OFF) — see [CSS/SCSS Scanning](#cssscss-scanning-opt-in)                                                                                                                     |
| `requireIgnoreReason` | `boolean`                       | Report a bare (reason-less) `design-token-lint-ignore` that shields a real violation, instead of suppressing it silently (default `false`)                                                                                                                               |
| `reportUnusedIgnores` | `boolean`                       | Report a `design-token-lint-ignore` comment that suppressed nothing (default `false`)                                                                                                                                                                                    |

All fields fall back to built-in defaults if omitted. See the [Configuration doc page](https://zudo-design-token-lint.takazudomodular.com/docs/guide/configuration/) for the full reference.

#### `allowed`

An allowlist checked before prohibited patterns are matched. Each entry can take either form:

- **Bare/normalized form** — also allows every variant, negative, and important-modifier form built from it:
  - A bare `p-4` also covers `hover:p-4`, `-p-4`, `p-4!`, `sm:-p-4!`.
  - A bare `bg-red-500` also covers its opacity forms, e.g. `bg-red-500/50`, `hover:bg-red-500/50`.
- **Exact/verbatim form** (e.g. `hover:p-2`, `-mt-4`, `bg-red-500/50`) — allows only that specific string, copied straight from a violation message, without opening up the bare form or every other variant.

#### `extends`

Inherit `prohibited`/`allowed` patterns from one or more built-in presets instead of duplicating the full default list:

```json
{
  "extends": ["default", "z-index"]
}
```

Two presets are registered: `default` (this package's built-in `prohibited`/`allowed` lists) and `z-index` (opt-in numeric z-index ban — flags `z-{n}`, allows `z-0`). Presets never auto-compose with `default` — list it explicitly if you want the defaults plus another preset. `prohibitedAdd`/`allowedAdd` append extra entries on top of whatever `extends` (or the built-in default) resolved to, without re-listing the full pattern list. An unknown preset name is a config error. See the [Configuration doc page](https://zudo-design-token-lint.takazudomodular.com/docs/guide/configuration/#fields-extends) for the full merge semantics.

#### Structured `prohibited` entries

Instead of a plain string, a `prohibited`/`prohibitedAdd` entry can be an object that overrides the violation message and tags the rule with a category:

```json
{
  "prohibited": [
    "p-{n}",
    {
      "pattern": "w-{n}",
      "reason": "Numeric width \"{CLASS}\" — use a semantic sizing token or arbitrary value",
      "category": "sizing"
    }
  ]
}
```

`category` (e.g. `"sizing"`, `"z-index"`) is copied onto the resulting `Violation.category` when the rule matches, so tooling can group or filter by rule family. The default config's numeric sizing-scale ban (`w-{n}`, `h-{n}`, `size-{n}`, `min-w-{n}`, `max-w-{n}`, `min-h-{n}`, `max-h-{n}`, `basis-{n}`) uses this shape with `category: "sizing"`; fraction (`w-1/2`), arbitrary-value (`w-[32px]`), and zero (`w-0`) forms still pass. Plain string entries never produce a `category`.

#### `suggestions`

A project-level map from a banned class's normalized base form to your project's semantic replacement token:

```json
{
  "suggestions": {
    "p-4": "p-hsp-xs",
    "bg-gray-100": "bg-surface"
  }
}
```

Appends `— did you mean "p-hsp-xs"?` to the violation message for `p-4` (and every variant that normalizes to it — `hover:p-4`, `-p-4`, `p-4!`, etc.). Message-only — does not drive an autofix.

#### `semanticPrefixes`

Namespace prefixes for your semantic-token vocabulary. A value that starts with a listed namespace has that namespace stripped, and the **remaining tail is re-tested** against the same rule — it is not an automatic pass.

**Default**: `["hgap-", "vgap-", "hsp-", "vsp-"]`

```json
{
  "semanticPrefixes": ["hsp-", "vsp-"]
}
```

> **Counter-intuitive direction**: `semanticPrefixes` is a namespace _declaration_, not an allowlist. **Adding** a prefix can **add** violations — it exposes the numeric tail hiding behind a semantic-looking name (`p-hgap-2` is flagged) while a true semantic token (`p-hgap-sm`) still passes. It never removes a violation.

How the strip works:

1. An entry matches when the value starts with it (the trailing `-` is optional in config — `"hgap"` and `"hgap-"` behave the same).
2. It's a **namespace match** when the entry ends in `-`, or is immediately followed by `-` in the value. When more than one entry matches as a namespace, the **longest** one wins, independent of array order.
3. The matched namespace (and its trailing `-`) is stripped, leaving a **tail**, judged exactly like a plain value would be for this rule: empty or `"0"` passes, a tail matching the rule's numeric pattern is flagged, anything else (`sm`, `2xs`, ...) passes.
4. The strip happens exactly once — `p-hgap-vgap-2` strips only the outer `hgap-`, leaving tail `vgap-2` (not numeric), so it passes.
5. Matching is case-sensitive.

This applies to every rule whose value placeholder is the exact `{n}` form — every spacing rule, the numeric sizing scale, the opt-in `z-{n}` preset, and any custom `{n}` rule — since the mechanism belongs to the `{n}` placeholder, not to a specific rule family.

| Class        | `semanticPrefixes` | Result                                         |
| ------------ | ------------------ | ---------------------------------------------- |
| `p-hgap-sm`  | `["hgap-"]`        | pass — non-numeric tail                        |
| `p-hgap-2`   | `["hgap-"]`        | **flagged** — numeric tail                     |
| `p-hgap-0`   | `["hgap-"]`        | pass — zero tail                               |
| `p-hgap-2xs` | `["hgap-"]`        | pass — digit-leading token, not purely numeric |
| `w-hsp-3`    | `["hsp-"]`         | **flagged**, `category: "sizing"`              |

A flagged namespace match appends a parenthetical to the violation message, before any `suggestions` hint:

```text
Numeric spacing "p-hgap-2" — use a semantic spacing token or arbitrary value (numeric tail after the "hgap-" semantic prefix)
```

`semanticPrefixes` has **replace** semantics — like an explicit `prohibited`/`allowed`, it is not merged with `extends`/presets or appended to the default. Setting `"semanticPrefixes": ["hsp-"]` yields exactly `["hsp-"]`, dropping `hgap-`/`vgap-`/`vsp-`. Set to `[]` to remove the namespace list entirely.

Escape hatches for a newly-flagged class, in order of preference: (1) rename the token so it isn't a numeric scale in disguise; (2) add the exact class to `allowed`; (3) drop that namespace from `semanticPrefixes` (restores exact 1.x behavior for it, since a non-numeric tail always passes whether or not the entry is listed); (4) use an arbitrary value (`p-[8px]`).

> **Changed in v2.0.0**: in 1.x this option had no observable effect on any built-in rule — an alphabetic tail like `hgap-sm` already failed the numeric check with or without it ([#108](https://github.com/Takazudo/zudo-design-token-lint/issues/108)). v2 makes it real by re-testing the tail after the strip. **Newly flagged**: exactly the shape `<rule prefix>-<namespace>-<number>`, e.g. `p-hgap-2`, `gap-vgap-4`, `w-hsp-3`, `px-hgap-2.5` — nothing else. **Newly passing**: nothing; the change is strictly additive. The default itself also grew, from `["hgap-", "vgap-"]` to `["hgap-", "vgap-", "hsp-", "vsp-"]` — pin the old list explicitly (`"semanticPrefixes": ["hgap-", "vgap-"]`) if you rely on the previous default and have a numeric-tail `hsp-`/`vsp-` value anywhere.

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
- **Numeric sizing scale**: `w-4`, `h-8`, `size-6`, `min-w-4`, `max-w-8`, `min-h-4`, `max-h-8`, `basis-4`, etc. — each flagged with a sizing-specific message and `category: "sizing"` (see [Structured `prohibited` entries](#structured-prohibited-entries)). Fraction (`w-1/2`), arbitrary-value (`w-[32px]`), and zero (`w-0`) forms still pass.
- **Default Tailwind colors**: `bg-gray-500`, `text-blue-600`, `border-red-300`, `ring-indigo-500`, etc.
- **Logical and v4 color utilities**: `border-s-red-500`, `border-e-red-500`, `ring-offset-blue-600`, `inset-ring-gray-400`, `inset-shadow-gray-900`, `text-shadow-gray-900`, etc.

### Allowed (always passes)

- **Semantic tokens**: `p-hgap-sm`, `gap-vgap-xs`, `m-hgap-md` (spacing with a non-numeric `hgap-*`/`vgap-*`/`hsp-*`/`vsp-*` tail — see [`semanticPrefixes`](#semanticprefixes); a numeric tail like `p-hgap-2` is flagged, not allowed)
- **Design system colors**: `bg-surface`, `text-fg`, `bg-zd-black` (any non-default color name)
- **Zero, for any numeric spacing/sizing rule**: `p-0`, `mt-0`, `px-0`, `inset-0`, `w-0`, `gap-0`, etc. — not just the handful of `0`-suffixed classes listed in `allowed`
- **Non-numeric spacing-shaped values**: `p-1px`, `mt-1px`, etc. — these never match the numeric `{n}` pattern in the first place, so no `allowed` entry is needed
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

Placed as a **trailing** comment instead, an ignore also suppresses violations on its own line, in addition to the line that follows:

```tsx
<div className="p-4"> {/* design-token-lint-ignore */}
<div className="m-8">
```

Both `p-4` and `m-8` above are suppressed.

To skip an entire file, add a `design-token-lint-ignore-file` comment anywhere in it:

```tsx
{
  /* design-token-lint-ignore-file */
}
```

Two opt-in config flags add hygiene checks on top of these comments: `requireIgnoreReason` reports a bare (reason-less) ignore that shields a real violation, and `reportUnusedIgnores` reports an ignore that suppressed nothing. See the [Ignore Syntax doc page](https://zudo-design-token-lint.takazudomodular.com/docs/guide/ignore-syntax/) for the full reference, including reason-text conventions.

## CSS/SCSS Scanning (Opt-in)

Beyond Tailwind classes, an opt-in `css` config section scans plain CSS/SCSS declaration values for raw `z-index` integers and color literals:

```json
{
  "css": {
    "zIndex": true,
    "colorLiterals": true,
    "patterns": ["src/**/*.css", "src/**/*.scss"]
  }
}
```

Both rules are default-`false`; the whole section is absent by default, so nothing changes until you add it. `zIndex` flags a bare integer (`z-index: 9999;`) while allowing `var(--z-*)`, a `calc()` containing a `var()`, and the standard CSS keywords. `colorLiterals` flags `#hex`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, and `oklch()`/`oklab()` values while allowing `var(...)`, `transparent`, `currentColor`, and other keyword-only values. The same `design-token-lint-ignore` comments work here too. See the [Configuration doc page](https://zudo-design-token-lint.takazudomodular.com/docs/guide/configuration/#fields-css) for the full rule tables and documented v1 false negatives (e.g. custom-property/SCSS-variable definitions holding a literal).

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
- `className='...'` and `class='...'` (single-quote HTML attribute, common in Astro/HTML)
- `className={'...'}` and `class={'...'}` (single-quote brace)
- `className={"..."}` and `class={"..."}` (double-quote brace)
- ``className={`...`}`` (template literals, simple cases)
- `class:list={["...", '...']}` (Astro)
- `cn(...)`, `clsx(...)`, `classNames(...)`, `twMerge(...)` utility calls

## Known Limitations

This linter uses static analysis (regex-based extraction), which has inherent limitations:

- **Conditional expressions**: Ternaries like `isActive ? "p-4" : "m-8"` are not extracted — classes inside ternaries are silently skipped
- **Template interpolation**: ``className={`p-${size}`}`` extracts the literal string `p-${size}`, which matches no rules, so dynamic classes are never linted
- **Escaped quotes**: `className="p-4 \"m-8\""` may extract incorrectly due to unhandled escape sequences
- **CSS/SCSS scanning (opt-in `css` section)**: v1 is declaration-based only — a literal color/z-index value inside a custom-property/SCSS-variable definition (`--brand: #f00;`, `$brand: #f00;`) or an SCSS map is not flagged, by design

These are inherent to the static analysis approach and are not bugs. See the [Known Limitations doc page](https://zudo-design-token-lint.takazudomodular.com/docs/reference/limitations/) for the full reference.

## License

MIT
