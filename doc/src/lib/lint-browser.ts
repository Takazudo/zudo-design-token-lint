/**
 * Browser-safe lint module.
 *
 * Mirrors the core logic from the lint package (src/config.ts, src/extractor.ts,
 * src/rules.ts) without any Node.js API imports (node:fs, node:path). This
 * allows the playground to run linting entirely in the browser.
 *
 * Scope decisions (issue #134 — keep in sync with any future re-mirror):
 * - `extends`/presets (core issue #127) are NOT mirrored. The playground
 *   (doc/src/components/playground.tsx) only ever hands `compileConfig` a
 *   fully inline config object typed straight from the textarea JSON — there
 *   is no UI for picking a named preset, so preset resolution has nothing to
 *   attach to. `prohibited`/`allowed` are used as given (or empty arrays),
 *   never falling back to DEFAULT_CONFIG/CONFIG_PRESETS the way the CLI does.
 * - CSS/SCSS declaration extraction and file dispatch (core issue #131) are
 *   not mirrored because the playground lints a single pasted snippet, not a
 *   file with an extension. The CSS config shape and direct declaration rule
 *   check are mirrored so browser-side config behavior stays aligned with the
 *   exported API.
 * - `classAttributes`/`classFunctions` stay hardcoded to the core defaults
 *   (not configurable) — the playground config schema does not surface them,
 *   mirroring the pre-existing behavior of this file. `semanticPrefixes` is
 *   configurable (issue #160, v2 parity) — see `DEFAULT_SEMANTIC_PREFIXES`.
 */

// ── Types ──────────────────────────────────────────────────────────

/**
 * Structured form of a `prohibited` entry — mirrors config.ts's
 * `ProhibitedEntry`. `reason` overrides the pattern-shape-inferred violation
 * message (still supports the "{CLASS}" placeholder); `category` tags the
 * rule family (e.g. "sizing", "z-index") and is surfaced on `Violation`.
 */
export interface ProhibitedEntry {
  pattern: string;
  reason?: string;
  category?: string;
}

/** A `prohibited` entry: a plain pattern string, or a structured object. */
export type ProhibitedConfigEntry = string | ProhibitedEntry;

export interface LintConfig {
  prohibited: ProhibitedConfigEntry[];
  allowed: string[];
  ignore: string[];
  suggestionSuffix?: string;
  /**
   * Normalized base class (e.g. "p-4") -> semantic replacement token. Mirrors
   * `LintConfig.suggestions` in config.ts — message-only, appended to a
   * violation reason as `— did you mean "<value>"?`.
   */
  suggestions?: Record<string, string>;
  /**
   * Value namespaces that mark a semantic spacing/sizing token. Mirrors
   * `LintConfig.semanticPrefixes` in config.ts — a value starting with a
   * listed entry has that namespace stripped and the remaining tail
   * re-tested against the rule's own numeric pattern, so "p-hgap-sm" still
   * passes but "p-hgap-2" (a numeric scale wearing a semantic name) is
   * flagged. REPLACE semantics — omitting the field falls back to
   * `DEFAULT_SEMANTIC_PREFIXES`, not `[]`.
   */
  semanticPrefixes?: string[];
  /** Opt-in CSS declaration rules; mirrors the source `CssConfig` shape. */
  css?: CssConfig;
}

export interface CssConfig {
  zIndex?: boolean | { allowed: number[] };
  colorLiterals?: boolean;
  patterns?: string[];
}

export interface CompiledCssConfig {
  zIndex: boolean;
  zIndexAllowed?: ReadonlySet<number>;
  colorLiterals: boolean;
  patterns: string[];
}

export interface CssDeclaration {
  property: string;
  value: string;
  line: number;
}

export interface CssViolation {
  className: string;
  reason: string;
  category: "z-index" | "color";
}

export interface CompiledRule {
  prefix: string;
  valuePattern: RegExp;
  reasonTemplate: string;
  isSpacingRule: boolean;
  /** Rule-family tag from a structured `prohibited` entry (e.g. "sizing", "z-index") */
  category?: string;
}

export interface CompiledConfig {
  rules: CompiledRule[];
  allowed: Set<string>;
  ignore: string[];
  /** Normalized base class -> semantic replacement token, consulted at match time */
  suggestions: Map<string, string>;
  /** Value namespaces that mark a semantic token — see `LintConfig.semanticPrefixes` */
  semanticPrefixes: string[];
  /** Resolved CSS config, when the source config included a `css` section. */
  css?: CompiledCssConfig;
}

export interface Violation {
  className: string;
  reason: string;
  /** Rule-family tag from the matched rule's structured `prohibited` entry */
  category?: string;
}

export interface ExtractedClass {
  className: string;
  line: number;
}

export interface LintResult {
  line: number;
  className: string;
  reason: string;
}

// ── Config compilation (from src/config.ts) ────────────────────────

