/**
 * Extract per-declaration `{property, value, line}` triples from plain CSS/SCSS
 * source, line/regex/scan-based — no PostCSS, no AST, consistent with the
 * project's no-dependency philosophy (see the Tailwind `extractor.ts`).
 *
 * The single hard correctness requirement is comment-state awareness: text
 * inside a `/* *\/` block comment (including multi-line spans) must never
 * surface as a declaration. The Tailwind extractor's diagnosed bug class was
 * exactly a comment-state slip, so this module tracks comment/string/paren
 * state explicitly rather than relying on a naive per-line regex.
 *
 * Ignore comments mirror the class-side behavior (issue #123 + #129):
 * `/* design-token-lint-ignore *\/` suppresses the NEXT source line
 * (next-line), and a trailing directive that is NOT alone on its line also
 * suppresses its OWN line (same-line). Trailing reason text
 * (`ignore - because legacy`) is tolerated and captured, consistent with
 * #129's metadata model. `design-token-lint-ignore-file` suppresses the whole
 * file.
 *
 * v1 scope is strictly declaration-based. Documented false negatives (NOT
 * flagged, by design): custom-property values holding literals
 * (`--brand: #f00` — zone-aware Pass 2 deferred), SCSS variable/`$`
 * declarations, SCSS maps, and values split across exotic multi-line syntax.
 */

export interface CssDeclaration {
  /** Property name as written (e.g. `z-index`, `background`, `--brand`). Not lowercased. */
  property: string;
  /** Value text with comments stripped and surrounding whitespace trimmed. */
  value: string;
  /** 1-based line the declaration's property starts on. */
  line: number;
}

export interface CssExtractorOptions {
  /**
   * Enable SCSS-flavored parsing. Currently this only turns on `//` line
   * comments (valid in SCSS, not in plain CSS). `//` is only treated as a
   * comment at paren depth 0 so a `url(http://…)` in either flavor is never
   * mistaken for a line comment.
   */
  scss?: boolean;
}

/**
 * How a single ignore comment relates to the declaration it suppresses —
 * mirrors `IgnoreKind` in the Tailwind extractor (#129).
 */
export type CssIgnoreKind = 'next-line' | 'same-line' | 'file';

export interface CssIgnoreRecord {
  /** 1-based line the ignore comment itself appears on. */
  line: number;
  kind: CssIgnoreKind;
  /** Trailing reason text after the directive, or null when absent. */
  reasonText: string | null;
  /** 1-based line this record suppresses. `0` for `kind: 'file'`. */
  targetLine: number;
  /** Declarations this specific ignore comment suppressed. */
  suppressedDeclarations: CssDeclaration[];
}

export interface CssExtractWithMetaResult {
  declarations: CssDeclaration[];
  ignores: CssIgnoreRecord[];
}

/** A directive found inside a comment during the comment-stripping scan. */
interface IgnoreDirective {
  /** 1-based line the directive's comment starts on. */
  line: number;
  reasonText: string | null;
  isFile: boolean;
}

interface ScanResult {
  /** Content with every comment replaced by spaces (newlines preserved so line numbers survive). */
  cleaned: string;
  directives: IgnoreDirective[];
}

const FILE_DIRECTIVE = /^design-token-lint-ignore-file$/;
// The negative lookahead keeps `design-token-lint-ignore-file` from also
// matching here (it is handled by FILE_DIRECTIVE first); `\b` then splits the
// directive from any trailing reason text.
const LINE_DIRECTIVE = /^design-token-lint-ignore(?!-file)\b([\s\S]*)$/;

/**
 * Trim a captured reason string and strip a single leading separator
 * (`-`, en dash, em dash, or `:`) from the "ignore - reason" convention.
 * Returns null when nothing meaningful remains. Mirrors
 * `extractIgnoreReasonText` in the Tailwind extractor (#129).
 */
function stripReasonSeparator(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const stripped = trimmed.replace(/^[-–—:]\s*/, '').trim();
  return stripped === '' ? null : stripped;
}

/**
 * Classify a comment's inner text as a file-level directive, a line-level
 * directive (with optional reason), or neither, and record it.
 */
function recordDirective(innerText: string, startLine: number, out: IgnoreDirective[]): void {
  const trimmed = innerText.trim();
  if (FILE_DIRECTIVE.test(trimmed)) {
    out.push({ line: startLine, reasonText: null, isFile: true });
    return;
  }
  const match = trimmed.match(LINE_DIRECTIVE);
  if (match) {
    out.push({ line: startLine, reasonText: stripReasonSeparator(match[1] ?? ''), isFile: false });
  }
}

