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
    // className={`...`} template literal (simple, no expressions)
    templateLiteral = new RegExp(
      `(?<![\\w-])(?:${attrAlt})\\s*=\\s*\\{\\s*\`([^\`]+)\`\\s*\\}`,
      'g',
    );
    // Multiline: className="... without closing quote on same line
    multilineDoubleStart = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*"([^"]*$)`);
    multilineSingleStart = new RegExp(`(?<![\\w-])(?:${attrAlt})\\s*=\\s*'([^']*$)`);
  }

  // class:list={["...", '...']} — Astro (always hardcoded)
  const classListPattern = /class:list\s*=\s*\{\s*\[([^\]]+)\]\s*\}/g;

  // Build utility function pattern dynamically; skip entirely when fns is empty
  let utilFnPattern: RegExp | null = null;
  if (fns.length > 0) {
    const fnAlt = fns.map(escapeRegExp).join('|');
    utilFnPattern = new RegExp(`(?:${fnAlt})\\s*\\(\\s*([^)]+)\\)`, 'g');
  }

  for (let i = 0; i < lines.length; i++) {
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

    // Extract from template literals (simple — no interpolation)
    if (templateLiteral) {
      for (const match of line.matchAll(templateLiteral)) {
        addClasses(results, match[1], lineNum);
      }
    }

    // Extract from class:list arrays
    for (const match of line.matchAll(classListPattern)) {
      const arrayContent = match[1];
      // Extract string literals from array
      for (const strMatch of arrayContent.matchAll(/['"]([^'"]+)['"]/g)) {
        addClasses(results, strMatch[1], lineNum);
      }
    }

    // Extract from utility function calls
    if (utilFnPattern) {
      for (const match of line.matchAll(utilFnPattern)) {
        const argsContent = match[1];
        for (const strMatch of argsContent.matchAll(/['"]([^'"]+)['"]/g)) {
          addClasses(results, strMatch[1], lineNum);
        }
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
