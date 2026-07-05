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
import { loadConfig, compileConfig, type LintConfig, type CompiledConfig } from './config.js';
import { setConfig } from './rules.js';
import { lintFile, type LintResult } from './linter.js';

const DEFAULT_PATTERNS = [
  'src/**/*.{tsx,jsx,astro}',
  'components/**/*.{tsx,jsx,astro}',
  'lib/**/*.{tsx,jsx}',
  'app/**/*.{tsx,jsx}',
];

const DEFAULT_IGNORE_PATTERNS = ['**/node_modules/**', '**/dist/**'];

/**
 * Output format for reported violations.
 *
 * "human" is the default colorized, grouped-by-file display. "github" emits
 * one GitHub Actions `::error` workflow command per violation instead, so
 * CI runs surface inline annotations on the offending lines.
 */
export type OutputFormat = 'human' | 'github';

const VALID_OUTPUT_FORMATS: OutputFormat[] = ['human', 'github'];

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; patterns: string[]; json: boolean; format?: OutputFormat }
  | { kind: 'error'; message: string };

const KNOWN_FLAGS = new Set(['-h', '--help', '-V', '--version', '--json', '--format']);

/**
 * Parse CLI argv (process.argv.slice(2)).
 *
 * Recognizes -h/--help and -V/--version as flags. Any other arg starting
 * with "-" is treated as an unrecognized option (kind: 'error') rather than
 * a glob pattern — bare glob patterns (which never start with "-") are
 * unaffected. Flags take precedence; if both --help and --version are
 * present, --help wins (it appears earlier in conventional CLIs).
 *
 * --json is a standalone boolean flag. --format takes a required value
 * (human|github) either as the following arg or via the "--format=value"
 * equals form; a missing or invalid value is reported as an error rather
 * than silently falling through to being treated as a glob pattern.
 * `format` is left `undefined` when the flag isn't passed so the caller can
 * distinguish "not specified" (and fall back to env-based auto-detection)
 * from an explicit choice.
 *
 * A bare "--" is the conventional end-of-flags terminator: everything after
 * the first "--" is treated as a literal glob pattern, even if it looks like
 * a flag (e.g. `design-token-lint -- --weird-dirname/**`). The "--" itself
 * is consumed, not pushed as a pattern. Only the first "--" acts as the
 * terminator; a "--" appearing again after it is just a literal pattern.
 */
export function parseArgs(args: string[]): ParsedArgs {
  const terminatorIndex = args.indexOf('--');
  const flagArgs = terminatorIndex === -1 ? args : args.slice(0, terminatorIndex);
  const literalArgs = terminatorIndex === -1 ? [] : args.slice(terminatorIndex + 1);

  if (flagArgs.includes('-h') || flagArgs.includes('--help')) {
    return { kind: 'help' };
  }
  if (flagArgs.includes('-V') || flagArgs.includes('--version')) {
    return { kind: 'version' };
  }

  let json = false;
  let format: OutputFormat | undefined;
  const patterns: string[] = [];

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--format' || arg.startsWith('--format=')) {
      const value = arg === '--format' ? flagArgs[i + 1] : arg.slice('--format='.length);
      if (value === undefined || !VALID_OUTPUT_FORMATS.includes(value as OutputFormat)) {
        return {
          kind: 'error',
          message: `--format requires a value: ${VALID_OUTPUT_FORMATS.join(' or ')}`,
        };
      }
      format = value as OutputFormat;
      if (arg === '--format') i++; // consume the value so it isn't also treated as a glob pattern
      continue;
    }
    if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) {
      return { kind: 'error', message: `Unknown option: ${arg}` };
    }
    patterns.push(arg);
  }

  patterns.push(...literalArgs);

  return { kind: 'run', patterns, json, format };
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
    '  -h, --help         Show this help message and exit',
    '  -V, --version      Print the package version and exit',
    '      --json         Print results as a JSON array on stdout',
    '                     (human-readable output still goes to stderr)',
    '      --format <fmt> Output format for violations: human (default) or github',
    '                     github prints "::error" GitHub Actions workflow commands',
    '                     on stdout instead of the human display',
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
    '  GITHUB_ACTIONS          Set automatically by GitHub Actions; when truthy,',
    '                          auto-selects --format github unless --format is',
    '                          passed explicitly (the flag always wins).',
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
 * Group flat lint results by file, preserving first-seen file order.
 */
function groupByFile(results: LintResult[]): Map<string, LintResult[]> {
  const byFile = new Map<string, LintResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.filePath) ?? [];
    existing.push(r);
    byFile.set(r.filePath, existing);
  }
  return byFile;
}

/**
 * Print the default colorized, grouped-by-file human display (unchanged
 * from the pre-`--json`/`--format` behavior).
 */
function printHumanResults(stderr: (msg: string) => void, byFile: Map<string, LintResult[]>): void {
  for (const [filePath, results] of byFile) {
    stderr(chalk.underline(filePath));
    for (const r of results) {
      stderr(`  ${chalk.dim(`L${r.line}`)}: ${chalk.red(r.className)} — ${chalk.yellow(r.reason)}`);
    }
    stderr('');
  }
}

/**
 * Escape message data for a GitHub Actions workflow command. GitHub's
 * runner decodes %25/%0D/%0A, so raw %, CR, and LF must be encoded or the
 * command is truncated at the first newline.
 * See: https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
 */
