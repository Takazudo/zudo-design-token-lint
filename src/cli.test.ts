import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, readPackageVersion, helpText, runMain, isMainModule } from './cli.js';
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
    });
  });

  it('returns run with empty patterns when no args', () => {
    expect(parseArgs([])).toEqual({ kind: 'run', patterns: [] });
  });

  it('prefers help over version when both are set', () => {
    expect(parseArgs(['--version', '--help'])).toEqual({ kind: 'help' });
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
