import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseArgs,
  readPackageVersion,
  helpText,
  runMain,
  isMainModule,
  formatGithubAnnotation,
} from './cli.js';
import { setConfig } from './rules.js';
import { compileConfig, DEFAULT_CONFIG } from './config.js';

interface CapturedIO {
  stdout: string[];
  stderr: string[];
}

function makeIO(): CapturedIO & {
  write: { stdout: (m: string) => void; stderr: (m: string) => void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    write: {
      stdout: (m: string) => stdout.push(m),
      stderr: (m: string) => stderr.push(m),
    },
  };
}

afterEach(() => {
  setConfig(compileConfig(DEFAULT_CONFIG));
});

describe('parseArgs', () => {
  it('returns help when -h is passed', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('returns help when --help is passed', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('returns help when --help appears among other args', () => {
    expect(parseArgs(['src/**/*.tsx', '--help'])).toEqual({ kind: 'help' });
  });

  it('returns version when -V is passed', () => {
    expect(parseArgs(['-V'])).toEqual({ kind: 'version' });
  });

  it('returns version when --version is passed', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('returns run with patterns when no flags are present', () => {
    expect(parseArgs(['src/**/*.tsx', 'lib/**/*.ts'])).toEqual({
      kind: 'run',
      patterns: ['src/**/*.tsx', 'lib/**/*.ts'],
      json: false,
    });
  });

  it('returns run with empty patterns when no args', () => {
    expect(parseArgs([])).toEqual({ kind: 'run', patterns: [], json: false });
  });

  it('prefers help over version when both are set', () => {
    expect(parseArgs(['--version', '--help'])).toEqual({ kind: 'help' });
  });

  it('rejects an unrecognized short option', () => {
    expect(parseArgs(['-x'])).toEqual({ kind: 'error', message: 'Unknown option: -x' });
  });

  it('rejects an unrecognized long option', () => {
    expect(parseArgs(['--bogus'])).toEqual({ kind: 'error', message: 'Unknown option: --bogus' });
  });

  it('rejects an unrecognized option even when mixed with valid glob patterns', () => {
    expect(parseArgs(['src/**/*.tsx', '--nope'])).toEqual({
      kind: 'error',
      message: 'Unknown option: --nope',
    });
  });

  it('leaves bare glob patterns unaffected (none start with "-")', () => {
    expect(parseArgs(['src/**/*.tsx', '!src/generated/**'])).toEqual({
      kind: 'run',
      patterns: ['src/**/*.tsx', '!src/generated/**'],
      json: false,
    });
  });

  it('returns run with json: true when --json is passed', () => {
    expect(parseArgs(['--json', 'src/**/*.tsx'])).toEqual({
      kind: 'run',
      patterns: ['src/**/*.tsx'],
      json: true,
    });
  });

  it('returns run with format: "github" when --format github is passed', () => {
    expect(parseArgs(['--format', 'github', 'src/**/*.tsx'])).toEqual({
      kind: 'run',
      patterns: ['src/**/*.tsx'],
      json: false,
      format: 'github',
    });
  });

  it('returns run with format: "human" when --format human is passed explicitly', () => {
    expect(parseArgs(['--format', 'human'])).toEqual({
      kind: 'run',
      patterns: [],
      json: false,
      format: 'human',
    });
  });

  it('leaves format undefined when --format is not passed', () => {
    const parsed = parseArgs(['src/**/*.tsx']);
    expect(parsed.kind).toBe('run');
    expect(parsed.kind === 'run' && parsed.format).toBeUndefined();
  });

  it("does not treat --format's value as a glob pattern", () => {
    expect(parseArgs(['--format', 'github'])).toEqual({
      kind: 'run',
      patterns: [],
      json: false,
      format: 'github',
    });
  });

  it('supports --json and --format together', () => {
    expect(parseArgs(['--json', '--format', 'github', 'src/**/*.tsx'])).toEqual({
      kind: 'run',
      patterns: ['src/**/*.tsx'],
      json: true,
      format: 'github',
    });
  });

  it('rejects --format with no value', () => {
    expect(parseArgs(['--format'])).toEqual({
      kind: 'error',
      message: '--format requires a value: human or github',
    });
  });

  it('rejects --format with an invalid value', () => {
    expect(parseArgs(['--format', 'xml'])).toEqual({
      kind: 'error',
      message: '--format requires a value: human or github',
    });
  });

  it('rejects --format followed by another flag as its value', () => {
    expect(parseArgs(['--format', '--json'])).toEqual({
      kind: 'error',
      message: '--format requires a value: human or github',
    });
  });
});

describe('readPackageVersion', () => {
  it('returns a non-empty semver-shaped string', () => {
    const v = readPackageVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('helpText', () => {
  it('mentions usage, both flags, the config file, and the env var', () => {
    const text = helpText();
    expect(text).toContain('Usage: design-token-lint');
    expect(text).toContain('-h, --help');
    expect(text).toContain('-V, --version');
    expect(text).toContain('.design-token-lint.json');
    expect(text).toContain('TOKEN_LINT_ALLOW_EMPTY');
  });

  it('mentions --json, --format, and the GITHUB_ACTIONS env var', () => {
    const text = helpText();
    expect(text).toContain('--json');
    expect(text).toContain('--format');
    expect(text).toContain('github');
    expect(text).toContain('GITHUB_ACTIONS');
  });
});

describe('isMainModule', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-ismain-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when argv1 is a symlink pointing to the real module file', () => {
    const realFile = join(tmpDir, 'cli.js');
    const symlinkFile = join(tmpDir, 'cli-symlink.js');
    writeFileSync(realFile, '');
    symlinkSync(realFile, symlinkFile);
    // argv1 is the symlink; moduleUrl resolves to the real file
    expect(isMainModule(symlinkFile, pathToFileURL(realFile).href)).toBe(true);
  });

  it('returns true when argv1 and moduleUrl are the same real file (no symlink)', () => {
    const realFile = join(tmpDir, 'cli.js');
    writeFileSync(realFile, '');
    expect(isMainModule(realFile, pathToFileURL(realFile).href)).toBe(true);
  });

  it('returns false when argv1 points to an unrelated file', () => {
    const realFile = join(tmpDir, 'cli.js');
    const otherFile = join(tmpDir, 'other.js');
    writeFileSync(realFile, '');
    writeFileSync(otherFile, '');
    expect(isMainModule(otherFile, pathToFileURL(realFile).href)).toBe(false);
  });

  it('returns false when argv1 is undefined', () => {
    const realFile = join(tmpDir, 'cli.js');
    writeFileSync(realFile, '');
    expect(isMainModule(undefined, pathToFileURL(realFile).href)).toBe(false);
  });

  it('returns false when argv1 cannot be resolved (non-existent path) and does not throw', () => {
    const realFile = join(tmpDir, 'cli.js');
    writeFileSync(realFile, '');
    // argv1 path does not exist → realpathSync fails → falls back to raw string comparison
    const nonExistent = join(tmpDir, 'does-not-exist.js');
    expect(isMainModule(nonExistent, pathToFileURL(realFile).href)).toBe(false);
  });
});

describe('runMain — flag handling', () => {
  it('--help exits 0 and prints help text to stdout', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['--help'],
      env: {},
      cwd: process.cwd(),
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
    expect(io.stdout.join('\n')).toContain('Usage: design-token-lint');
    expect(io.stderr).toEqual([]);
  });

  it('-h behaves the same as --help', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['-h'],
      env: {},
      cwd: process.cwd(),
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
    expect(io.stdout.join('\n')).toContain('Usage: design-token-lint');
  });

  it('--version exits 0 and prints version from package.json to stdout', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['--version'],
      env: {},
      cwd: process.cwd(),
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
    expect(io.stdout).toEqual([readPackageVersion()]);
    expect(io.stderr).toEqual([]);
  });

  it('-V behaves the same as --version', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['-V'],
      env: {},
      cwd: process.cwd(),
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
    expect(io.stdout).toEqual([readPackageVersion()]);
  });
});