function escapeGithubData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Escape a workflow command property value. Properties additionally need
 * : and , encoded — they delimit properties, so an unescaped path like
 * "src/foo,bar.tsx" would be parsed as file=src/foo plus a bogus property.
 */
function escapeGithubProperty(value: string): string {
  return escapeGithubData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * Format a single violation as a GitHub Actions workflow command so it
 * surfaces as an inline annotation on the offending line in a PR/run.
 */
export function formatGithubAnnotation(result: LintResult): string {
  const file = escapeGithubProperty(result.filePath);
  const message = escapeGithubData(`${result.className} — ${result.reason}`);
  return `::error file=${file},line=${result.line}::${message}`;
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
  if (parsed.kind === 'error') {
    stderr(chalk.red(parsed.message));
    stderr(chalk.dim('Run with --help for usage'));
    return 2;
  }

  const json = parsed.json;
  // An explicit --format always wins. Otherwise auto-detect via the env var
  // GitHub Actions itself sets on every run, so CI gets annotations without
  // requiring an extra flag in the workflow file.
  const format: OutputFormat =
    parsed.format ?? (isTruthyEnv(env.GITHUB_ACTIONS) ? 'github' : 'human');

  // Load and apply config. A missing config file falls through to defaults
  // silently (handled inside loadConfig); a config file that exists but is
  // invalid (bad JSON, wrong field type, malformed pattern) throws — caught
  // here so the CLI reports a clean one-line message instead of a raw stack
  // trace via the generic top-level catch in the entry point below.
  let config: LintConfig;
  let compiled: CompiledConfig;
  try {
    config = await loadConfig(cwd);
    compiled = compileConfig(config);
  } catch (err) {
    if (err instanceof Error) {
      stderr(chalk.red(err.message));
      return 2;
    }
    throw err;
  }
  setConfig(compiled);

  // CSS/SCSS globs from the opt-in `css.patterns` section are scanned
  // ALONGSIDE the Tailwind patterns, but only when the user did not pass
  // explicit CLI patterns (mirroring how `config.patterns` is only consulted
  // in that same "no CLI args" case). When the `css` section is absent this is
  // always empty, so pattern resolution is byte-identical to before.
  const usingCliPatterns = parsed.patterns.length > 0;
  const cssPatterns = !usingCliPatterns ? (config.css?.patterns ?? []) : [];

  // Resolve patterns: CLI args > config file > defaults. An explicit
  // `"patterns": []` in the config is a distinct case from an *absent*
  // `patterns` field: `?? DEFAULT_PATTERNS` only falls back on
  // null/undefined, so `[]` would otherwise silently mean "match nothing"
  // and surface as the generic "No files matched" error further down. Catch
  // it here with a message that names the actual cause — unless the `css`
  // section supplied patterns, in which case there is still something to scan.
  if (
    parsed.patterns.length === 0 &&
    config.patterns !== undefined &&
    config.patterns.length === 0 &&
    cssPatterns.length === 0
  ) {
    stderr(
      chalk.red(
        'Config field "patterns" is an empty array, so there is nothing to scan. ' +
          'Remove "patterns" from the config to use the defaults, or list at least one glob pattern.',
      ),
    );
    return 2;
  }
  const basePatterns = usingCliPatterns ? parsed.patterns : (config.patterns ?? DEFAULT_PATTERNS);
  const patterns = [...basePatterns, ...cssPatterns];

  // Merge ignore patterns: CLI defaults + config ignore patterns
  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...compiled.ignore];

  // Resolve files. `nodir: true` is required: without it, a pattern like
  // `src/**` (or a directory that happens to be named e.g. `foo.tsx`) also
  // yields directory paths, which later crash `lintFile`'s `readFile` call
  // with EISDIR.
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matched = await glob(pattern, { ignore: ignorePatterns, cwd, nodir: true });
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
    // A file can still fail to read even after nodir-filtered globbing (e.g.
    // permissions, or it was deleted/replaced between glob and read — a
    // race that is more likely than it sounds on a large watched tree).
    // Report cleanly and stop instead of letting the raw error escape to
    // the top-level catch as a stack dump.
    let results: LintResult[];
    try {
      results = await lintFile(readPath);
    } catch (err) {
      stderr(
        chalk.red(
          `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return 2;
    }
    // Keep the displayed path relative for normal CLI output.
    for (const r of results) {
      allResults.push({ ...r, filePath });
    }
  }

  if (allResults.length === 0) {
    stderr(chalk.green('No design token violations found.'));
    if (json) {
      stdout(JSON.stringify(allResults));
    }
    return 0;
  }

  // --json is the machine-consumption contract: stdout must be exactly the
  // JSON array (so e.g. `... --json | jq` works), so it wins over --format
  // for what goes to stdout. The human display still goes to stderr either
  // way, unaffected.
  if (json) {
    printHumanResults(stderr, groupByFile(allResults));
    stdout(JSON.stringify(allResults));
  } else if (format === 'github') {
    for (const r of allResults) {
      stdout(formatGithubAnnotation(r));
    }
  } else {
    printHumanResults(stderr, groupByFile(allResults));
  }

  const fileCount = new Set(allResults.map((r) => r.filePath)).size;
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
