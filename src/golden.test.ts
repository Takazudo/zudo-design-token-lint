import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMain } from './cli.js';
import { setConfig } from './rules.js';
import { compileConfig, DEFAULT_CONFIG } from './config.js';
import type { LintResult } from './linter.js';

/**
 * Golden-fixture suite (L3): runs the real CLI pipeline (runMain, exactly as
 * the compiled binary does) against a small committed sample project and
 * diffs the full LintResult[] output against a committed expectation. This
 * is a regression net over the combined engine behavior — trailing-`!`
 * modifiers, multiline cn() calls, the new v4/logical color rules, and
 * ignore comments all interacting through one custom config — rather than
 * unit-testing any single piece in isolation.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'test', 'fixtures');
const sampleProjectDir = join(fixturesDir, 'sample-project');
const defaultProjectDir = join(fixturesDir, 'default-project');

afterEach(() => {
  setConfig(compileConfig(DEFAULT_CONFIG));
});

describe('golden fixture — sample-project', () => {
  it('matches the committed expected.json exactly', async () => {
    const expectedRaw = await readFile(join(fixturesDir, 'expected.json'), 'utf-8');
    const expected = JSON.parse(expectedRaw) as LintResult[];

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runMain({
      args: ['--json'],
      env: {},
      cwd: sampleProjectDir,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
    });

    // The fixture project has violations, so the CLI reports failure.
    expect(code).toBe(1);
    expect(stdout).toHaveLength(1);
    const actual = JSON.parse(stdout[0]) as LintResult[];

    expect(actual).toEqual(expected);
  });

  it('covers each Wave-1/2 fix class at least once', async () => {
    const stdout: string[] = [];
    const code = await runMain({
      args: ['--json'],
      env: {},
      cwd: sampleProjectDir,
      stdout: (m) => stdout.push(m),
      stderr: () => {},
    });
    expect(code).toBe(1);
    const results = JSON.parse(stdout[0]) as LintResult[];
    const classNames = results.map((r) => r.className);

    // A1 — trailing "!" (Tailwind v4 important modifier) is flagged.
    expect(classNames.some((c) => c.endsWith('!'))).toBe(true);
    // A3 — a violation extracted from inside a multiline cn() call.
    expect(
      results.some((r) => r.filePath === 'multiline-cn.tsx' && r.className === 'bg-gray-500'),
    ).toBe(true);
    // A4 — new logical/v4 color utilities (border-s-, border-e-, ring-offset-,
    // inset-ring-, inset-shadow-, text-shadow-) are all flagged.
    for (const prefix of [
      'border-s-',
      'border-e-',
      'ring-offset-',
      'inset-ring-',
      'inset-shadow-',
      'text-shadow-',
    ]) {
      expect(classNames.some((c) => c.startsWith(prefix))).toBe(true);
    }
    // Ignore-comment usage actually suppresses a violation that would
    // otherwise be reported (p-4 on the ignored line in ignore-comments.tsx).
    expect(results.some((r) => r.filePath === 'ignore-comments.tsx' && r.className === 'p-4')).toBe(
      false,
    );
    // Allowed original-form classes (p-0, p-13 via custom `allowed`) never
    // show up as violations even though p-13 matches the p-{n} rule shape.
    expect(classNames).not.toContain('p-0');
    expect(classNames).not.toContain('p-13');
  });
});

/**
 * Second golden fixture (issue #133): a tiny project with NO config file at
 * all, exercising the pure default-config path end-to-end — DEFAULT_PATTERNS,
 * the default ignore globs (including a real `*.test.tsx` file that must be
 * skipped), and the full default prohibited list, including the sizing ban
 * added in #128 (w-{n}/h-{n}/max-w-{n}/etc.). The first golden fixture above
 * always runs with a custom `.design-token-lint.json`, so this is the only
 * regression net over "what a brand-new consumer sees with zero config."
 */
describe('golden fixture — default-project (no config file)', () => {
  it('matches the committed default-expected.json exactly', async () => {
    const expectedRaw = await readFile(join(fixturesDir, 'default-expected.json'), 'utf-8');
    const expected = JSON.parse(expectedRaw) as LintResult[];

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runMain({
      args: ['--json'],
      env: {},
      cwd: defaultProjectDir,
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
    });

    expect(code).toBe(1);
    expect(stdout).toHaveLength(1);
    const actual = JSON.parse(stdout[0]) as LintResult[];
    expect(actual).toEqual(expected);
  });

  it('exercises DEFAULT_PATTERNS, the default ignore glob, and the sizing ban with no config file present', async () => {
    const stdout: string[] = [];
    const code = await runMain({
      args: ['--json'],
      env: {},
      cwd: defaultProjectDir,
      stdout: (m) => stdout.push(m),
      stderr: () => {},
    });
    expect(code).toBe(1);
    const results = JSON.parse(stdout[0]) as LintResult[];
    const classNames = results.map((r) => r.className);

    // Numeric spacing and default-color rules fire with zero config.
    expect(classNames).toContain('p-4');
    expect(classNames).toContain('bg-gray-500');
    // The #128 default sizing ban (w-{n}/h-{n}/max-w-{n}) is active by default.
    expect(classNames).toContain('w-10');
    expect(classNames).toContain('h-20');
    expect(classNames).toContain('max-w-40');
    // comp.test.tsx matches the default ignore glob ("**/*.test.*") — its
    // m-8 violation must never surface, from a file that DOES exist on disk.
    expect(results.some((r) => r.filePath.includes('comp.test.tsx'))).toBe(false);
    expect(classNames).not.toContain('m-8');
  });
});
