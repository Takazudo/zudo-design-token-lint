/**
 * Main linter: combines extraction and rule checking.
 */

import { readFile } from 'node:fs/promises';
import { extractClasses, extractClassesWithMeta, type IgnoreRecord } from './extractor.js';
import { checkClass, getConfig } from './rules.js';
import {
  extractCssDeclarations,
  extractCssDeclarationsWithMeta,
  type CssDeclaration,
  type CssIgnoreRecord,
} from './css-extractor.js';
import { checkDeclaration, type CompiledCssConfig, type CssViolation } from './css-rules.js';
import type { CompiledConfig } from './config.js';

export interface LintResult {
  filePath: string;
  line: number;
  className: string;
  reason: string;
}

// Distinct, stable, greppable reason for a `requireIgnoreReason` finding
// (issue #132) — a bare (reason-less) ignore comment that shielded a real
// violation. Wording is locked: tooling/CI may grep for it.
const SUPPRESSED_WITHOUT_REASON_REASON = 'suppressed without documented reason';

// `className` used for a `reportUnusedIgnores` finding (issue #132) — the
// finding is ABOUT the ignore comment itself, not a class name, but LintResult
// has no separate slot for that, so the comment's own directive name is
// carried in `className` per the locked result model (decision D6).
const UNUSED_IGNORE_CLASS_NAME = 'design-token-lint-ignore';
const UNUSED_IGNORE_REASON = 'Unused design-token-lint-ignore comment — suppressed no violation';

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
    return lintCssContent(filePath, content, config, /\.scss$/i.test(filePath));
  }

  const ignoreHygieneEnabled = config.requireIgnoreReason || config.reportUnusedIgnores;

  // Both hygiene flags off (the default): the exact original code path, byte
  // for byte, so behavior is unchanged for every existing config (regression
  // pinned in linter.test.ts).
  if (!ignoreHygieneEnabled) {
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

  // Ignore hygiene path — consumes #129's ignore-metadata model
  // (extractClassesWithMeta) instead of re-parsing ignore comments here.
  // `classes` is produced by the exact same extractClassesCore(..., false)
  // path extractClasses() uses, so the "normal" violation results below are
  // identical to the branch above; only the extra hygiene findings are new.
  const { classes, ignores } = extractClassesWithMeta(content, {
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

  results.push(
    ...ignoreHygieneResultsForClasses(
      filePath,
      ignores,
      config.requireIgnoreReason,
      config.reportUnusedIgnores,
    ),
  );

  // Stable sort into top-down file order: hygiene findings anchor at lines
  // the "normal" pass above never visits (a suppressed class's line, or an
  // ignore comment's own line), so the two result sets need merging by line
  // to read like a single coherent report.
  results.sort((a, b) => a.line - b.line);
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
  config: CompiledConfig,
  scss: boolean,
): LintResult[] {
  // config.css is guaranteed by the caller (dispatch only happens when it's set).
  const cssConfig = config.css as CompiledCssConfig;
  const ignoreHygieneEnabled = config.requireIgnoreReason || config.reportUnusedIgnores;

  if (!ignoreHygieneEnabled) {
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

  const { declarations, ignores } = extractCssDeclarationsWithMeta(content, { scss });
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

  results.push(
    ...ignoreHygieneResultsForCss(
      filePath,
      ignores,
      cssConfig,
      config.requireIgnoreReason,
      config.reportUnusedIgnores,
    ),
  );

  results.sort((a, b) => a.line - b.line);
  return results;
}

/**
 * Compute `requireIgnoreReason`/`reportUnusedIgnores` findings (issue #132)
 * for the Tailwind class path, from #129's `IgnoreRecord[]` metadata.
 *
 * `reportUnusedIgnores` groups records by the ignore comment's own `line`
 * (not by record) before deciding "unused": a trailing same-line ignore
 * produces two records (`same-line` + `next-line`) that share one physical
 * comment, and the comment counts as used if EITHER suppression zone
 * shielded a real violation — otherwise a single comment would be reported
 * as unused twice.
 */
function ignoreHygieneResultsForClasses(
  filePath: string,
  ignores: IgnoreRecord[],
  requireIgnoreReason: boolean,
  reportUnusedIgnores: boolean,
): LintResult[] {
  const results: LintResult[] = [];
  const usedByCommentLine = new Map<number, boolean>();

  for (const ignore of ignores) {
    const violatingClasses = ignore.suppressedClasses.filter(
      ({ className }) => checkClass(className) !== null,
    );

    if (requireIgnoreReason && ignore.kind !== 'file' && ignore.reasonText === null) {
      for (const { className, line } of violatingClasses) {
        results.push({ filePath, line, className, reason: SUPPRESSED_WITHOUT_REASON_REASON });
      }
    }

    if (reportUnusedIgnores) {
      usedByCommentLine.set(
        ignore.line,
        (usedByCommentLine.get(ignore.line) ?? false) || violatingClasses.length > 0,
      );
    }
  }

  if (reportUnusedIgnores) {
    for (const [line, used] of usedByCommentLine) {
      if (!used) {
        results.push({
          filePath,
          line,
          className: UNUSED_IGNORE_CLASS_NAME,
          reason: UNUSED_IGNORE_REASON,
        });
      }
    }
  }

  return results;
}

/**
 * CSS/SCSS analog of `ignoreHygieneResultsForClasses`, from #131's
 * `CssIgnoreRecord[]` metadata (`extractCssDeclarationsWithMeta`). Mirrors
 * the same per-comment-line grouping for `reportUnusedIgnores`.
 */
function ignoreHygieneResultsForCss(
  filePath: string,
  ignores: CssIgnoreRecord[],
  cssConfig: CompiledCssConfig,
  requireIgnoreReason: boolean,
  reportUnusedIgnores: boolean,
): LintResult[] {
  const results: LintResult[] = [];
  const usedByCommentLine = new Map<number, boolean>();

  for (const ignore of ignores) {
    const violating: { decl: CssDeclaration; violation: CssViolation }[] = [];
    for (const decl of ignore.suppressedDeclarations) {
      const violation = checkDeclaration(decl, cssConfig);
      if (violation) violating.push({ decl, violation });
    }

    if (requireIgnoreReason && ignore.kind !== 'file' && ignore.reasonText === null) {
      for (const { decl, violation } of violating) {
        results.push({
          filePath,
          line: decl.line,
          className: violation.className,
          reason: SUPPRESSED_WITHOUT_REASON_REASON,
        });
      }
    }

    if (reportUnusedIgnores) {
      usedByCommentLine.set(
        ignore.line,
        (usedByCommentLine.get(ignore.line) ?? false) || violating.length > 0,
      );
    }
  }

  if (reportUnusedIgnores) {
    for (const [line, used] of usedByCommentLine) {
      if (!used) {
        results.push({
          filePath,
          line,
          className: UNUSED_IGNORE_CLASS_NAME,
          reason: UNUSED_IGNORE_REASON,
        });
      }
    }
  }

  return results;
}
