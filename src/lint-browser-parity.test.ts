/**
 * Root <-> Playground-mirror parity for the v2 `semanticPrefixes` contract
 * (issue #160). The mirror (doc/src/lib/lint-browser.ts) is a hand-written,
 * dependency-free port of src/config.ts + src/rules.ts — see its file header
 * for the scope decisions. This test drives both matchers from the same
 * fixture table (src/__fixtures__/semantic-prefixes-matrix.json, written by
 * issue #158) so a future root change that isn't mirrored goes red in
 * ci.yml, rather than only surfacing as a doc-site drift bug later.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { compileConfig as rootCompileConfig, type LintConfig } from './config.js';
import { checkClassWithConfig as rootCheckClassWithConfig } from './rules.js';
import semanticPrefixesMatrix from './__fixtures__/semantic-prefixes-matrix.json';

/**
 * Single source of truth for the Playground mirror's location. A
 * post-rescaffold move of doc/src/lib/lint-browser.ts only ever requires
 * editing this one line.
 */
const MIRROR_MODULE_PATH = '../doc/src/lib/lint-browser.ts';

interface MirrorViolation {
  className: string;
  reason: string;
  category?: string;
}

interface MirrorCompiledConfig {
  rules: unknown[];
  allowed: Set<string>;
  ignore: string[];
  suggestions: Map<string, string>;
  semanticPrefixes: string[];
}

interface MirrorModule {
  compileConfig(config: {
    prohibited: LintConfig['prohibited'];
    allowed: string[];
    ignore: string[];
    semanticPrefixes?: string[];
  }): MirrorCompiledConfig;
  checkClassWithConfig(className: string, config: MirrorCompiledConfig): MirrorViolation | null;
}

let mirror: MirrorModule;

beforeAll(async () => {
  try {
    mirror = (await import(/* @vite-ignore */ MIRROR_MODULE_PATH)) as MirrorModule;
  } catch (err) {
    throw new Error(
      `lint-browser-parity: could not resolve the Playground mirror module at ` +
        `"${MIRROR_MODULE_PATH}" (MIRROR_MODULE_PATH in src/lint-browser-parity.test.ts). ` +
        `If doc/src/lib/lint-browser.ts moved during a doc-site rescaffold, update that ` +
        `constant rather than skipping this test. Original error: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    typeof mirror.compileConfig !== 'function' ||
    typeof mirror.checkClassWithConfig !== 'function'
  ) {
    throw new Error(
      `lint-browser-parity: module at "${MIRROR_MODULE_PATH}" no longer exports ` +
        `compileConfig/checkClassWithConfig by those names. Update MIRROR_MODULE_PATH's ` +
        `target or this test's expectations, rather than skipping.`,
    );
  }
});

type FixtureRow = {
  prohibited: LintConfig['prohibited'];
  allowed: string[];
  semanticPrefixes: string[];
  className: string;
  expect: 'pass' | 'flag';
};

describe('root/mirror parity — semanticPrefixes v2 (issue #160)', () => {
  it.each(semanticPrefixesMatrix as FixtureRow[])(
    '$expect: $className with semanticPrefixes=$semanticPrefixes — root and mirror agree',
    ({ prohibited, allowed, semanticPrefixes, className, expect: expected }) => {
      const rootConfig = rootCompileConfig({ prohibited, allowed, ignore: [], semanticPrefixes });
      const rootResult = rootCheckClassWithConfig(className, rootConfig);

      const mirrorConfig = mirror.compileConfig({
        prohibited,
        allowed,
        ignore: [],
        semanticPrefixes,
      });
      const mirrorResult = mirror.checkClassWithConfig(className, mirrorConfig);

      if (expected === 'pass') {
        expect(rootResult).toBeNull();
        expect(mirrorResult).toBeNull();
      } else {
        expect(rootResult).not.toBeNull();
        expect(mirrorResult).not.toBeNull();
        // Verdict-only comparison would miss message drift (e.g. the §4
        // parenthetical) — assert the reason strings are byte-identical too.
        expect(mirrorResult!.reason).toBe(rootResult!.reason);
      }
    },
  );
});
