/**
 * Shared test helpers (issue #133) for the CLI/config test suites.
 *
 * Replaces two recurring patterns that had drifted into ad-hoc duplication:
 *  - `mkdtempSync`/`rmSync` boilerplate repeated in nearly every describe
 *    block of cli.test.ts.
 *  - `dtl-test-...-${Date.now()}` directory names in config.test.ts, which
 *    can collide within the same millisecond and — since several of those
 *    blocks only ever `unlink`ed the config file, never `rm`ed the directory
 *    itself — leaked an empty scratch directory into the OS tmpdir on every
 *    run.
 *
 * Both helpers below use `mkdtemp` (collision-safe by construction) and
 * always remove the full directory recursively, including on failure.
 */

import { beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CapturedIO {
  stdout: string[];
  stderr: string[];
}

/**
 * Build an in-memory stdout/stderr sink, plus the `write` callbacks
 * `runMain`'s `MainOptions` expects.
 */
export function makeIO(): CapturedIO & {
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

/**
 * Create a fresh mkdtemp-based scratch directory, run `fn` against it, and
 * recursively remove it afterward — even if `fn` throws/rejects. Use inside
 * a single test body when the directory doesn't need to be shared with
 * sibling `it`s in the same describe block (the common config.test.ts shape:
 * one temp project per test).
 */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T> | T,
  prefix = 'dtl-test-',
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Register a beforeEach/afterEach pair (vitest suite lifecycle) that creates
 * a fresh scratch directory before every test in the enclosing describe
 * block and removes it afterward — for the common cli.test.ts shape where
 * several `it`s in the same describe share one directory, often alongside
 * extra fixture setup in a sibling `beforeEach` (which runs after this one,
 * since vitest runs same-level hooks in registration order).
 *
 * Must be called synchronously inside a `describe()` body, exactly like
 * calling `beforeEach`/`afterEach` directly. `onCreate` receives the new
 * directory path each time so the caller can assign it to a local variable.
 */
export function useTempDir(prefix: string, onCreate: (dir: string) => void): void {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), prefix));
    onCreate(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
}
