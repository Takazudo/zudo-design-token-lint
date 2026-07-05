/**
 * Design-token lint rules for plain CSS/SCSS declaration values.
 *
 * Two opt-in rule kinds, both default-OFF (see `CssConfig` in config.ts):
 *
 * - `zIndex` — flag bare integer `z-index` values. Allowed: `var(--z-*)`,
 *   `calc(...)` containing a `var()`, and the keywords
 *   `auto`/`inherit`/`initial`/`unset`/`revert`/`revert-layer`. Escape-hatched
 *   integers are handled upstream by the extractor's ignore-comment support.
 * - `colorLiterals` — flag raw color literals in a declaration value: `#hex`,
 *   `rgb()/rgba()`, `hsl()/hsla()`, `oklch()/oklab()`. Allowed: `var(...)`,
 *   `transparent`, `currentColor`, and any keyword-only value (named colors,
 *   inherit-family keywords) — none of which match the literal forms.
 *
 * The exact allow/forbid boundary follows zudo-css-wisdom's z-index-strategy
 * "Lint enforcement" table and the design-token-lint methodology Pass 1/Pass 3
 * contract. These rule families live here (rather than in rules.ts) because
 * they operate on `{property, value}` declaration pairs, not Tailwind class
 * strings.
 */

import type { CssDeclaration } from './css-extractor.js';

/** Compiled, resolved form of the config `css` section (all flags concrete). */
export interface CompiledCssConfig {
  zIndex: boolean;
  colorLiterals: boolean;
  /** File globs the CLI scans for CSS/SCSS (resolved separately by the CLI). */
  patterns: string[];
}

export interface CssViolation {
  /** Stable one-line form of the offending declaration, e.g. `z-index: 9999`. */
  className: string;
  reason: string;
  /** Rule-family tag: `z-index` or `color`. Not surfaced on the flat LintResult. */
  category: 'z-index' | 'color';
}

// z-index keywords that are never a raw magic number.
const Z_INDEX_KEYWORDS = new Set(['auto', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

// A bare (optionally negative) integer — the forbidden raw z-index form.
const BARE_INTEGER = /^-?\d+$/;
// A trailing `!important` (with optional whitespace) stripped before testing.
const IMPORTANT_SUFFIX = /\s*!important\s*$/i;

// Raw color literal forms. `#hex` is restricted to the valid CSS lengths
// (3/4/6/8) with a trailing boundary so an SVG id fragment like `url(#a)` or an
// invalid `#12345` does not match. The functional notations match the color
// function name immediately followed by `(`.
const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch|oklab)\s*\(/i;

/**
 * Return true when a `z-index` value is a forbidden raw integer.
 * `var(...)`, `calc(var(...) ...)`, and keyword values all pass.
 */
function isRawZIndex(value: string): boolean {
  const stripped = value.replace(IMPORTANT_SUFFIX, '').trim();
  const lower = stripped.toLowerCase();
  if (Z_INDEX_KEYWORDS.has(lower)) return false;
  // Any `var(` reference is token-based — covers `var(--z-toast)` and
  // `calc(var(--z-modal) + 1)`. A calc() with no var (raw arithmetic) has no
  // `var(` and falls through to the bare-integer test.
  if (/var\s*\(/i.test(stripped)) return false;
  return BARE_INTEGER.test(stripped);
}

/**
 * Return the first raw color literal found in a value, or null. Custom
 * properties (`--*`) and SCSS variables (`$*`) are excluded by the caller —
 * distinguishing a palette-definition zone from a semantic token needs the
 * zone-aware Pass 2 that is out of scope for v1 (documented false negative).
 */
function findColorLiteral(value: string): string | null {
  const hex = value.match(HEX_LITERAL);
  if (hex) return hex[0];
  const fn = value.match(FUNCTIONAL_COLOR);
  if (fn) {
    // Report the full function call (up to its balanced close) for a readable
    // message, falling back to the whole value if unbalanced.
    const start = fn.index ?? 0;
    const end = value.indexOf(')', start);
    return end === -1 ? value.slice(start).trim() : value.slice(start, end + 1);
  }
  return null;
}

/** Collapse internal whitespace runs (incl. newlines) to a single space, for
 * a clean one-line report of a value that may have spanned multiple source
 * lines (gradients, box-shadows, grid templates). */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Check one declaration against the enabled CSS rules. Returns the first
 * violation found (z-index first, then color literal) or null.
 */
export function checkDeclaration(
  decl: CssDeclaration,
  config: CompiledCssConfig,
): CssViolation | null {
  const property = decl.property.toLowerCase();
  const displayValue = oneLine(decl.value);

  if (config.zIndex && property === 'z-index' && isRawZIndex(decl.value)) {
    return {
      className: `${decl.property}: ${displayValue}`,
      reason: `Raw z-index integer "${displayValue}" — use a --z-* token`,
      category: 'z-index',
    };
  }

  if (config.colorLiterals && !isTokenDefinitionProperty(decl.property)) {
    const literal = findColorLiteral(decl.value);
    if (literal) {
      return {
        className: `${decl.property}: ${displayValue}`,
        reason: `Raw color literal "${oneLine(literal)}" — use a semantic color token`,
        category: 'color',
      };
    }
  }

  return null;
}

/**
 * Custom properties (`--brand`) and SCSS variables (`$brand`) are treated as
 * token-definition sites and skipped by the color-literal rule in v1 (zone
 * awareness is Pass 2, deferred).
 */
function isTokenDefinitionProperty(property: string): boolean {
  return property.startsWith('--') || property.startsWith('$');
}