const TAILWIND_COLORS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mirrors `DEFAULT_CONFIG.semanticPrefixes` in config.ts. The mirror has no
 * `DEFAULT_CONFIG` object of its own (its `prohibited`/`allowed` are always
 * given explicitly by the playground's textarea JSON, never falling back to
 * core defaults — see the file header), so this const exists solely as the
 * `semanticPrefixes` fallback in `compileConfig` below. The fallback must be
 * this list, not `[]` — omitting the field in playground config JSON must
 * keep enforcing the default namespaces, not silently disable them.
 */
const DEFAULT_SEMANTIC_PREFIXES = ["hgap-", "vgap-", "hsp-", "vsp-"];

const PLACEHOLDER_TOKEN = /\{n\}|\{color\}|\{shade\}/g;
const KNOWN_PLACEHOLDER_TOKENS = new Set(["{n}", "{color}", "{shade}"]);

/**
 * Validate every "{...}" occurrence in a value part: it must be one of the
 * known placeholder tokens ({n}, {color}, {shade}), fully closed, with no
 * stray "}" left unmatched.
 */
function validatePlaceholders(pattern: string, valuePart: string): void {
  let i = 0;
  while (i < valuePart.length) {
    const ch = valuePart[i];
    if (ch === "{") {
      const close = valuePart.indexOf("}", i);
      if (close === -1) {
        throw new Error(`Invalid pattern "${pattern}": unclosed placeholder "{"`);
      }
      const token = valuePart.slice(i, close + 1);
      if (!KNOWN_PLACEHOLDER_TOKENS.has(token)) {
        throw new Error(`Invalid pattern "${pattern}": unknown placeholder "${token}"`);
      }
      i = close + 1;
    } else if (ch === "}") {
      throw new Error(`Invalid pattern "${pattern}": unmatched "}" with no preceding "{"`);
    } else {
      i++;
    }
  }
}

/**
 * Expand a placeholder-bearing value part (e.g. "{n}px" or "{color}/{shade}")
 * into a regex source string. Placeholders are expanded to their matcher;
 * everything else is escaped so literal regex metacharacters in a custom
 * pattern are treated as literal text.
 */
function expandValuePart(valuePart: string): string {
  let result = "";
  let lastIndex = 0;
  PLACEHOLDER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_TOKEN.exec(valuePart))) {
    result += escapeRegExp(valuePart.slice(lastIndex, match.index));
    if (match[0] === "{n}") {
      result += "\\d+(\\.\\d+)?";
    } else if (match[0] === "{color}") {
      result += `(${TAILWIND_COLORS.join("|")})`;
    } else {
      result += "\\d{2,3}";
    }
    lastIndex = match.index + match[0].length;
  }
  result += escapeRegExp(valuePart.slice(lastIndex));
  return result;
}

/** Options bag accepted by `compilePattern` (mirrors config.ts's `CompilePatternOptions`). */
export interface CompilePatternOptions {
  suggestionSuffix?: string;
  reason?: string;
  category?: string;
}

export function compilePattern(
  pattern: string,
  optionsOrSuffix?: string | CompilePatternOptions,
): CompiledRule {
  const options: CompilePatternOptions =
    typeof optionsOrSuffix === "string"
      ? { suggestionSuffix: optionsOrSuffix }
      : (optionsOrSuffix ?? {});
  const { suggestionSuffix, reason, category } = options;

  const placeholderIndex = pattern.indexOf("{");
  if (placeholderIndex === -1) {
    // Exact-match pattern (no placeholders) — matched by checkClassWithConfig
    // against BOTH the normalized className and the verbatim className, so a
    // leading "-", a variant prefix, or a "!" important modifier in the
    // pattern is intentional and matches only that literal form.
    return {
      prefix: pattern,
      valuePattern: /^$/,
      reasonTemplate: reason ?? `Prohibited class "{CLASS}"`,
      isSpacingRule: false,
      ...(category !== undefined ? { category } : {}),
    };
  }

  if (placeholderIndex === 0 || pattern[placeholderIndex - 1] !== "-") {
    throw new Error(`Invalid pattern "${pattern}": placeholder "{" must be preceded by "-"`);
  }

  const prefix = pattern.slice(0, placeholderIndex - 1);
  const valuePart = pattern.slice(placeholderIndex);
  validatePlaceholders(pattern, valuePart);

  let regexStr = "^";
  let reasonTemplate = "";
  let isSpacingRule = false;

  if (valuePart === "{n}") {
    regexStr += "\\d+(\\.\\d+)?";
    const spacingSuffix =
      suggestionSuffix ?? "use a semantic spacing token or arbitrary value";
    reasonTemplate = `Numeric spacing "{CLASS}" — ${spacingSuffix}`;
    isSpacingRule = true;
  } else if (valuePart === "{color}-{shade}") {
    const colorGroup = TAILWIND_COLORS.join("|");
    regexStr += `(${colorGroup})-(\\d{2,3})`;
    const colorSuffix = suggestionSuffix ?? "use a design system color token";
    reasonTemplate = `Default Tailwind color "{CLASS}" — ${colorSuffix}`;
  } else {
    regexStr += expandValuePart(valuePart);
    reasonTemplate = `Prohibited pattern "{CLASS}"`;
  }

  regexStr += "$";

  return {
    prefix,
    valuePattern: new RegExp(regexStr),
    reasonTemplate: reason ?? reasonTemplate,
    isSpacingRule,
    ...(category !== undefined ? { category } : {}),
  };
}