describe('runMain — unknown option handling', () => {
  it('exits 2 and names the option on an unrecognized short flag', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['-x'],
      env: {},
      cwd: process.cwd(),
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
    const err = io.stderr.join('\n');
    expect(err).toContain('Unknown option: -x');
    expect(err).toContain('Run with --help for usage');
    expect(io.stdout).toEqual([]);
  });

  it('exits 2 and names the option on an unrecognized long flag', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['--bogus'],
      env: {},
      cwd: process.cwd(),
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
    expect(io.stderr.join('\n')).toContain('Unknown option: --bogus');
  });
});

describe('runMain — config error handling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-config-err-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 2 and names the file when the config JSON is malformed', async () => {
    writeFileSync(join(tmpDir, '.design-token-lint.json'), '{ not valid json');
    const io = makeIO();
    const code = await runMain({
      args: [],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
    const err = io.stderr.join('\n');
    expect(err).toContain('Failed to parse .design-token-lint.json');
    expect(io.stdout).toEqual([]);
  });

  it('exits 2 and names the field when a config field has the wrong type', async () => {
    writeFileSync(join(tmpDir, '.design-token-lint.json'), JSON.stringify({ prohibited: 'p-{n}' }));
    const io = makeIO();
    const code = await runMain({
      args: [],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
    expect(io.stderr.join('\n')).toContain('"prohibited" must be an array of strings');
  });

  it('exits 2 with a clear message when a prohibited pattern is malformed', async () => {
    writeFileSync(
      join(tmpDir, '.design-token-lint.json'),
      JSON.stringify({ prohibited: ['{n}'], allowed: [], ignore: [] }),
    );
    const io = makeIO();
    const code = await runMain({
      args: [],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
    expect(io.stderr.join('\n')).toContain('placeholder');
  });
});

describe('runMain — empty match handling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-test-'));
    // Create an empty src/ directory so the pattern is valid but matches nothing.
    mkdirSync(join(tmpDir, 'src'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 2 when no files match (default)', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['nonexistent/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
    const err = io.stderr.join('\n');
    expect(err).toContain('No files matched any of the configured patterns');
    expect(err).toContain('nonexistent/**/*.tsx');
    expect(err).toContain('TOKEN_LINT_ALLOW_EMPTY');
  });

  it('exits 0 when no files match and TOKEN_LINT_ALLOW_EMPTY=1', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['nonexistent/**/*.tsx'],
      env: { TOKEN_LINT_ALLOW_EMPTY: '1' },
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
    const err = io.stderr.join('\n');
    // Warning should still be printed for visibility.
    expect(err).toContain('No files matched any of the configured patterns');
  });

  it('treats empty TOKEN_LINT_ALLOW_EMPTY as unset (still exits 2)', async () => {
    const io = makeIO();
    const code = await runMain({
      args: ['nonexistent/**/*.tsx'],
      env: { TOKEN_LINT_ALLOW_EMPTY: '' },
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(2);
  });

  it.each(['0', 'false', 'no', 'off', '  '])(
    'treats TOKEN_LINT_ALLOW_EMPTY=%j as falsy (still exits 2)',
    async (value) => {
      const io = makeIO();
      const code = await runMain({
        args: ['nonexistent/**/*.tsx'],
        env: { TOKEN_LINT_ALLOW_EMPTY: value },
        cwd: tmpDir,
        stdout: io.write.stdout,
        stderr: io.write.stderr,
      });
      expect(code).toBe(2);
    },
  );

  it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])(
    'treats TOKEN_LINT_ALLOW_EMPTY=%j as truthy (exits 0)',
    async (value) => {
      const io = makeIO();
      const code = await runMain({
        args: ['nonexistent/**/*.tsx'],
        env: { TOKEN_LINT_ALLOW_EMPTY: value },
        cwd: tmpDir,
        stdout: io.write.stdout,
        stderr: io.write.stderr,
      });
      expect(code).toBe(0);
    },
  );
});

