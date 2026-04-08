#!/usr/bin/env node

/**
 * CLI for design-token-lint.
 *
 * Usage: design-token-lint [glob patterns...]
 *
 * Default patterns scan src/, components/, lib/, and app/ for .tsx, .jsx, .astro files.
 * Loads config from .design-token-lint.json in the current directory (falls back to defaults).
 * Patterns can also be configured via the "patterns" field in the config file.
 */

import { glob } from 'glob';
import chalk from 'chalk';
import { loadConfig, compileConfig } from './config.js';
import { setConfig } from './rules.js';
import { lintFile, type LintResult } from './linter.js';

const DEFAULT_PATTERNS = [
  'src/**/*.{tsx,jsx,astro}',
  'components/**/*.{tsx,jsx,astro}',
  'lib/**/*.{tsx,jsx}',
  'app/**/*.{tsx,jsx}',
];

const DEFAULT_IGNORE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/__inbox/**'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Load and apply config
  const config = await loadConfig(process.cwd());
  const compiled = compileConfig(config);
  setConfig(compiled);

  // Resolve patterns: CLI args > config file > defaults
  const patterns = args.length > 0 ? args : (config.patterns ?? DEFAULT_PATTERNS);

  // Merge ignore patterns: CLI defaults + config ignore patterns
  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...compiled.ignore];

  // Resolve files
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matched = await glob(pattern, { ignore: ignorePatterns });
    for (const f of matched) {
      files.add(f);
    }
  }

  const sortedFiles = [...files].sort();
  if (sortedFiles.length === 0) {
    console.error(chalk.yellow('No files matched the given patterns.'));
    process.exit(0);
  }

  console.error(chalk.dim(`Scanning ${sortedFiles.length} file(s)...\n`));

  const allResults: LintResult[] = [];
  for (const filePath of sortedFiles) {
    const results = await lintFile(filePath);
    allResults.push(...results);
  }

  if (allResults.length === 0) {
    console.error(chalk.green('No design token violations found.'));
    process.exit(0);
  }

  // Group by file
  const byFile = new Map<string, LintResult[]>();
  for (const r of allResults) {
    const existing = byFile.get(r.filePath) ?? [];
    existing.push(r);
    byFile.set(r.filePath, existing);
  }

  for (const [filePath, results] of byFile) {
    console.error(chalk.underline(filePath));
    for (const r of results) {
      console.error(
        `  ${chalk.dim(`L${r.line}`)}: ${chalk.red(r.className)} — ${chalk.yellow(r.reason)}`,
      );
    }
    console.error('');
  }

  const fileCount = byFile.size;
  console.error(chalk.red(`Found ${allResults.length} violation(s) in ${fileCount} file(s).`));
  process.exit(1);
}

main().catch((err) => {
  console.error(chalk.red('Error:'), err);
  process.exit(2);
});