export function compileConfig(config: LintConfig): CompiledConfig {
  const compiledCss = config.css !== undefined ? compileCssConfig(config.css) : undefined;
  return {
    rules: config.prohibited.map((p) =>
      typeof p === "string"
        ? compilePattern(p, config.suggestionSuffix)
        : compilePattern(p.pattern, {
            suggestionSuffix: config.suggestionSuffix,
            reason: p.reason,
            category: p.category,
          }),
    ),
    allowed: new Set(config.allowed),
    ignore: config.ignore,
    suggestions: new Map(Object.entries(config.suggestions ?? {})),
    semanticPrefixes: (config.semanticPrefixes ?? DEFAULT_SEMANTIC_PREFIXES).filter(
      (p) => p.length > 0,
    ),
    ...(compiledCss ? { css: compiledCss } : {}),
  };
}

function compileCssConfig(css: CssConfig): CompiledCssConfig {
  const zIndex = css.zIndex;
  if (
    zIndex !== undefined &&
    typeof zIndex !== "boolean" &&
    (typeof zIndex !== "object" ||
      zIndex === null ||
      Array.isArray(zIndex) ||
      Object.keys(zIndex).some((key) => key !== "allowed") ||
      !Object.prototype.hasOwnProperty.call(zIndex, "allowed") ||
      !Array.isArray(zIndex.allowed) ||
      zIndex.allowed.some((entry) => typeof entry !== "number" || !Number.isInteger(entry)))
  ) {
    throw new Error(
      'Invalid css config: "css.zIndex" must be a boolean or an object with an "allowed" integer array',
    );
  }
  if (css.colorLiterals !== undefined && typeof css.colorLiterals !== "boolean") {
    throw new Error('Invalid css config: "css.colorLiterals" must be a boolean');
  }
  if (css.patterns !== undefined && (!Array.isArray(css.patterns) || css.patterns.some((p) => typeof p !== "string"))) {
    throw new Error('Invalid css config: "css.patterns" must be an array of strings');
  }

  if (zIndex && typeof zIndex === "object") {
    return {
      zIndex: true,
      zIndexAllowed: new Set(zIndex.allowed),
      colorLiterals: css.colorLiterals ?? false,
      patterns: css.patterns ?? [],
    };
  }
  return {
    zIndex: zIndex ?? false,
    colorLiterals: css.colorLiterals ?? false,
    patterns: css.patterns ?? [],
  };
}

// ── CSS declaration rules (direct API parity with src/css-rules.ts) ──

