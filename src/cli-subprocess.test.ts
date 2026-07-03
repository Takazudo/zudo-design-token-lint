/**
 * Subprocess CLI tests: spawn the COMPILED `dist/cli.js` as a real child
 * process via node:child_process execFile, rather than calling `runMain`
 * in-process (as cli.test.ts does). This exercises the actual entry point —
 * argv parsing off process.argv, the shebang, process.exit(code), and the
 * isMainModule() detection — none of which the in-process tests touch.
 *
 * Determinism: `pnpm test` runs the root `pretest` script (`pnpm run build`)
 * first, so `dist/cli.js` is always fresh — `rm -rf dist && pnpm test` must
 * pass from a clean checkout. These tests still guard against a missing
 * dist/ (e.g. `vitest run` invoked directly, bypassing pretest) with a clear
 * failure message rather than a confusing ENOENT from execFile.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from './cli.js';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const distCli = join(packageRoot, 'dist', 'cli.js');
const sampleProjectDir = join(packageRoot, 'test', 'fixtures', 'sample-project');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `node dist/cli.js <args>` and normalize the { code, stdout, stderr }
 * shape regardless of whether the process exits cleanly (execFile resolves)
 * or via a nonzero exit code (execFile rejects with stdout/stderr attached).
 */
async function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<CliResult> {
  // GITHUB_ACTIONS flips the CLI's output format to github annotations
  // (auto-detect); scrub it so these assertions are environment-independent.
  const { GITHUB_ACTIONS: _ignored, ...cleanEnv } = process.env;
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [distCli, ...args], {
      cwd,
      env: env ?? cleanEnv,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeAll(async () => {
  try {
    await access(distCli);
  } catch {
    throw new Error(
      `dist/cli.js not found at ${distCli}. Run "pnpm build" first ` +
        '(this is normally guaranteed by the root "pretest" script).',
    );
  }
});

describe('CLI subprocess — node dist/cli.js', () => {
  it('--version exits 0 and prints the package.json version on stdout', async () => {
    const result = await runCli(['--version'], packageRoot);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(readPackageVersion());
  });

  it('--help exits 0 and prints usage text', async () => {
    const result = await runCli(['--help'], packageRoot);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: design-token-lint');
  });

  it('exits 1 and reports violation text for a fixture directory with violations', async () => {
    const result = await runCli([], sampleProjectDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('violations.jsx');
    expect(result.stderr).toContain('p-4');
    expect(result.stderr).toMatch(/Found \d+ violation\(s\) in \d+ file\(s\)\./);
  });

  it('auto-selects github format when GITHUB_ACTIONS is truthy in the environment', async () => {
    const result = await runCli([], sampleProjectDir, {
      ...process.env,
      GITHUB_ACTIONS: 'true',
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^::error file=.*violations\.jsx,line=\d+::/m);
  });

  describe('with a scratch temp directory', () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'design-token-lint-subprocess-'));
    });

    afterAll(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('exits 2 for an empty directory (no files match)', async () => {
      const emptyDir = join(tmpDir, 'empty');
      await mkdir(emptyDir, { recursive: true });
      const result = await runCli(['src/**/*.tsx'], emptyDir);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('No files matched any of the configured patterns');
    });

    it('exits 2 for a malformed config file (post-A2)', async () => {
      const badConfigDir = join(tmpDir, 'bad-config');
      await mkdir(join(badConfigDir, 'src'), { recursive: true });
      await writeFile(join(badConfigDir, '.design-token-lint.json'), '{ not valid json');
      await writeFile(join(badConfigDir, 'src', 'app.tsx'), '<div className="flex" />');
      const result = await runCli([], badConfigDir);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Failed to parse .design-token-lint.json');
    });
  });
});
