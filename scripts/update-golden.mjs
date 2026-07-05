#!/usr/bin/env node

// update-golden.mjs — regenerate the golden-fixture expected.json files
// (issue #133) by running the compiled CLI against each committed fixture
// project and capturing its --json output.
//
// WARNING: this OVERWRITES the committed expected*.json files. Only run it
// deliberately, after confirming the underlying rule/behavior change is
// intentional — then diff-review the result (`git diff test/fixtures`)
// before committing. A clean checkout with no rule changes must regenerate
// byte-identical files (this is what makes `pnpm golden:update && git diff
// --exit-code` a meaningful idempotency check).
//
// Run via `pnpm golden:update` (its `pregolden:update` hook runs `pnpm
// build` first, so dist/cli.js always reflects current source).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distCli = join(root, 'dist', 'cli.js');
const fixturesDir = join(root, 'test', 'fixtures');

const fixtures = [
  { dir: join(fixturesDir, 'sample-project'), out: join(fixturesDir, 'expected.json') },
  { dir: join(fixturesDir, 'default-project'), out: join(fixturesDir, 'default-expected.json') },
];

/**
 * Run `node dist/cli.js --json` in `dir` and return stdout. The CLI exits 1
 * when violations are found (expected for both fixtures), which makes
 * execFileSync throw — the JSON is still on the error's `stdout`.
 */
function runCliJson(dir) {
  try {
    return execFileSync(process.execPath, [distCli, '--json'], { cwd: dir, encoding: 'utf-8' });
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.length > 0) {
      return err.stdout;
    }
    throw err;
  }
}

for (const { dir, out } of fixtures) {
  const stdout = runCliJson(dir);
  const results = JSON.parse(stdout);
  // Pretty-print (2-space indent, trailing newline) to match the committed
  // format — the CLI itself emits a single-line JSON array.
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Updated ${out} (${results.length} violation(s))`);
}