const Z_INDEX_KEYWORDS = new Set([
  "auto",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);
const BARE_INTEGER = /^-?\d+$/;
const IMPORTANT_SUFFIX = /\s*!\s*important\s*$/i;
const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch|oklab)\s*\(/i;

function normalizeZIndexValue(value: string): string {
  return value.replace(IMPORTANT_SUFFIX, "").trim();
}

function isRawZIndex(value: string): boolean {
  const stripped = normalizeZIndexValue(value);
  if (Z_INDEX_KEYWORDS.has(stripped.toLowerCase())) return false;
  if (/var\s*\(/i.test(stripped)) return false;
  if (/calc\s*\(/i.test(stripped)) return true;
  return BARE_INTEGER.test(stripped);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function findColorLiteral(value: string): string | null {
  const scan = value.replace(/\burl\s*\([^)]*\)/gi, (m) => " ".repeat(m.length));
  const hex = scan.match(HEX_LITERAL);
  if (hex) return hex[0];
  const fn = scan.match(FUNCTIONAL_COLOR);
  if (fn) {
    const start = fn.index ?? 0;
    const end = value.indexOf(")", start);
    return end === -1 ? value.slice(start).trim() : value.slice(start, end + 1);
  }
  return null;
}

function isTokenDefinitionProperty(property: string): boolean {
  return property.startsWith("--") || property.startsWith("$");
}

export function checkDeclaration(
  decl: CssDeclaration,
  config: CompiledCssConfig,
): CssViolation | null {
  const property = decl.property.toLowerCase();
  const displayValue = oneLine(decl.value);
  const normalizedZIndex = normalizeZIndexValue(decl.value);
  const rawZIndexNumber = BARE_INTEGER.test(normalizedZIndex)
    ? Number(normalizedZIndex)
    : undefined;

  if (
    config.zIndex &&
    property === "z-index" &&
    rawZIndexNumber !== undefined &&
    config.zIndexAllowed?.has(rawZIndexNumber)
  ) {
    return null;
  }
  if (config.zIndex && property === "z-index" && isRawZIndex(decl.value)) {
    const reasonPrefix = BARE_INTEGER.test(normalizedZIndex)
      ? "Raw z-index integer"
      : "Token-less z-index calculation";
    return {
      className: `${decl.property}: ${displayValue}`,
      reason: `${reasonPrefix} "${displayValue}" — use a --z-* token`,
      category: "z-index",
    };
  }
  if (config.colorLiterals && !isTokenDefinitionProperty(decl.property)) {
    const literal = findColorLiteral(decl.value);
    if (literal) {
      return {
        className: `${decl.property}: ${displayValue}`,
        reason: `Raw color literal "${oneLine(literal)}" — use a semantic color token`,
        category: "color",
      };
    }
  }
  return null;
}

// ── Class extraction (from src/extractor.ts) ───────────────────────

const DEFAULT_CLASS_ATTRIBUTES = ["className", "class"];
const DEFAULT_CLASS_FUNCTIONS = ["cn", "clsx", "classNames", "twMerge"];

// Lines containing a line-level ignore comment. The block/JSX forms tolerate
// trailing reason text via a capturing group (not surfaced by this module —
// the playground doesn't report unused-ignore metadata).
const IGNORE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore\b([^*]*)\*\//,
  /\{\/\*\s*design-token-lint-ignore\b([^*]*)\*\/\}/,
  /\/\/\s*design-token-lint-ignore(?!\S)(.*)$/,
];

const IGNORE_FILE_PATTERNS = [
  /^\s*\/\*\s*design-token-lint-ignore-file\s*\*\/\s*$/,
  /^\s*\{\/\*\s*design-token-lint-ignore-file\s*\*\/\}\s*$/,
  /^\s*\/\/\s*design-token-lint-ignore-file\s*$/,
];

function findIgnoreMatch(line: string): RegExpMatchArray | null {
  for (const pattern of IGNORE_PATTERNS) {
    const match = line.match(pattern);
    if (match) return match;
  }
  return null;
}

function isIgnoreLine(line: string): boolean {
  return findIgnoreMatch(line) !== null;
}

/**
 * Check whether an ignore-comment match is the only non-whitespace content on
 * its line (as opposed to trailing other real content, e.g.
 * `<div className="p-4"> {/* design-token-lint-ignore *\/}`). When it isn't
 * alone, the comment also suppresses its own line, in addition to the next.
 */
function isIgnoreMatchAloneOnLine(line: string, match: RegExpMatchArray): boolean {
  const index = match.index ?? 0;
  const before = line.slice(0, index);
  const after = line.slice(index + match[0].length);
  return before.trim() === "" && after.trim() === "";
}

interface CommentSpan {
  start: number;
  end: number;
}

/**
 * Compute `//` and `/* *\/` comment spans on a single line, so matches that
 * fall inside commented-out source are skipped. Quote-aware — a comment
 * marker inside a string literal is not mistaken for a real comment. A
 * `/* *\/` block comment that doesn't close on the same line is treated as
 * running to the end of the line (no multi-line block comment tracking).
 */
function getCommentSpans(line: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let quote: string | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (quote) {
      if (ch === "\\" && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }

    if (ch === "/" && line[i + 1] === "/") {
      spans.push({ start: i, end: line.length });
      break;
    }

    if (ch === "/" && line[i + 1] === "*") {
      const closeIdx = line.indexOf("*/", i + 2);
      const end = closeIdx === -1 ? line.length : closeIdx + 2;
      spans.push({ start: i, end });
      i = end;
      continue;
    }

    i++;
  }
  return spans;
}

function isInCommentSpan(spans: CommentSpan[], index: number): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

/**
 * Remove duplicate (className, line) pairs. A classFunction call nested
 * inside a class:list array (e.g. `class:list={[cn('p-4')]}`) is extracted
 * once by the class:list path and, when the construct stays on a single
 * line, falls through to the utility-function path which rescans the same
 * source range and would otherwise double-report every class inside it.
 */
function dedupeExtractedClasses(results: ExtractedClass[]): ExtractedClass[] {
  const seenByLine = new Map<number, Set<string>>();
  const deduped: ExtractedClass[] = [];
  for (const item of results) {
    let seen = seenByLine.get(item.line);
    if (!seen) {
      seen = new Set<string>();
      seenByLine.set(item.line, seen);
    }
    if (seen.has(item.className)) continue;
    seen.add(item.className);
    deduped.push(item);
  }
  return deduped;
}

function addClasses(
  results: ExtractedClass[],
  classString: string,
  line: number,
): void {
  const cleaned = classString.replace(/\/\*[\s\S]*?\*\//g, " ");
  const classes = cleaned
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  for (const className of classes) {
    results.push({ className, line });
  }
}

export function extractClasses(content: string): ExtractedClass[] {
  const lines = content.split("\n");
  const results: ExtractedClass[] = [];
  const ignoredLines = new Set<number>();

  // File-level ignore comment anywhere in the file empties the whole file.
  for (const line of lines) {
    if (IGNORE_FILE_PATTERNS.some((p) => p.test(line))) {
      return [];
    }
  }

  // First pass: find ignore comments, mark next line (and own line, for a
  // trailing same-line ignore).
  for (let i = 0; i < lines.length; i++) {
    const match = findIgnoreMatch(lines[i]);
    if (match) {
      ignoredLines.add(i + 1);
      if (!isIgnoreMatchAloneOnLine(lines[i], match)) {
        ignoredLines.add(i);
      }
    }
  }

  const attrAlt = DEFAULT_CLASS_ATTRIBUTES.map(escapeRegExp).join("|");
  const doubleQuoteAttr = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*"([^"]+)"`, "g");
  const singleQuoteAttr = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*'([^']+)'`, "g");
  const singleQuoteBrace = new RegExp(
    `(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*'([^']+)'\\s*\\}`,
    "g",
  );
  const doubleQuoteBrace = new RegExp(
    `(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*"([^"]+)"\\s*\\}`,
    "g",
  );
  const templateLiteral = new RegExp(
    `(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*\`([^\`]+)\`\\s*\\}`,
    "g",
  );
  // Multiline: className="... without closing quote on same line
  const multilineDoubleStart = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*"([^"]*$)`);
  const multilineSingleStart = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*'([^']*$)`);

  // class:list={[...]} — Astro. Matches only up to the opening '[' — array
  // contents are scanned separately via scanBalancedDelimited so the array
  // can span multiple lines.
  const classListStart = /class:list\s*=\s*\{\s*\[/g;

  // Utility function call-start pattern — matches only the function name +
  // opening paren — args are scanned separately via scanBalancedDelimited so
  // calls can span multiple lines.
  const fnAlt = DEFAULT_CLASS_FUNCTIONS.map(escapeRegExp).join("|");
  const utilFnStart = new RegExp(`(?<![\\w$])(?:${fnAlt})\\s*\\(`, "g");

  lineLoop: for (let i = 0; i < lines.length; i++) {
    if (ignoredLines.has(i)) continue;

    const line = lines[i];
    const lineNum = i + 1;
    // Comment spans on this line — matches falling inside are commented-out
    // source, not real code, and must be skipped.
    const commentSpans = getCommentSpans(line);

    for (const match of line.matchAll(doubleQuoteAttr)) {
      if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(singleQuoteAttr)) {
      if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(singleQuoteBrace)) {
      if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(doubleQuoteBrace)) {
      if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(templateLiteral)) {
      if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
      addClasses(results, match[1], lineNum);
    }

    // class:list arrays — accumulate across lines until brackets balance
    // (same 50-line cap as utility function calls).
    classListStart.lastIndex = 0;
    let clMatch: RegExpExecArray | null;
    while ((clMatch = classListStart.exec(line)) !== null) {
      if (isInCommentSpan(commentSpans, clMatch.index)) continue;
      const startCol = classListStart.lastIndex; // just past the opening '['
      const arr = scanBalancedDelimited(lines, i, startCol, "[", "]");
      extractFromClassListArray(results, arr.content, i, ignoredLines);

      if (arr.endLine !== i) {
        // Array spanned multiple lines. Blank out the consumed prefix of the
        // closing line (preserving column positions) and reprocess that
        // line, so source after the closing ']' is still scanned.
        lines[arr.endLine] = " ".repeat(arr.endCol) + lines[arr.endLine].slice(arr.endCol);
        i = arr.endLine - 1;
        continue lineLoop;
      }
      classListStart.lastIndex = arr.endCol;
    }

    // cn(...) / clsx(...) / classNames(...) / twMerge(...) — accumulate
    // arguments across lines until parens balance.
    utilFnStart.lastIndex = 0;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = utilFnStart.exec(line)) !== null) {
      if (isInCommentSpan(commentSpans, fnMatch.index)) continue;
      const startCol = utilFnStart.lastIndex; // just past the opening '('
      const call = scanBalancedDelimited(lines, i, startCol, "(", ")");
      extractFromCallArgs(results, call.content, i, ignoredLines);

      if (call.endLine !== i) {
        // Call spanned multiple lines. Blank out the consumed prefix of the
        // closing line (preserving column positions) and reprocess that
        // line, so source after the closing ')' is still scanned.
        lines[call.endLine] = " ".repeat(call.endCol) + lines[call.endLine].slice(call.endCol);
        i = call.endLine - 1;
        continue lineLoop;
      }
      utilFnStart.lastIndex = call.endCol;
    }

    // Detect unclosed multiline class/className attribute and accumulate
    // across lines.
    const multilineDoubleMatch = multilineDoubleStart.exec(line);
    const multilineSingleMatch = !multilineDoubleMatch
      ? multilineSingleStart.exec(line)
      : null;
    const multilineMatch = multilineDoubleMatch ?? multilineSingleMatch;

    if (multilineMatch && !isInCommentSpan(commentSpans, multilineMatch.index ?? 0)) {
      const quoteChar = multilineDoubleMatch ? '"' : "'";
      const openLineNum = lineNum;
      // Each line's content is attributed to its own actual source line, so
      // continuation-line classes point at the right line instead of all
      // collapsing onto the opening line.
      addClasses(results, multilineMatch[1], openLineNum);

      // Accumulate subsequent lines until the closing quote is found.
      // Safety limit: stop after 50 lines to avoid consuming entire file on
      // malformed input.
      const maxLines = 50;
      let linesConsumed = 0;
      let closeCol = -1;
      while (i + 1 < lines.length && linesConsumed < maxLines) {
        i++;
        linesConsumed++;
        const nextLineNum = i + 1;
        const nextLine = lines[i];
        // A design-token-lint-ignore comment on this continuation line
        // suppresses it — either because it was marked via ignoredLines, or
        // because the line itself IS the ignore comment.
        const skipLine = ignoredLines.has(i) || isIgnoreLine(nextLine);
        const closeIdx = nextLine.indexOf(quoteChar);
        if (closeIdx !== -1) {
          if (!skipLine) addClasses(results, nextLine.substring(0, closeIdx), nextLineNum);
          closeCol = closeIdx + 1; // just past the closing quote
          break;
        } else {
          if (!skipLine) addClasses(results, nextLine, nextLineNum);
        }
      }

      if (closeCol !== -1) {
        // Blank out the consumed prefix of the closing line (preserving
        // column positions) and reprocess that line, so source after the
        // closing quote is still scanned. Mirrors the class:list/utilFn
        // closing-line treatment above.
        lines[i] = " ".repeat(closeCol) + lines[i].slice(closeCol);
        i = i - 1;
        continue lineLoop;
      }
    }
  }

  return dedupeExtractedClasses(results);
}