describe('runMain — pattern precedence (args > config.patterns > defaults)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-precedence-'));
    // A violation reachable only via DEFAULT_PATTERNS (src/**/*.{tsx,jsx,astro}).
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'from-default.tsx'), `<div className="p-4">`);
    // A violation reachable only via the config file's "patterns" field.
    mkdirSync(join(tmpDir, 'from-config'), { recursive: true });
    writeFileSync(join(tmpDir, 'from-config', 'only.tsx'), `<div className="m-8">`);
    // A violation reachable only via CLI args.
    mkdirSync(join(tmpDir, 'from-args'), { recursive: true });
    writeFileSync(join(tmpDir, 'from-args', 'only.tsx'), `<div className="gap-6">`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('CLI args win over config.patterns', async () => {
    writeFileSync(
      join(tmpDir, '.design-token-lint.json'),
      JSON.stringify({ patterns: ['from-config/**/*.tsx'] }),
    );
    const io = makeIO();
    const code = await runMain({
      args: ['--json', 'from-args/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    const results = JSON.parse(io.stdout[0]);
    const classNames = results.map((r: { className: string }) => r.className);
    expect(classNames).toEqual(['gap-6']);
  });

  it('config.patterns wins over defaults when no CLI args are given', async () => {
    writeFileSync(
      join(tmpDir, '.design-token-lint.json'),
      JSON.stringify({ patterns: ['from-config/**/*.tsx'] }),
    );
    const io = makeIO();
    const code = await runMain({
      args: ['--json'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    const results = JSON.parse(io.stdout[0]);
    const classNames = results.map((r: { className: string }) => r.className);
    expect(classNames).toEqual(['m-8']);
  });

  it('falls back to DEFAULT_PATTERNS when neither CLI args nor config.patterns are given', async () => {
    // No config file at all — loadConfig falls through to DEFAULT_CONFIG,
    // whose `patterns` field is undefined, so runMain uses DEFAULT_PATTERNS.
    const io = makeIO();
    const code = await runMain({
      args: ['--json'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    const results = JSON.parse(io.stdout[0]);
    const classNames = results.map((r: { className: string }) => r.className);
    expect(classNames).toEqual(['p-4']);
  });
});

describe('runMain — happy path still works', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-test-'));
    mkdirSync(join(tmpDir, 'src'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when files match and have no violations', async () => {
    writeFileSync(join(tmpDir, 'src', 'clean.tsx'), `<div className="flex">`);
    const io = makeIO();
    const code = await runMain({
      args: ['src/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
  });

  it('returns 1 when violations are found', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['src/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
  });
});

describe('runMain — --json output', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-json-'));
    mkdirSync(join(tmpDir, 'src'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints a JSON array of flat LintResult objects on stdout and keeps exit code 1', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['--json', 'src/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    expect(io.stdout).toHaveLength(1);
    const parsed = JSON.parse(io.stdout[0]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const result of parsed) {
      expect(Object.keys(result).sort()).toEqual(
        ['className', 'filePath', 'line', 'reason'].sort(),
      );
    }
    expect(parsed[0].filePath).toContain('dirty.tsx');
    expect(parsed[0].className).toBe('p-4');
    // Human-readable output still goes to stderr, unaffected.
    expect(io.stderr.join('\n')).toContain('dirty.tsx');
    expect(io.stderr.join('\n')).toContain('Found 1 violation(s)');
  });

  it('prints an empty JSON array on stdout and exits 0 when there are no violations', async () => {
    writeFileSync(join(tmpDir, 'src', 'clean.tsx'), `<div className="flex">`);
    const io = makeIO();
    const code = await runMain({
      args: ['--json', 'src/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(0);
    expect(io.stdout).toEqual(['[]']);
  });
});

describe('runMain — --format github output', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-github-'));
    mkdirSync(join(tmpDir, 'src'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints one ::error workflow command per violation on stdout', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['--format', 'github', 'src/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    expect(io.stdout).toHaveLength(1);
    expect(io.stdout[0]).toMatch(/^::error file=.*dirty\.tsx,line=\d+::p-4 — .+$/);
  });

  it('auto-selects github format when GITHUB_ACTIONS env var is truthy', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['src/**/*.tsx'],
      env: { GITHUB_ACTIONS: 'true' },
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    expect(io.stdout).toHaveLength(1);
    expect(io.stdout[0]).toMatch(/^::error /);
  });

  it('an explicit --format human wins over GITHUB_ACTIONS=true', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['--format', 'human', 'src/**/*.tsx'],
      env: { GITHUB_ACTIONS: 'true' },
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    expect(io.stdout).toEqual([]);
    expect(io.stderr.join('\n')).toContain('dirty.tsx');
  });

  it('does not auto-select github format when GITHUB_ACTIONS is falsy', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['src/**/*.tsx'],
      env: { GITHUB_ACTIONS: 'false' },
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    expect(io.stdout).toEqual([]);
  });
});

describe('formatGithubAnnotation — workflow command escaping', () => {
  it('formats a plain violation as an ::error command', () => {
    expect(
      formatGithubAnnotation({
        filePath: 'src/app.tsx',
        line: 3,
        className: 'p-4',
        reason: 'Numeric spacing',
      }),
    ).toBe('::error file=src/app.tsx,line=3::p-4 — Numeric spacing');
  });

  it('escapes commas and colons in the file property so they are not parsed as delimiters', () => {
    const annotation = formatGithubAnnotation({
      filePath: 'src/foo,bar:baz.tsx',
      line: 1,
      className: 'p-4',
      reason: 'Numeric spacing',
    });
    expect(annotation).toContain('file=src/foo%2Cbar%3Abaz.tsx,line=1');
  });

  it('escapes %, CR, and LF in the message data', () => {
    const annotation = formatGithubAnnotation({
      filePath: 'src/app.tsx',
      line: 1,
      className: 'w-[50%]',
      reason: 'multi\nline\r reason',
    });
    expect(annotation).toBe('::error file=src/app.tsx,line=1::w-[50%25] — multi%0Aline%0D reason');
  });
});

describe('runMain — human mode is unchanged by the new flags', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'design-token-lint-human-'));
    mkdirSync(join(tmpDir, 'src'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces identical stderr output and empty stdout without --json/--format', async () => {
    writeFileSync(join(tmpDir, 'src', 'dirty.tsx'), `<div className="p-4">`);
    const io = makeIO();
    const code = await runMain({
      args: ['src/**/*.tsx'],
      env: {},
      cwd: tmpDir,
      stdout: io.write.stdout,
      stderr: io.write.stderr,
    });
    expect(code).toBe(1);
    expect(io.stdout).toEqual([]);
    const err = io.stderr.join('\n');
    expect(err).toContain('dirty.tsx');
    expect(err).toContain('p-4');
    expect(err).toContain('Found 1 violation(s) in 1 file(s).');
  });
});
