/**
 * Browser-safe lint module.
 *
 * Mirrors the core logic from the lint package (src/config.ts, src/extractor.ts,
 * src/rules.ts) without any Node.js API imports (node:fs, node:path).
 * This allows the playground to run linting entirely in the browser.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface LintConfig {
  prohibited: string[];
  allowed: string[];
  ignore: string[];
  suggestionSuffix?: string;
}

export interface CompiledRule {
  prefix: string;
  valuePattern: RegExp;
  reasonTemplate: string;
  isSpacingRule: boolean;
}

export interface CompiledConfig {
  rules: CompiledRule[];
  allowed: Set<string>;
  ignore: string[];
}

export interface Violation {
  className: string;
  reason: string;
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

export function compilePattern(
  pattern: string,
  suggestionSuffix?: string,
): CompiledRule {
  const placeholderIndex = pattern.indexOf("{");
  if (placeholderIndex === -1) {
    return {
      prefix: pattern,
      valuePattern: /^$/,
      reasonTemplate: `Prohibited class "{CLASS}"`,
      isSpacingRule: false,
    };
  }

  const prefix = pattern.slice(0, placeholderIndex - 1);
  const valuePart = pattern.slice(placeholderIndex);

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
    const colorSuffix =
      suggestionSuffix ?? "use a design system color token";
    reasonTemplate = `Default Tailwind color "{CLASS}" — ${colorSuffix}`;
  } else {
    regexStr += valuePart
      .replace(/\{n\}/g, "\\d+(\\.\\d+)?")
      .replace(/\{color\}/g, `(${TAILWIND_COLORS.join("|")})`)
      .replace(/\{shade\}/g, "\\d{2,3}");
    reasonTemplate = `Prohibited pattern "{CLASS}"`;
  }

  regexStr += "$";

  return {
    prefix,
    valuePattern: new RegExp(regexStr),
    reasonTemplate,
    isSpacingRule,
  };
}

export function compileConfig(config: LintConfig): CompiledConfig {
  return {
    rules: config.prohibited.map((p) =>
      compilePattern(p, config.suggestionSuffix),
    ),
    allowed: new Set(config.allowed),
    ignore: config.ignore,
  };
}

// ── Class extraction (from src/extractor.ts) ───────────────────────

const IGNORE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore\s*\*\//,
  /\{\/\*\s*design-token-lint-ignore\s*\*\/\}/,
  /\/\/\s*design-token-lint-ignore(?!\S)/,
];

const IGNORE_FILE_PATTERNS = [
  /^\s*\/\*\s*design-token-lint-ignore-file\s*\*\/\s*$/,
  /^\s*\{\/\*\s*design-token-lint-ignore-file\s*\*\/\}\s*$/,
  /^\s*\/\/\s*design-token-lint-ignore-file\s*$/,
];

function isIgnoreLine(line: string): boolean {
  return IGNORE_PATTERNS.some((p) => p.test(line));
}

function addClasses(
  results: ExtractedClass[],
  classString: string,
  line: number,
): void {
  const classes = classString
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

  for (const line of lines) {
    if (IGNORE_FILE_PATTERNS.some((p) => p.test(line))) {
      return [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (isIgnoreLine(lines[i])) {
      ignoredLines.add(i + 1);
    }
  }

  const doubleQuoteAttr = /(?:className|class)\s*=\s*"([^"]+)"/g;
  const singleQuoteAttr = /(?:className|class)\s*=\s*'([^']+)'/g;
  const singleQuoteBrace = /(?:className|class)\s*=\s*\{\s*'([^']+)'\s*\}/g;
  const doubleQuoteBrace = /(?:className|class)\s*=\s*\{\s*"([^"]+)"\s*\}/g;
  const templateLiteral = /(?:className|class)\s*=\s*\{\s*`([^`]+)`\s*\}/g;

  // class:list={[...]} — matches only up to the opening '[' — the array
  // contents are scanned separately via scanBalancedDelimited so the array
  // can span multiple lines.
  const classListStart = /class:list\s*=\s*\{\s*\[/g;

  // Utility function call-start pattern — matches only the function name +
  // opening paren — the args are scanned separately via
  // scanBalancedDelimited so calls can span multiple lines. Word-boundary
  // guard avoids matching a substring of a longer identifier (e.g. "xcn(").
  const utilFnStart = /(?<![\w$])(?:cn|clsx|classNames|twMerge)\s*\(/g;

  lineLoop: for (let i = 0; i < lines.length; i++) {
    if (ignoredLines.has(i)) continue;

    const line = lines[i];
    const lineNum = i + 1;

    for (const match of line.matchAll(doubleQuoteAttr)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(singleQuoteAttr)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(singleQuoteBrace)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(doubleQuoteBrace)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(templateLiteral)) {
      addClasses(results, match[1], lineNum);
    }

    // class:list={[...]} — accumulate across lines until brackets balance
    // (same 50-line cap as utility function calls).
    classListStart.lastIndex = 0;
    let clMatch: RegExpExecArray | null;
    while ((clMatch = classListStart.exec(line)) !== null) {
      const startCol = classListStart.lastIndex; // just past the opening '['
      const arr = scanBalancedDelimited(lines, i, startCol, "[", "]");
      extractFromClassListArray(results, arr.content, i, ignoredLines);

      if (arr.endLine !== i) {
        // Array spanned multiple lines. Blank out the consumed prefix of the
        // closing line (preserving column positions) and reprocess that
        // line, so source after the closing ']' is still scanned.
        lines[arr.endLine] =
          " ".repeat(arr.endCol) + lines[arr.endLine].slice(arr.endCol);
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
      const startCol = utilFnStart.lastIndex; // just past the opening '('
      const call = scanBalancedDelimited(lines, i, startCol, "(", ")");
      extractFromCallArgs(results, call.content, i, ignoredLines);

      if (call.endLine !== i) {
        // Call spanned multiple lines. Blank out the consumed prefix of the
        // closing line (preserving column positions) and reprocess that
        // line, so source after the closing ')' is still scanned.
        lines[call.endLine] =
          " ".repeat(call.endCol) + lines[call.endLine].slice(call.endCol);
        i = call.endLine - 1;
        continue lineLoop;
      }
      utilFnStart.lastIndex = call.endCol;
    }
  }

  return results;
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
 * Scan forward from just after an opening delimiter (`(` for utility
 * function calls, `[` for `class:list` arrays), tracking delimiter depth
 * while skipping over string/template-literal contents — so a closing
 * delimiter or a nested opening one inside a string literal never affects
 * balance. Crosses line boundaries up to a 50-line safety cap, returning
 * whatever was accumulated if the cap is hit.
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
  let line = startLine;
  let col = startCol;
  let linesConsumed = 0;

  while (line < lines.length) {
    const text = lines[line];
    while (col < text.length) {
      const ch = text[col];

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
 * design-token-lint-ignore comment on an inner argument line suppresses
 * only that line's classes. Template-literal tokens containing `${...}`
 * fall through untouched — they don't match any lint rule pattern.
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
    while (
      cursor < newlineOffsets.length &&
      newlineOffsets[cursor] < matchIndex
    ) {
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
 * the key itself is a quoted string literal). Each match is attributed to
 * its actual source line — see extractFromCallArgs for why, and for the
 * ignoredLines semantics applied per inner line.
 */