interface BalancedScan {
  /** Joined text between the opening and closing delimiter (exclusive). */
  content: string;
  /** Index (0-based) of the line containing the closing delimiter, or the last line scanned. */
  endLine: number;
  /** Column just past the closing delimiter on `endLine` (only meaningful when balanced). */
  endCol: number;
}

/**
 * Scan forward from just after an opening delimiter (`(` for utility function
 * calls, `[` for `class:list` arrays), tracking delimiter depth while
 * skipping over string/template-literal contents — so a closing delimiter or
 * a nested opening one inside a string literal never affects balance. Also
 * skips over `//` and `/* *\/` comment spans (blanking them out of `content`)
 * so an unpaired quote inside a comment can't be mistaken for a string
 * opener, and so the comment text can't resurface as a spurious quoted match
 * when the caller re-scans `content` for class tokens. Crosses line
 * boundaries up to a 50-line safety cap, returning whatever was accumulated
 * if the cap is hit.
 */
function scanBalancedDelimited(
  lines: string[],
  startLine: number,
  startCol: number,
  openChar: string,
  closeChar: string,
): BalancedScan {
  const maxLines = 50;
  let depth = 1;
  let content = "";
  let quote: string | null = null;
  let inBlockComment = false;
  let line = startLine;
  let col = startCol;
  let linesConsumed = 0;

  while (line < lines.length) {
    const text = lines[line];
    while (col < text.length) {
      const ch = text[col];

      if (inBlockComment) {
        if (ch === "*" && text[col + 1] === "/") {
          content += "  ";
          col += 2;
          inBlockComment = false;
          continue;
        }
        content += " ";
        col++;
        continue;
      }

      if (quote) {
        if (ch === "\\" && col + 1 < text.length) {
          content += ch + text[col + 1];
          col += 2;
          continue;
        }
        if (ch === quote) quote = null;
        content += ch;
        col++;
        continue;
      }

      if (ch === "/" && text[col + 1] === "/") {
        // Line comment: blank out the rest of the line.
        content += " ".repeat(text.length - col);
        col = text.length;
        continue;
      }

      if (ch === "/" && text[col + 1] === "*") {
        content += "  ";
        col += 2;
        inBlockComment = true;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        content += ch;
        col++;
        continue;
      }

      if (ch === openChar) {
        depth++;
        content += ch;
        col++;
        continue;
      }

      if (ch === closeChar) {
        depth--;
        col++;
        if (depth === 0) {
          return { content, endLine: line, endCol: col };
        }
        content += ch;
        continue;
      }

      content += ch;
      col++;
    }

    if (line + 1 >= lines.length || linesConsumed >= maxLines) {
      return { content, endLine: line, endCol: col };
    }
    line++;
    col = 0;
    linesConsumed++;
    content += "\n";
  }

  return { content, endLine: Math.max(line - 1, startLine), endCol: col };
}

