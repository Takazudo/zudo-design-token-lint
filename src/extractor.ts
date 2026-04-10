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

// Lines containing line-level ignore comment
const IGNORE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore\s*\*\//,
  /\{\/\*\s*design-token-lint-ignore\s*\*\/\}/,
  /\/\/\s*design-token-lint-ignore(?!\S)/,
];

// Lines containing file-level ignore comment
const IGNORE_FILE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore-file\s*\*\//,
  /\{\/\*\s*design-token-lint-ignore-file\s*\*\/\}/,
  /\/\/\s*design-token-lint-ignore-file/,
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
export function extractClasses(content: string): ExtractedClass[] {
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

  // Patterns to match class attributes
  // className="..." or class="..."
  const doubleQuoteAttr = /(?:className|class)\s*=\s*"([^"]+)"/g;
  // class='...' (single-quote HTML attribute, common in Astro/HTML)
  const singleQuoteAttr = /(?:className|class)\s*=\s*'([^']+)'/g;
  // className={'...'} or class={'...'}
  const singleQuoteBrace = /(?:className|class)\s*=\s*\{\s*'([^']+)'\s*\}/g;
  // className={`...`} template literal (simple, no expressions)
  const templateLiteral = /(?:className|class)\s*=\s*\{\s*`([^`]+)`\s*\}/g;
  // class:list={["...", '...']} — Astro
  const classListPattern = /class:list\s*=\s*\{\s*\[([^\]]+)\]\s*\}/g;
  // clsx/cn/classNames function calls: cn("...", '...'), clsx("...", '...')
  const utilFnPattern = /(?:cn|clsx|classNames|twMerge)\s*\(\s*([^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    if (ignoredLines.has(i)) continue;

    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Extract from double-quote class/className attributes
    for (const match of line.matchAll(doubleQuoteAttr)) {
      addClasses(results, match[1], lineNum);
    }

    // Extract from single-quote class/className attributes (HTML/Astro)
    for (const match of line.matchAll(singleQuoteAttr)) {
      addClasses(results, match[1], lineNum);
    }

    // Extract from single-quote brace attributes
    for (const match of line.matchAll(singleQuoteBrace)) {
      addClasses(results, match[1], lineNum);
    }

    // Extract from template literals (simple — no interpolation)
    for (const match of line.matchAll(templateLiteral)) {
      addClasses(results, match[1], lineNum);
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
    for (const match of line.matchAll(utilFnPattern)) {
      const argsContent = match[1];
      for (const strMatch of argsContent.matchAll(/['"]([^'"]+)['"]/g)) {
        addClasses(results, strMatch[1], lineNum);
      }
    }
  }

  return results;
}

function addClasses(results: ExtractedClass[], classString: string, line: number): void {
  const classes = classString
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  for (const className of classes) {
    results.push({ className, line });
  }
}