/**
 * Single forward scan that blanks out every comment (to spaces, keeping
 * newlines) and records any ignore directive found inside a comment. String
 * literals are tracked so a `/*`-looking sequence inside a quoted value is not
 * mistaken for a comment; paren depth is tracked so `//` inside `url(…)` is
 * not mistaken for an SCSS line comment.
 */
function scanComments(content: string, allowLineComments: boolean): ScanResult {
  const cleaned = content.split('');
  const directives: IgnoreDirective[] = [];
  let i = 0;
  let line = 1;
  let quote: string | null = null;
  let parenDepth = 0;

  while (i < content.length) {
    const ch = content[i];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        // Escape: skip the next char. A line-continuation backslash-newline
        // still has to advance the line counter.
        if (content[i + 1] === '\n') line++;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
      i++;
      continue;
    }

    // Block comment /* ... */ (may span lines).
    if (ch === '/' && content[i + 1] === '*') {
      const startLine = line;
      let j = i + 2;
      while (j < content.length && !(content[j] === '*' && content[j + 1] === '/')) {
        if (content[j] === '\n') line++;
        j++;
      }
      const innerEnd = Math.min(j, content.length);
      const closeEnd = j < content.length ? j + 2 : content.length;
      recordDirective(content.slice(i + 2, innerEnd), startLine, directives);
      for (let k = i; k < closeEnd; k++) {
        if (cleaned[k] !== '\n') cleaned[k] = ' ';
      }
      i = closeEnd;
      continue;
    }

    // SCSS line comment // ... (to end of line), only outside parens so a
    // `url(http://…)` scheme separator is never treated as a comment.
    if (allowLineComments && ch === '/' && content[i + 1] === '/' && parenDepth === 0) {
      let j = i + 2;
      while (j < content.length && content[j] !== '\n') j++;
      recordDirective(content.slice(i + 2, j), line, directives);
      for (let k = i; k < j; k++) cleaned[k] = ' ';
      i = j;
      continue;
    }

    i++;
  }

  return { cleaned: cleaned.join(''), directives };
}

/**
 * Parse declarations from comment-free CSS (the `cleaned` output of
 * `scanComments`). Tracks string, paren, and brace state so that:
 * - selector preludes (text before `{`) are discarded, not read as declarations;
 * - a `:` inside a value (`url(http://…)`) never re-splits the declaration;
 * - a `;` inside `url(data:…;base64,…)` or any function paren does not end it;
 * - a `{`/`}`/`;`/`:` inside a string literal is inert.
 *
 * Only chunks that terminate inside a rule block (brace depth > 0) count, so
 * top-level SCSS `$var: …;` / maps are skipped (documented false negatives).
 */