/**
 * Return the 0-based character offset of every `\n` in `text`, in ascending
 * order. Used to map a match's character index in accumulated multiline
 * content back to the source line it actually came from.
 */
function collectNewlineOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let idx = 0; idx < text.length; idx++) {
    if (text.charCodeAt(idx) === 10) offsets.push(idx);
  }
  return offsets;
}

/**
 * Extract string-literal and template-literal class tokens from a utility
 * function's joined argument text. Each match is attributed to its actual
 * source line — `startLine0` (0-based) plus the number of newlines
 * accumulated before the match — not the line the call opened on, so a
 * design-token-lint-ignore comment on an inner argument line suppresses only
 * that line's classes. Template-literal tokens containing `${...}` fall
 * through untouched — they don't match any lint rule pattern.
 */
function extractFromCallArgs(
  results: ExtractedClass[],
  argsText: string,
  startLine0: number,
  ignoredLines: Set<number>,
): void {
  const newlineOffsets = collectNewlineOffsets(argsText);
  let cursor = 0;
  for (const match of argsText.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const matchIndex = match.index ?? 0;
    while (cursor < newlineOffsets.length && newlineOffsets[cursor] < matchIndex) {
      cursor++;
    }
    const actualLine0 = startLine0 + cursor;
    if (ignoredLines.has(actualLine0)) continue;
    addClasses(results, value, actualLine0 + 1);
  }
}

