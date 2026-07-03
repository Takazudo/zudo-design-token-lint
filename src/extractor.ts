/**
 * Extract class names from source files (.tsx, .jsx, .astro).
 *
 * Handles:
 * - className="..." and className={'...'} in TSX/JSX
 * - class="..." and class:list={[...]} in Astro
 * - Template literal classNames (simple cases)
 * - Ignore comments: design-token-lint-ignore (line), design-token-lint-ignore-file (file)
 */

export interface ExtractedClass {
  className: string;
  line: number;
}

export interface ExtractorOptions {
  classAttributes?: string[];
  classFunctions?: string[];
}

export const DEFAULT_CLASS_ATTRIBUTES = ['className', 'class'];
export const DEFAULT_CLASS_FUNCTIONS = ['cn', 'clsx', 'classNames', 'twMerge'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lines containing line-level ignore comment
const IGNORE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore\s*\*\//,
  /\{\/\*\s*design-token-lint-ignore\s*\*\/\}/,
  /\/\/\s*design-token-lint-ignore(?!\S)/,
];

// Lines containing file-level ignore comment (anchored to comment-only lines)
const IGNORE_FILE_PATTERNS = [
  /^\s*\/\*\s*design-token-lint-ignore-file\s*\*\/\s*$/,
  /^\s*\{\/\*\s*design-token-lint-ignore-file\s*\*\/\}\s*$/,
  /^\s*\/\/\s*design-token-lint-ignore-file\s*$/,
];

/**
 * Check if a line contains a design-token-lint-ignore comment.
 */
function isIgnoreLine(line: string): boolean {
  return IGNORE_PATTERNS.some((p) => p.test(line));
}

/**
 * Extract all class names from file content with their line numbers.
 */
