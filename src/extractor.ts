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

// Lines containing line-level ignore comment. The block/JSX forms tolerate
// trailing reason text (e.g. `{/* design-token-lint-ignore — reason */}`) via
// a capturing group — the reason text itself isn't consumed yet, but a future
// change may surface it in lint output.
const IGNORE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore\b([^*]*)\*\//,
  /\{\/\*\s*design-token-lint-ignore\b([^*]*)\*\/\}/,
  /\/\/\s*design-token-lint-ignore(?!\S)(.*)$/,
];

// Lines containing file-level ignore comment (anchored to comment-only lines)
const IGNORE_FILE_PATTERNS = [
  /^\s*\/\*\s*design-token-lint-ignore-file\s*\*\/\s*$/,
  /^\s*\{\/\*\s*design-token-lint-ignore-file\s*\*\/\}\s*$/,
  /^\s*\/\/\s*design-token-lint-ignore-file\s*$/,
];

/**
 * Find the first design-token-lint-ignore comment match on a line, or null.
 */
function findIgnoreMatch(line: string): RegExpMatchArray | null {
  for (const pattern of IGNORE_PATTERNS) {
    const match = line.match(pattern);
    if (match) return match;
  }
  return null;
}

/**
 * Check if a line contains a design-token-lint-ignore comment.
 */
function isIgnoreLine(line: string): boolean {
  return findIgnoreMatch(line) !== null;
}

/**
 * Check whether an ignore-comment match is the only non-whitespace content on
 * its line (as opposed to trailing other real content, e.g.
 * `<div className="p-4"> {/* design-token-lint-ignore *\/}`).
 */
function isIgnoreMatchAloneOnLine(line: string, match: RegExpMatchArray): boolean {
  const index = match.index ?? 0;
  const before = line.slice(0, index);
  const after = line.slice(index + match[0].length);
  return before.trim() === '' && after.trim() === '';
}

interface CommentSpan {
  /** 0-based start offset (inclusive) of the comment on the line. */
  start: number;
  /** 0-based end offset (exclusive) of the comment on the line. */
  end: number;
}

/**
 * Compute `//` and `/* *\/` comment spans on a single line, so matches that
 * fall inside commented-out source (e.g. `{/* <div className="p-4"> *\/}` or
 * `// <div className="p-4">`) can be skipped. Quote-aware — a comment marker
 * inside a string literal (e.g. a URL) is not mistaken for a real comment.
 * This is a lightweight per-line pass only: a `/* *\/` block comment that
 * doesn't close on the same line is treated as running to the end of the
 * line — multi-line block comments aren't tracked (project stays
 * regex/line-based, not AST).
 */