/**
 * Extract single/double-quoted string literals from a `class:list` array's
 * joined content (object-key form like `{ "p-4": true }` is included, since
 * the key itself is a quoted string literal). Each match is attributed to its
 * actual source line — see extractFromCallArgs for why. Paired-quote
 * alternation (mirrors extractFromCallArgs) — a token opened with one quote
 * character must close with the SAME character, so a mismatched pair like
 * `["p-4']` is never mistaken for a valid quoted literal.
 */
function extractFromClassListArray(
  results: ExtractedClass[],
  arrayContent: string,
  startLine0: number,
  ignoredLines: Set<number>,
): void {
  const newlineOffsets = collectNewlineOffsets(arrayContent);
  let cursor = 0;
  for (const match of arrayContent.matchAll(/'([^']+)'|"([^"]+)"/g)) {
    const value = match[1] ?? match[2] ?? "";
    const matchIndex = match.index ?? 0;
    while (cursor < newlineOffsets.length && newlineOffsets[cursor] < matchIndex) {
      cursor++;
    }
    const actualLine0 = startLine0 + cursor;
    if (ignoredLines.has(actualLine0)) continue;
    addClasses(results, value, actualLine0 + 1);
  }
}

// ── Rule matching (from src/rules.ts) ──────────────────────────────

/**
 * Build the Violation for a matched rule, carrying an optional category
 * through, appending the semanticPrefixes parenthetical (see
 * `selectSemanticPrefix`) when the match came from a stripped namespace, and
 * finally appending a `— did you mean "..."?` hint when the normalized base
 * class has a `suggestions` mapping.
 */
function buildViolation(
  originalClassName: string,
  rule: CompiledRule,
  normalizedClassName: string,
  suggestions: Map<string, string>,
  semanticPrefix?: string,
): Violation {
  let reason = rule.reasonTemplate.replace("{CLASS}", originalClassName);
  if (semanticPrefix !== undefined) {
    reason += ` (numeric tail after the "${semanticPrefix}" semantic prefix)`;
  }
  const suggestion = suggestions.get(normalizedClassName);
  if (suggestion !== undefined) {
    reason += ` — did you mean "${suggestion}"?`;
  }

  const violation: Violation = { className: originalClassName, reason };
  if (rule.category !== undefined) {
    violation.category = rule.category;
  }
  return violation;
}

/**
 * Result of matching a value against the configured `semanticPrefixes`
 * entries. A "namespace" match strips the matched entry (its `tail` is
 * re-tested against the rule's numeric pattern by the caller); a "bypass"
 * match preserves the 1.x pure-allowlist behavior outright — the entry
 * matched but not as a namespace (e.g. a digit-leading prefix like "1"
 * against "12", or an entry that consumes the whole value with nothing left
 * to strip). Mirrors `SemanticHit`/`selectSemanticPrefix` in src/rules.ts —
 * see the locked v2 contract (issue #158 §2) for the full algorithm.
 */
type SemanticHit = { kind: "namespace"; prefix: string; tail: string } | { kind: "bypass" };

function selectSemanticPrefix(value: string, semanticPrefixes: string[]): SemanticHit | null {
  let longestNamespace: { prefix: string; tail: string } | null = null;
  let hasBypassMatch = false;

  for (const prefix of semanticPrefixes) {
    if (prefix.length === 0 || !value.startsWith(prefix)) {
      continue;
    }
    const remainder = value.slice(prefix.length);
    const isNamespaceMatch = prefix.endsWith("-") || remainder.startsWith("-");
    if (isNamespaceMatch) {
      const tail = prefix.endsWith("-") ? remainder : remainder.slice(1);
      if (longestNamespace === null || prefix.length > longestNamespace.prefix.length) {
        longestNamespace = { prefix, tail };
      }
    } else {
      hasBypassMatch = true;
    }
  }

  if (longestNamespace !== null) {
    return { kind: "namespace", prefix: longestNamespace.prefix, tail: longestNamespace.tail };
  }
  if (hasBypassMatch) {
    return { kind: "bypass" };
  }
  return null;
}