function parseDeclarations(cleaned: string): CssDeclaration[] {
  const decls: CssDeclaration[] = [];
  let i = 0;
  let line = 1;
  let quote: string | null = null;
  let parenDepth = 0;
  let braceDepth = 0;

  let buf = '';
  let bufStartLine = 0;
  let bufHasContent = false;

  const resetBuf = (): void => {
    buf = '';
    bufStartLine = 0;
    bufHasContent = false;
  };

  const emit = (): void => {
    // Only declarations inside a rule block are considered.
    if (braceDepth <= 0) {
      resetBuf();
      return;
    }
    const raw = buf.trim();
    if (raw === '') {
      resetBuf();
      return;
    }
    const colon = raw.indexOf(':');
    if (colon === -1) {
      resetBuf();
      return;
    }
    const property = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (property !== '' && value !== '') {
      decls.push({ property, value, line: bufStartLine });
    }
    resetBuf();
  };

  while (i < cleaned.length) {
    const ch = cleaned[i];

    if (ch === '\n') {
      line++;
      if (bufHasContent || buf !== '') buf += ch;
      i++;
      continue;
    }

    if (quote) {
      buf += ch;
      if (ch === '\\' && i + 1 < cleaned.length) {
        buf += cleaned[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      if (!bufHasContent) {
        bufStartLine = line;
        bufHasContent = true;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      if (!bufHasContent) {
        bufStartLine = line;
        bufHasContent = true;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
      buf += ch;
      i++;
      continue;
    }

    if (ch === '{') {
      // Everything buffered so far was a selector / at-rule prelude.
      braceDepth++;
      resetBuf();
      i++;
      continue;
    }

    if (ch === '}') {
      // A block can close right after its last declaration with no trailing `;`.
      emit();
      if (braceDepth > 0) braceDepth--;
      i++;
      continue;
    }

    if (ch === ';' && parenDepth === 0) {
      emit();
      i++;
      continue;
    }

    if (!bufHasContent && !/\s/.test(ch)) {
      bufStartLine = line;
      bufHasContent = true;
    }
    buf += ch;
    i++;
  }

  return decls;
}

/** True when `cleaned`'s given 1-based line is entirely whitespace. */
function lineIsBlank(cleanedLines: string[], lineNum: number): boolean {
  const l = cleanedLines[lineNum - 1] ?? '';
  return l.trim() === '';
}

/**
 * Extract every declaration from CSS/SCSS content, with ignore comments
 * applied (suppressed declarations are removed). This is what the linter
 * consumes.
 */
export function extractCssDeclarations(
  content: string,
  options?: CssExtractorOptions,
): CssDeclaration[] {
  const { cleaned, directives } = scanComments(content, options?.scss === true);

  if (directives.some((d) => d.isFile)) {
    return [];
  }

  const decls = parseDeclarations(cleaned);
  if (directives.length === 0) return decls;

  const cleanedLines = cleaned.split('\n');
  const ignoredLines = new Set<number>();
  for (const d of directives) {
    ignoredLines.add(d.line + 1); // next-line
    if (!lineIsBlank(cleanedLines, d.line)) {
      ignoredLines.add(d.line); // trailing (same-line) directive suppresses its own line too
    }
  }

  return decls.filter((decl) => !ignoredLines.has(decl.line));
}

/**
 * Extract declarations plus structured metadata for every ignore comment —
 * its kind (`next-line` / `same-line` / `file`), any trailing reason text, and
 * which declarations it suppressed. Purely additive groundwork mirroring the
 * Tailwind extractor's `extractClassesWithMeta` (#129); `declarations` is the
 * same suppressed set `extractCssDeclarations` returns.
 *
 * A trailing (not-alone) directive yields two records — a `same-line` record
 * for its own line and a `next-line` record for the following line — matching
 * the class-side model. Suppressed-declaration attribution is per target line
 * (declaration-based v1): a record claims the suppressed declarations whose
 * start line equals its `targetLine`.
 */
export function extractCssDeclarationsWithMeta(
  content: string,
  options?: CssExtractorOptions,
): CssExtractWithMetaResult {
  const { cleaned, directives } = scanComments(content, options?.scss === true);
  const declarations = extractCssDeclarations(content, options);

  const hasFileIgnore = directives.some((d) => d.isFile);
  if (hasFileIgnore) {
    const allCandidates = parseDeclarations(cleaned);
    const ignores: CssIgnoreRecord[] = directives
      .filter((d) => d.isFile)
      .map((d) => ({
        line: d.line,
        kind: 'file' as const,
        reasonText: d.reasonText,
        targetLine: 0,
        suppressedDeclarations: allCandidates,
      }));
    return { declarations, ignores };
  }

  const allCandidates = parseDeclarations(cleaned);
  const candidatesByLine = new Map<number, CssDeclaration[]>();
  for (const decl of allCandidates) {
    const list = candidatesByLine.get(decl.line);
    if (list) list.push(decl);
    else candidatesByLine.set(decl.line, [decl]);
  }
  const finalByLine = new Set(declarations.map((d) => d.line));
  const suppressedOnLine = (lineNum: number): CssDeclaration[] =>
    finalByLine.has(lineNum) ? [] : (candidatesByLine.get(lineNum) ?? []);

  const cleanedLines = cleaned.split('\n');
  const ignores: CssIgnoreRecord[] = [];
  for (const d of directives) {
    if (!lineIsBlank(cleanedLines, d.line)) {
      ignores.push({
        line: d.line,
        kind: 'same-line',
        reasonText: d.reasonText,
        targetLine: d.line,
        suppressedDeclarations: suppressedOnLine(d.line),
      });
    }
    ignores.push({
      line: d.line,
      kind: 'next-line',
      reasonText: d.reasonText,
      targetLine: d.line + 1,
      suppressedDeclarations: suppressedOnLine(d.line + 1),
    });
  }

  return { declarations, ignores };
}