function getCommentSpans(line: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let quote: string | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (quote) {
      if (ch === '\\' && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }

    if (ch === '/' && line[i + 1] === '/') {
      spans.push({ start: i, end: line.length });
      break;
    }

    if (ch === '/' && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
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
    const match = findIgnoreMatch(lines[i]);
    if (match) {
      ignoredLines.add(i + 1); // ignore next line (0-indexed)
      if (!isIgnoreMatchAloneOnLine(lines[i], match)) {
        // Trailing same-line ignore (e.g.
        // `<div className="p-4"> {/* design-token-lint-ignore */}`) also
        // suppresses its own line, not just the next one.
        ignoredLines.add(i);
      }
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
    // Comment spans on this line — matches falling inside are commented-out
    // source, not real code, and must be skipped (see getCommentSpans).
    const commentSpans = getCommentSpans(line);

    // Extract from double-quote class/className attributes
    if (doubleQuoteAttr) {
      for (const match of line.matchAll(doubleQuoteAttr)) {
        if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from single-quote class/className attributes (HTML/Astro)
    if (singleQuoteAttr) {
      for (const match of line.matchAll(singleQuoteAttr)) {
        if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from single-quote brace attributes
    if (singleQuoteBrace) {
      for (const match of line.matchAll(singleQuoteBrace)) {
        if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from double-quote brace attributes
    if (doubleQuoteBrace) {
      for (const match of line.matchAll(doubleQuoteBrace)) {
        if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from template literals (simple — no interpolation)
    if (templateLiteral) {
      for (const match of line.matchAll(templateLiteral)) {
        if (isInCommentSpan(commentSpans, match.index ?? 0)) continue;
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from class:list arrays (cn/clsx-style: accumulate across lines
    // until the brackets balance, same 50-line cap as utility function calls).
    classListStart.lastIndex = 0;
    let clMatch: RegExpExecArray | null;
    while ((clMatch = classListStart.exec(line)) !== null) {
      if (isInCommentSpan(commentSpans, clMatch.index)) continue;
      const startCol = classListStart.lastIndex; // just past the opening '['
      const arr = scanBalancedDelimited(lines, i, startCol, '[', ']');
      extractFromClassListArray(results, arr.content, i, ignoredLines);

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
        if (isInCommentSpan(commentSpans, fnMatch.index)) continue;
        const startCol = utilFnStart.lastIndex; // just past the opening '('
        const call = scanBalancedDelimited(lines, i, startCol, '(', ')');
        extractFromCallArgs(results, call.content, i, ignoredLines);

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

    if (multilineMatch && !isInCommentSpan(commentSpans, multilineMatch.index ?? 0)) {
      const quoteChar = multilineDoubleMatch ? '"' : "'";
      const openLineNum = lineNum;
      // Each line's content is attributed to its own actual source line
      // (mirrors the per-line attribution the cn()/class:list paths already
      // do via collectNewlineOffsets), so `--format github` annotations for
      // continuation-line classes point at the right line instead of all
      // collapsing onto the opening line.
      addClasses(results, multilineMatch[1], openLineNum);

      // Accumulate subsequent lines until the closing quote is found.
      // Safety limit: stop after 50 lines to avoid consuming entire file on malformed input.
      const maxLines = 50;
      let linesConsumed = 0;
      let closeCol = -1;
      while (i + 1 < lines.length && linesConsumed < maxLines) {
        i++;
        linesConsumed++;
        const nextLineNum = i + 1;
        const nextLine = lines[i];
        // A design-token-lint-ignore comment on this continuation line
        // suppresses it — either because it was marked via ignoredLines
        // (own-line/next-line semantics from the first pass) or because the
        // line itself IS the ignore comment (its raw text must never be
        // treated as literal class content, mirroring how the cn()/
        // class:list inner-line paths only ever see quoted content).
        const skipLine = ignoredLines.has(i) || isIgnoreLine(nextLine);
        const closeIdx = nextLine.indexOf(quoteChar);
        if (closeIdx !== -1) {
          // Take everything before the closing quote
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
        // closing quote — other attributes, utility calls — is still
        // scanned. Mirrors the class:list/utilFn closing-line treatment
        // above (this is the same "resume on the closing line" pattern).
        lines[i] = ' '.repeat(closeCol) + lines[i].slice(closeCol);
        i = i - 1;
        continue lineLoop;
      }
    }
  }

  return dedupeExtractedClasses(results);
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
 * opening one inside a string literal never affects balance. Also skips over
 * `//` and `/* *\/` comment spans (blanking them out of `content`) so an
 * unpaired quote inside a comment — e.g. `cn(a /* don't *\/, 'p-4')` — can't
 * be mistaken for a string opener, and so the comment text can't resurface as
 * a spurious quoted match when the caller re-scans `content` for class
 * tokens. Crosses line boundaries up to a 50-line safety cap (mirrors the
 * multiline class-attribute accumulator), returning whatever was accumulated
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
  let content = '';
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
        if (ch === '*' && text[col + 1] === '/') {
          content += '  ';
          col += 2;
          inBlockComment = false;
          continue;
        }
        content += ' ';
        col++;
        continue;
      }

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

      if (ch === '/' && text[col + 1] === '/') {
        // Line comment: blank out the rest of the line.
        content += ' '.repeat(text.length - col);
        col = text.length;
        continue;
      }

      if (ch === '/' && text[col + 1] === '*') {
        content += '  ';
        col += 2;
        inBlockComment = true;
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
 * that line's classes (mirrors the ignoredLines semantics used for single-line
 * extraction). Template-literal tokens containing `${...}` fall through
 * untouched (same as the attribute-level template literal handling) — they
 * don't match any lint rule pattern.
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
    const value = match[1] ?? match[2] ?? match[3] ?? '';
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
 * actual source line — see extractFromCallArgs for why, and for the
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
  // Paired-quote alternation (mirrors extractFromCallArgs) — a token opened
  // with one quote character must close with the SAME character, so a
  // mismatched pair like `["p-4']` (opens with ", closes with ') is never
  // mistaken for a valid quoted literal.
  for (const match of arrayContent.matchAll(/'([^']+)'|"([^"]+)"/g)) {
    const value = match[1] ?? match[2] ?? '';
    const matchIndex = match.index ?? 0;
    while (cursor < newlineOffsets.length && newlineOffsets[cursor] < matchIndex) {
      cursor++;
    }
    const actualLine0 = startLine0 + cursor;
    if (ignoredLines.has(actualLine0)) continue;
    addClasses(results, value, actualLine0 + 1);
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
