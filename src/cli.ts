#!/usr/bin/env node

/**
 * CLI for design-token-lint.
 *
 * Usage: design-token-lint [options] [glob patterns...]
 *
 * Default patterns scan src/, components/, lib/, and app/ for .tsx, .jsx, .astro files.
 * Loads config from .design-token-lint.json in the current directory (falls back to defaults).
 * Patterns can also be configured via the "patterns" field in the config file.
 */

import { glob } from 'glob';
import chalk from 'chalk';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';
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

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; patterns: string[] };

/**
 * Parse CLI argv (process.argv.slice(2)).
 *
 * Recognizes -h/--help and -V/--version as flags. Any other args are treated
 * as glob patterns. Flags take precedence; if both --help and --version are
 * present, --help wins (it appears earlier in conventional CLIs).
 */
export function parseArgs(args: string[]): ParsedArgs {
  if (args.includes('-h') || args.includes('--help')) {
    return { kind: 'help' };
  }
  if (args.includes('-V') || args.includes('--version')) {
    return { kind: 'version' };
  }
  return { kind: 'run', patterns: args };
}

/**
 * Read this package's version from its package.json.
 *
 * Resolves package.json relative to this file's location. Works for both the
 * compiled `dist/cli.js` (one level up from dist/) and for tests that import
 * from `src/` (also one level up from src/).
 */
export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * Treat env vars as truthy only for the conventional boolean-true spellings.
 * Accepts: "1", "true", "yes", "on" (case-insensitive). Everything else,
 * including "0", "false", "no", "off", and the empty string, is falsy. This
 * avoids the surprise that any non-empty string (e.g. "0") would otherwise
 * count as truthy.
 */
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function helpText(): string {
  return [
    'Usage: design-token-lint [options] [glob patterns...]',
    '',
    'Lint Tailwind class names against design system tokens.',
    'Reports raw numeric utilities and default colors that should be replaced',
    'with semantic design tokens.',
    '',
    'Options:',
    '  -h, --help     Show this help message and exit',
    '  -V, --version  Print the package version and exit',
    '',
    'Patterns:',
    '  When no patterns are passed, the linter reads `patterns` from',
    '  .design-token-lint.json in the current directory, or falls back to:',
    ...DEFAULT_PATTERNS.map((p) => `    ${p}`),
    '',
    'Environment:',
    '  TOKEN_LINT_ALLOW_EMPTY  When set to 1/true/yes/on (case-insensitive),',
    '                          exit 0 (instead of 2) when no files match.',
    '                          Useful as a first-run / bootstrap escape hatch.',
  ].join('\n');
}

export interface MainOptions {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

/**
 * Run the CLI and return the desired exit code.
 *
 * Factored out from the entry point so it can be unit-tested without
 * spawning a child process.
 */
export async function runMain(opts: MainOptions): Promise<number> {
  const { args, env, cwd, stdout, stderr } = opts;

  const parsed = parseArgs(args);
  if (parsed.kind === 'help') {
    stdout(helpText());
    return 0;
  }
  if (parsed.kind === 'version') {
    stdout(readPackageVersion());
    return 0;
  }

  // Load and apply config
  const config = await loadConfig(cwd);
  const compiled = compileConfig(config);
  setConfig(compiled);

  // Resolve patterns: CLI args > config file > defaults
  const patterns =
    parsed.patterns.length > 0 ? parsed.patterns : (config.patterns ?? DEFAULT_PATTERNS);

  // Merge ignore patterns: CLI defaults + config ignore patterns
  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...compiled.ignore];

  // Resolve files
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matched = await glob(pattern, { ignore: ignorePatterns, cwd });
    for (const f of matched) {
      files.add(f);
    }
  }

  const sortedFiles = [...files].sort();
  if (sortedFiles.length === 0) {
    const allowEmpty = isTruthyEnv(env.TOKEN_LINT_ALLOW_EMPTY);
    const lines = [
      'No files matched any of the configured patterns:',
      ...patterns.map((p) => `  - ${p}`),
      'This usually means the `patterns` config is wrong or no source files exist yet.',
      'Set TOKEN_LINT_ALLOW_EMPTY=1 to suppress this error (e.g. for first-run/bootstrap).',
    ];
    stderr(chalk.yellow(lines.join('\n')));
    return allowEmpty ? 0 : 2;
  }

  stderr(chalk.dim(`Scanning ${sortedFiles.length} file(s)...\n`));

  const allResults: LintResult[] = [];
  for (const filePath of sortedFiles) {
    // glob returns paths relative to `cwd`; resolve against `cwd` so reads
    // work even when `cwd` differs from process.cwd() (e.g. in tests).
    const readPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
    const results = await lintFile(readPath);
    // Keep the displayed path relative for normal CLI output.
    for (const r of results) {
      allResults.push({ ...r, filePath });
    }
  }

  if (allResults.length === 0) {
    stderr(chalk.green('No design token violations found.'));
    return 0;
  }

  // Group by file
  const byFile = new Map<string, LintResult[]>();
  for (const r of allResults) {
    const existing = byFile.get(r.filePath) ?? [];
    existing.push(r);
    byFile.set(r.filePath, existing);
  }

  for (const [filePath, results] of byFile) {
    stderr(chalk.underline(filePath));
    for (const r of results) {
      stderr(`  ${chalk.dim(`L${r.line}`)}: ${chalk.red(r.className)} — ${chalk.yellow(r.reason)}`);
    }
    stderr('');
  }

  const fileCount = byFile.size;
  stderr(chalk.red(`Found ${allResults.length} violation(s) in ${fileCount} file(s).`));
  return 1;
}

/**
 * Determine whether this module is the entry point (i.e. run directly vs
 * imported by tests or other modules).
 *
 * Under pnpm (and other package managers that use a `.bin` shim), `argv1` is
 * the SYMLINK path while `moduleUrl` resolves to the REALPATH of the compiled
 * file. A plain string comparison therefore always returns false, making the
 * CLI a silent no-op. Comparing realpaths of both sides fixes this.
 *
 * Each side is resolved independently: if either realpath call fails (e.g. the
 * path is relative or extensionless) we fall back to the raw string so the
 * comparison still returns a sensible result instead of throwing.
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  let resolvedArgv1: string;
  try {
    resolvedArgv1 = realpathSync(argv1);
  } catch {
    resolvedArgv1 = argv1;
  }
  let resolvedModule: string;
  try {
    resolvedModule = realpathSync(fileURLToPath(moduleUrl));
  } catch {
    try {
      resolvedModule = fileURLToPath(moduleUrl);
    } catch {
      return false;
    }
  }
  return resolvedArgv1 === resolvedModule;
}

// Detect if this module is being run directly (vs imported by tests).
const isMain = isMainModule(process.argv[1], import.meta.url);

if (isMain) {
  runMain({
    args: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    stdout: (msg) => console.log(msg),
    stderr: (msg) => console.error(msg),
  })
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(chalk.red('Error:'), err);
      process.exit(2);
    });
}