function matchRule(
  originalClassName: string,
  withoutNeg: string,
  rule: CompiledRule,
  semanticPrefixes: string[],
  suggestions: Map<string, string>,
): Violation | null {
  // Exact-match rule (no placeholders, valuePattern is /^$/). Fires when
  // EITHER the normalized candidate equals the entry — so a bare entry like
  // "hidden" also covers "sm:hidden" — OR the raw className equals the entry
  // verbatim, which is what lets an entry carry a leading "-", a variant
  // prefix, or "!" and have that literal form actually match.
  if (rule.valuePattern.source === "^$") {
    if (withoutNeg === rule.prefix || originalClassName === rule.prefix) {
      return buildViolation(originalClassName, rule, withoutNeg, suggestions);
    }
    return null;
  }

  if (withoutNeg === rule.prefix || !withoutNeg.startsWith(rule.prefix + "-")) {
    return null;
  }

  const value = withoutNeg.slice(rule.prefix.length + 1);

  // semanticPrefixes only ever adds violations, it never removes one: a
  // namespace match (e.g. "hgap-") strips the matched entry and re-tests the
  // remaining tail against this same rule's own "0" bypass and numeric
  // valuePattern — nothing else. A bypass match (an entry that matched but
  // not as a namespace) preserves the 1.x pure-allowlist behavior unchanged.
  if (rule.isSpacingRule) {
    const hit = selectSemanticPrefix(value, semanticPrefixes);
    if (hit !== null) {
      if (hit.kind === "bypass") {
        return null;
      }
      if (hit.tail === "" || hit.tail === "0") {
        return null;
      }
      return rule.valuePattern.test(hit.tail)
        ? buildViolation(originalClassName, rule, withoutNeg, suggestions, hit.prefix)
        : null;
    }
  }

  // Allow "0" for spacing rules. ("p-1px" is allowed via the config's
  // `allowed` list, not a dedicated bypass here — see DEFAULT_CONFIG.allowed
  // in config.ts.)
  if (rule.isSpacingRule && value === "0") {
    return null;
  }

  if (rule.valuePattern.test(value)) {
    return buildViolation(originalClassName, rule, withoutNeg, suggestions);
  }

  return null;
}

export function checkClassWithConfig(
  className: string,
  config: CompiledConfig,
): Violation | null {
  // Strip variant prefixes by taking everything after the last ":".
  const lastColon = className.lastIndexOf(":");
  let stripped = lastColon >= 0 ? className.slice(lastColon + 1) : className;

  // Strip important modifier — leading form is Tailwind v3 (!p-4, sm:!p-4),
  // trailing form is Tailwind v4 (p-4!, sm:p-4!).
  if (stripped.startsWith("!")) {
    stripped = stripped.slice(1);
  }
  if (stripped.endsWith("!")) {
    stripped = stripped.slice(0, -1);
  }

  // Handle negative prefixes (e.g., -m-4, -top-2)
  const isNegative = stripped.startsWith("-");
  const withoutNeg = isNegative ? stripped.slice(1) : stripped;

  // Strip opacity modifier (e.g., bg-gray-500/50). Spacing rules receive the
  // pre-strip form so fraction utilities like w-1/2 are not misread as the
  // numeric value "1".
  const slashIdx = withoutNeg.indexOf("/");
  const withoutOpacity = slashIdx >= 0 ? withoutNeg.slice(0, slashIdx) : withoutNeg;

  // Skip arbitrary values like w-[28px], bg-[#123]
  if (withoutOpacity.includes("[")) {
    return null;
  }

  // Check allowed list first: normalized form AND verbatim className, so a
  // specific variant copied from a violation message can be allowed without
  // opening up the bare form or its other variants.
  if (config.allowed.has(withoutOpacity) || config.allowed.has(className)) {
    return null;
  }

  for (const rule of config.rules) {
    // Spacing/sizing rules must see the value with any `/N` intact; color
    // rules receive the opacity-stripped form.
    const candidate = rule.isSpacingRule ? withoutNeg : withoutOpacity;
    const violation = matchRule(
      className,
      candidate,
      rule,
      config.semanticPrefixes,
      config.suggestions,
    );
    if (violation) {
      return violation;
    }
  }

  return null;
}

// ── Lint content (browser-safe version of src/linter.ts) ───────────

export function lintContent(
  content: string,
  compiledConfig: CompiledConfig,
): LintResult[] {
  const classes = extractClasses(content);
  const results: LintResult[] = [];

  for (const { className, line } of classes) {
    const violation = checkClassWithConfig(className, compiledConfig);
    if (violation) {
      results.push({
        line,
        className: violation.className,
        reason: violation.reason,
      });
    }
  }

  return results;
}
