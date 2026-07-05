import { defineConfig } from 'vitest/config';

// Project split (issue #133): `unit` excludes the subprocess suite so the
// fast inner loop (`vitest run --project unit`) never needs a fresh dist/
// build, while `subprocess` isolates cli-subprocess.test.ts — which spawns
// the compiled dist/cli.js as a real child process and is both slower and
// more failure-prone (process spawn overhead, OS scheduling) — under its own
// longer timeout budget. `pnpm test` (no --project filter) still runs both.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/cli-subprocess.test.ts'],
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'subprocess',
          include: ['src/cli-subprocess.test.ts'],
          testTimeout: 30000,
        },
      },
    ],
  },
});