export function extractClasses(content: string, options?: ExtractorOptions): ExtractedClass[] {
  const lines = content.split('\n');
  const results: ExtractedClass[] = [];
  const ignoredLines = new Set<number>();

  // Check for file-level ignore comment anywhere in the file
  for (const line of lines) {
    if (IGNORE_FILE_PATTERNS.some((p) => p.test(line))) {
      return [];
    }
  }

  // First pass: find ignore comments, mark next line
  for (let i = 0; i < lines.length; i++) {
    if (isIgnoreLine(lines[i])) {
      ignoredLines.add(i + 1); // ignore next line (0-indexed)
    }
  }

  const attrs = options?.classAttributes ?? DEFAULT_CLASS_ATTRIBUTES;
  const fns = options?.classFunctions ?? DEFAULT_CLASS_FUNCTIONS;

  // Build attribute patterns dynamically; skip entirely when attrs is empty
  let doubleQuoteAttr: RegExp | null = null;
  let singleQuoteAttr: RegExp | null = null;
  let singleQuoteBrace: RegExp | null = null;
  let doubleQuoteBrace: RegExp | null = null;
  let templateLiteral: RegExp | null = null;
  let multilineDoubleStart: RegExp | null = null;
  let multilineSingleStart: RegExp | null = null;

  if (attrs.length > 0) {
    const attrAlt = attrs.map(escapeRegExp).join('|');
    // className="..." or class="..."
    doubleQuoteAttr = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*"([^"]+)"`, 'g');
    // class='...' (single-quote HTML attribute, common in Astro/HTML)
    singleQuoteAttr = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*'([^']+)'`, 'g');
    // className={'...'} or class={'...'}
    singleQuoteBrace = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*'([^']+)'\\s*\\}`, 'g');
    // className={"..."} or class={"..."}
    doubleQuoteBrace = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*"([^"]+)"\\s*\\}`, 'g');
    // className={`...`} template literal (simple, no expressions)
    templateLiteral = new RegExp(
      `(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*\`([^\`]+)\`\\s*\\}`,
      'g',
    );
    // Multiline: className="... without closing quote on same line
    multilineDoubleStart = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*"([^"]*$)`);
    multilineSingleStart = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*'([^']*$)`);
  }

  // class:list={[...]} — Astro (always hardcoded). Matches only up to the
  // opening '[' — the array contents are scanned separately via
  // scanBalancedDelimited so the array can span multiple lines.
  const classListStart = /class:list\s*=\s*\{\s*\[/g;

  // Build utility function call-start pattern dynamically; skip entirely when fns is empty.
  // Matches only the function name + opening paren — the args themselves are scanned
  // separately via scanBalancedDelimited so calls can span multiple lines.
  let utilFnStart: RegExp | null = null;
  if (fns.length > 0) {
    const fnAlt = fns.map(escapeRegExp).join('|');
    utilFnStart = new RegExp(`(?<![\\w$])(?:${fnAlt})\\s*\\(`, 'g');
  }

  lineLoop: for (let i = 0; i < lines.length; i++) {
    if (ignoredLines.has(i)) continue;

    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Extract from double-quote class/className attributes
    if (doubleQuoteAttr) {
      for (const match of line.matchAll(doubleQuoteAttr)) {
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from single-quote class/className attributes (HTML/Astro)
    if (singleQuoteAttr) {
      for (const match of line.matchAll(singleQuoteAttr)) {
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from single-quote brace attributes
    if (singleQuoteBrace) {
      for (const match of line.matchAll(singleQuoteBrace)) {
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from double-quote brace attributes
    if (doubleQuoteBrace) {
      for (const match of line.matchAll(doubleQuoteBrace)) {
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from template literals (simple — no interpolation)
    if (templateLiteral) {
      for (const match of line.matchAll(templateLiteral)) {
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from class:list arrays (cn/clsx-style: accumulate across lines
    // until the brackets balance, same 50-line cap as utility function calls).
    classListStart.lastIndex = 0;
    let clMatch: RegExpExecArray | null;
    while ((clMatch = classListStart.exec(line)) !== null) {
      const startCol = classListStart.lastIndex; // just past the opening '['
      const arr = scanBalancedDelimited(lines, i, startCol, '[', ']');
      extractFromClassListArray(results, arr.content, lineNum);

      if (arr.endLine !== i) {
        // Array spanned multiple lines. Blank out the consumed prefix of the
        // closing line (preserving column positions) and reprocess that line,
        // so source after the closing `]` — other attributes, utility calls —
        // is still scanned.
        lines[arr.endLine] = ' '.repeat(arr.endCol) + lines[arr.endLine].slice(arr.endCol);
        i = arr.endLine - 1;
        continue lineLoop;
      }
      classListStart.lastIndex = arr.endCol;
    }

    // Extract from utility function calls (cn(...), clsx(...), etc.).
    // Accumulate arguments across lines until parens balance — mirrors the
    // multiline class-attribute accumulator below, including its 50-line cap.
    if (utilFnStart) {
      utilFnStart.lastIndex = 0;
      let fnMatch: RegExpExecArray | null;
      while ((fnMatch = utilFnStart.exec(line)) !== null) {
        const startCol = utilFnStart.lastIndex; // just past the opening '('
        const call = scanBalancedDelimited(lines, i, startCol, '(', ')');
        extractFromCallArgs(results, call.content, lineNum);

        if (call.endLine !== i) {
          // Call spanned multiple lines. Blank out the consumed prefix of the
          // closing line (preserving column positions) and reprocess that
          // line, so source after the closing `)` — further calls,
          // attributes — is still scanned.
          lines[call.endLine] = ' '.repeat(call.endCol) + lines[call.endLine].slice(call.endCol);
          i = call.endLine - 1;
          continue lineLoop;
        }
        utilFnStart.lastIndex = call.endCol;
      }
    }

    // Detect unclosed multiline class/className attribute and accumulate across lines
    const multilineDoubleMatch = multilineDoubleStart ? multilineDoubleStart.exec(line) : null;
    const multilineSingleMatch =
      !multilineDoubleMatch && multilineSingleStart ? multilineSingleStart.exec(line) : null;
    const multilineMatch = multilineDoubleMatch ?? multilineSingleMatch;

    if (multilineMatch) {
      const quoteChar = multilineDoubleMatch ? '"' : "'";
      let accumulated = multilineMatch[1]; // content after opening quote on opening line
      const openLineNum = lineNum;

      // Accumulate subsequent lines until the closing quote is found.
      // Safety limit: stop after 50 lines to avoid consuming entire file on malformed input.
      const maxLines = 50;
      let linesConsumed = 0;
      while (i + 1 < lines.length && linesConsumed < maxLines) {
        i++;
        linesConsumed++;
        const nextLine = lines[i];
        const closeIdx = nextLine.indexOf(quoteChar);
        if (closeIdx !== -1) {
          // Take everything before the closing quote
          accumulated += ' ' + nextLine.substring(0, closeIdx);
          break;
        } else {
          accumulated += ' ' + nextLine;
        }
      }

      addClasses(results, accumulated, openLineNum);
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
 * Scan forward from just after an opening delimiter (`(` for utility function
 * calls, `[` for `class:list` arrays), tracking delimiter depth while skipping
 * over string/template-literal contents — so a closing delimiter or a nested
 * opening one inside a string literal never affects balance. Crosses line
 * boundaries up to a 50-line safety cap (mirrors the multiline class-attribute
 * accumulator), returning whatever was accumulated if the cap is hit.
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
  let content = '';
  let quote: string | null = null;
  let line = startLine;
  let col = startCol;
  let linesConsumed = 0;

  while (line < lines.length) {
    const text = lines[line];
    while (col < text.length) {
      const ch = text[col];

      if (quote) {
        if (ch === '\\' && col + 1 < text.length) {
          content += ch + text[col + 1];
          col += 2;
          continue;
        }
        if (ch === quote) quote = null;
        content += ch;
        col++;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
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
    content += '\n';
  }

  return { content, endLine: Math.max(line - 1, startLine), endCol: col };
}

/**
 * Extract string-literal and template-literal class tokens from a utility
 * function's joined argument text. Template-literal tokens containing `${...}`
 * fall through untouched (same as the attribute-level template literal
 * handling) — they don't match any lint rule pattern.
 */
function extractFromCallArgs(results: ExtractedClass[], argsText: string, line: number): void {
  for (const match of argsText.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    addClasses(results, value, line);
  }
}

/**
 * Extract single/double-quoted string literals from a `class:list` array's
 * joined content (object-key form like `{ "p-4": true }` is included, since
 * the key itself is a quoted string literal).
 */
function extractFromClassListArray(
  results: ExtractedClass[],
  arrayContent: string,
  line: number,
): void {
  for (const match of arrayContent.matchAll(/['"]([^'"]+)['"]/g)) {
    addClasses(results, match[1], line);
  }
}

function addClasses(results: ExtractedClass[], classString: string, line: number): void {
  const cleaned = classString.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const classes = cleaned
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  for (const className of classes) {
    results.push({ className, line });
  }
}
