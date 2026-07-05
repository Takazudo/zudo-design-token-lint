/**
 * Main linter: combines extraction and rule checking.
 */

import { readFile } from 'node:fs/promises';
import { extractClasses } from './extractor.js';
import { checkClass, getConfig } from './rules.js';
import { extractCssDeclarations } from './css-extractor.js';
import { checkDeclaration, type CompiledCssConfig } from './css-rules.js';

export interface LintResult {
  filePath: string;
  line: number;
  className: string;
  reason: string;
}

/**
 * Whether a path is a CSS/SCSS file the css rules can handle. Extension check
 * only — case-insensitive so `.CSS`/`.SCSS` are covered too.
 */
function isCssPath(filePath: string): boolean {
  return /\.(css|scss)$/i.test(filePath);
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
  const config = getConfig();

  // CSS/SCSS dispatch — ONLY when a `css` section is configured. When it is
  // absent (`config.css` undefined) this branch is skipped entirely, so a
  // `.css` file falls through to the Tailwind path exactly as before: zero
  // behavior change when the css section is not present.
  if (config.css && isCssPath(filePath)) {
    return lintCssContent(filePath, content, config.css, /\.scss$/i.test(filePath));
  }

  const classes = extractClasses(content, {
    classAttributes: config.classAttributes,
    classFunctions: config.classFunctions,
  });
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

/**
 * Lint a CSS/SCSS content string against the declaration-value rules. The
 * offending declaration is carried in `className` in a stable `prop: value`
 * form (e.g. `z-index: 9999`); `reason` holds the rule message.
 */
function lintCssContent(
  filePath: string,
  content: string,
  cssConfig: CompiledCssConfig,
  scss: boolean,
): LintResult[] {
  const declarations = extractCssDeclarations(content, { scss });
  const results: LintResult[] = [];
  for (const decl of declarations) {
    const violation = checkDeclaration(decl, cssConfig);
    if (violation) {
      results.push({
        filePath,
        line: decl.line,
        className: violation.className,
        reason: violation.reason,
      });
    }
  }
  return results;
}