function extractFromClassListArray(
  results: ExtractedClass[],
  arrayContent: string,
  startLine0: number,
  ignoredLines: Set<number>,
): void {
  const newlineOffsets = collectNewlineOffsets(arrayContent);
  let cursor = 0;
  for (const match of arrayContent.matchAll(/['"]([^'"]+)['"]/g)) {
    const matchIndex = match.index ?? 0;
    while (
      cursor < newlineOffsets.length &&
      newlineOffsets[cursor] < matchIndex
    ) {
      cursor++;
    }
    const actualLine0 = startLine0 + cursor;
    if (ignoredLines.has(actualLine0)) continue;
    addClasses(results, match[1], actualLine0 + 1);
  }
}

// ── Rule matching (from src/rules.ts) ──────────────────────────────

function matchRule(
  originalClassName: string,
  withoutNeg: string,
  rule: CompiledRule,
): Violation | null {
  if (rule.valuePattern.source === "^$") {
    if (withoutNeg === rule.prefix) {
      return {
        className: originalClassName,
        reason: rule.reasonTemplate.replace("{CLASS}", originalClassName),
      };
    }
    return null;
  }

  if (
    withoutNeg === rule.prefix ||
    !withoutNeg.startsWith(rule.prefix + "-")
  ) {
    return null;
  }

  const value = withoutNeg.slice(rule.prefix.length + 1);

  if (
    rule.isSpacingRule &&
    (value.startsWith("hgap-") || value.startsWith("vgap-"))
  ) {
    return null;
  }

  if (rule.isSpacingRule && (value === "0" || value === "1px")) {
    return null;
  }

  if (rule.valuePattern.test(value)) {
    return {
      className: originalClassName,
      reason: rule.reasonTemplate.replace("{CLASS}", originalClassName),
    };
  }

  return null;
}

export function checkClassWithConfig(
  className: string,
  config: CompiledConfig,
): Violation | null {
  const lastColon = className.lastIndexOf(":");
  let stripped = lastColon >= 0 ? className.slice(lastColon + 1) : className;

  // Strip important modifier — leading form is Tailwind v3 (!p-4, sm:!p-4),
  // trailing form is Tailwind v4 (p-4!, sm:p-4!). Both must be stripped
  // before the negative/opacity handling below.
  if (stripped.startsWith("!")) {
    stripped = stripped.slice(1);
  }
  if (stripped.endsWith("!")) {
    stripped = stripped.slice(0, -1);
  }

  const isNegative = stripped.startsWith("-");
  const withoutNeg = isNegative ? stripped.slice(1) : stripped;

  const slashIdx = withoutNeg.indexOf("/");
  const withoutOpacity =
    slashIdx >= 0 ? withoutNeg.slice(0, slashIdx) : withoutNeg;

  if (withoutOpacity.includes("[")) {
    return null;
  }

  // Match against the normalized form AND the original className verbatim,
  // so exact-match entries like "-mt-4", "hover:p-2", or "bg-red-500/50"
  // (copied straight from a violation message) actually take effect.
  if (config.allowed.has(withoutOpacity) || config.allowed.has(className)) {
    return null;
  }

  for (const rule of config.rules) {
    const violation = matchRule(className, withoutOpacity, rule);
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
