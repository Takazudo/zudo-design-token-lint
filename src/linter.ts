/**
 * Main linter: combines extraction and rule checking.
 */

import { readFile } from 'node:fs/promises';
import { extractClasses } from './extractor.js';
import { checkClass } from './rules.js';

export interface LintResult {
  filePath: string;
  line: number;
  className: string;
  reason: string;
}

/**
 * Lint a single file for design token violations.
 */
export async function lintFile(filePath: string): Promise<LintResult[]> {
  const content = await readFile(filePath, 'utf-8');
  return lintContent(filePath, content);
}

/**
 * Lint content string (for testing without file I/O).
 */
export function lintContent(filePath: string, content: string): LintResult[] {
  const classes = extractClasses(content);
  const results: LintResult[] = [];

  for (const { className, line } of classes) {
    const violation = checkClass(className);
    if (violation) {
      results.push({
        filePath,
        line,
        className: violation.className,
        reason: violation.reason,
      });
    }
  }

  return results;
}
