import { describe, it, expect, afterEach } from 'vitest';
import { lintContent } from './linter.js';
import { setConfig, getConfig } from './rules.js';
import { compileConfig, DEFAULT_CONFIG } from './config.js';

describe('lintContent — integration with config classAttributes/classFunctions', () => {
  afterEach(() => {
    // Reset to default config after each test
    setConfig(compileConfig(DEFAULT_CONFIG));
  });

  it('uses custom classAttributes from config', () => {
    setConfig(
      compileConfig({
        ...DEFAULT_CONFIG,
        classAttributes: ['inputClassName'],
      }),
    );
    // inputClassName should be scanned; className should not (not in list)
    const content = `<div inputClassName="p-4" className="m-8">`;
    const results = lintContent('test.tsx', content);
    // p-4 is prohibited; m-8 is prohibited but className is not in the custom list
    expect(results.map((r) => r.className)).toContain('p-4');
    expect(results.map((r) => r.className)).not.toContain('m-8');
  });

  it('uses custom classFunctions from config', () => {
    setConfig(
      compileConfig({
        ...DEFAULT_CONFIG,
        classFunctions: ['cva'],
      }),
    );
    // cva() should be scanned; cn() should not
    const content = `const a = cva("p-4"); const b = cn("m-8");`;
    const results = lintContent('test.tsx', content);
    expect(results.map((r) => r.className)).toContain('p-4');
    expect(results.map((r) => r.className)).not.toContain('m-8');
  });
});

describe('lintContent', () => {
  it('reports violations with file path and line numbers', () => {
    const content = `<div className="flex p-hgap-sm">
<span className="p-4 bg-gray-500">`;
    const results = lintContent('test.tsx', content);
    expect(results).toEqual([
      {
        filePath: 'test.tsx',
        line: 2,
        className: 'p-4',
        reason: expect.stringContaining('Numeric spacing'),
      },
      {
        filePath: 'test.tsx',
        line: 2,
        className: 'bg-gray-500',
        reason: expect.stringContaining('Default Tailwind color'),
      },
    ]);
  });

  it('returns empty array for clean files', () => {
    const content = `<div className="flex p-hgap-sm bg-zd-black">`;
    const results = lintContent('clean.tsx', content);
    expect(results).toEqual([]);
  });

  it('respects ignore comments', () => {
    const content = `/* design-token-lint-ignore */
<div className="p-4 bg-gray-500">`;
    const results = lintContent('ignored.tsx', content);
    expect(results).toEqual([]);
  });
});

describe('lintContent — CSS/SCSS dispatch (issue #131)', () => {
  afterEach(() => {
    setConfig(compileConfig(DEFAULT_CONFIG));
  });

  const CSS = `.modal {
  position: fixed;
  z-index: 9999;
  background: #ffe4e4;
}`;

  it('ZERO behavior change when the css section is absent (regression pin)', () => {
    // DEFAULT_CONFIG has no `css` section, so a .css file must fall through to
    // the Tailwind path and produce no CSS declaration violations at all —
    // exactly as before this feature existed.
    setConfig(compileConfig(DEFAULT_CONFIG));
    expect(getConfig().css).toBeUndefined();
    expect(lintContent('styles.css', CSS)).toEqual([]);
    expect(lintContent('styles.scss', CSS)).toEqual([]);
  });

  it('flags raw z-index and color literals when css is enabled', () => {
    setConfig(compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true, colorLiterals: true } }));
    const results = lintContent('styles.css', CSS);
    expect(results).toEqual([
      {
        filePath: 'styles.css',
        line: 3,
        className: 'z-index: 9999',
        reason: expect.stringContaining('z-index'),
      },
      {
        filePath: 'styles.css',
        line: 4,
        className: 'background: #ffe4e4',
        reason: expect.stringContaining('color literal'),
      },
    ]);
  });

  it('passes token references and only flags what each enabled rule targets', () => {
    setConfig(compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true } }));
    const css = `.a {
  z-index: var(--z-toast);
  z-index: calc(var(--z-modal) + 1);
  color: rgb(1, 2, 3);
}`;
    // Only z-index enabled: the var/calc forms pass, and the color literal is
    // not scanned because colorLiterals is off.
    expect(lintContent('a.css', css)).toEqual([]);
  });

  it('honors an escape-hatch ignore comment on a raw z-index', () => {
    setConfig(compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true } }));
    const css = `.a {
  /* design-token-lint-ignore */
  z-index: 9999;
}`;
    expect(lintContent('a.css', css)).toEqual([]);
  });

  it('lints .scss files too', () => {
    setConfig(compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true } }));
    const scss = `.a {
  z-index: 42; // this trailing scss comment is ignored
}`;
    const results = lintContent('a.scss', scss);
    expect(results).toHaveLength(1);
    expect(results[0].className).toBe('z-index: 42');
  });

  it('a non-CSS file is unaffected by the css section', () => {
    setConfig(compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true, colorLiterals: true } }));
    // The .tsx path is unchanged even with css enabled.
    const results = lintContent('c.tsx', `<div className="p-4">`);
    expect(results.map((r) => r.className)).toEqual(['p-4']);
  });
});

describe('lintContent — ignore hygiene: requireIgnoreReason / reportUnusedIgnores (issue #132)', () => {
  afterEach(() => {
    setConfig(compileConfig(DEFAULT_CONFIG));
  });

  describe('both flags false — regression pin (byte-identical to before)', () => {
    it('a bare ignore over a violation still suppresses silently, and an unused ignore is silent too', () => {
      const content = `// design-token-lint-ignore
<div className="p-4">
<div className="flex">
// design-token-lint-ignore
<div className="flex">`;
      expect(lintContent('a.tsx', content)).toEqual([]);
    });

    it('CSS: a bare ignore over a raw z-index still suppresses silently', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true } }));
      const css = `.a {
  /* design-token-lint-ignore */
  z-index: 9999;
}`;
      expect(lintContent('a.css', css)).toEqual([]);
    });
  });

  describe('requireIgnoreReason', () => {
    it('reports the distinct reason at the suppressed class line when the ignore is bare', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, requireIgnoreReason: true }));
      const content = `// design-token-lint-ignore
<div className="p-4">`;
      expect(lintContent('a.tsx', content)).toEqual([
        {
          filePath: 'a.tsx',
          line: 2,
          className: 'p-4',
          reason: 'suppressed without documented reason',
        },
      ]);
    });

    it('a reason-carrying ignore over the same violation still suppresses silently', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, requireIgnoreReason: true }));
      const content = `// design-token-lint-ignore - vendor requires literal p-4
<div className="p-4">`;
      expect(lintContent('a.tsx', content)).toEqual([]);
    });

    it('does not apply to a bare file-level ignore (out of scope this round)', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, requireIgnoreReason: true }));
      const content = `// design-token-lint-ignore-file
<div className="p-4">`;
      expect(lintContent('a.tsx', content)).toEqual([]);
    });

    it('a bare ignore over a clean line reports nothing (nothing to require a reason for)', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, requireIgnoreReason: true }));
      const content = `// design-token-lint-ignore
<div className="flex">`;
      expect(lintContent('a.tsx', content)).toEqual([]);
    });

    it('CSS: reports the distinct reason at the declaration line when the ignore is bare', () => {
      setConfig(
        compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true }, requireIgnoreReason: true }),
      );
      const css = `.a {
  /* design-token-lint-ignore */
  z-index: 9999;
}`;
      expect(lintContent('a.css', css)).toEqual([
        {
          filePath: 'a.css',
          line: 3,
          className: 'z-index: 9999',
          reason: 'suppressed without documented reason',
        },
      ]);
    });
  });

  describe('reportUnusedIgnores', () => {
    it('reports an ignore that suppressed nothing at the comment line, with className "design-token-lint-ignore"', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, reportUnusedIgnores: true }));
      const content = `// design-token-lint-ignore
<div className="flex">`;
      expect(lintContent('a.tsx', content)).toEqual([
        {
          filePath: 'a.tsx',
          line: 1,
          className: 'design-token-lint-ignore',
          reason: 'Unused design-token-lint-ignore comment — suppressed no violation',
        },
      ]);
    });

    it('does not report an ignore that actually suppressed a violation', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, reportUnusedIgnores: true }));
      const content = `// design-token-lint-ignore
<div className="p-4">`;
      expect(lintContent('a.tsx', content)).toEqual([]);
    });

    it('a trailing same-line ignore over two clean lines is reported once, not twice', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, reportUnusedIgnores: true }));
      const content = `<div className="flex"> {/* design-token-lint-ignore */}
<div className="grid">`;
      expect(lintContent('a.tsx', content)).toEqual([
        {
          filePath: 'a.tsx',
          line: 1,
          className: 'design-token-lint-ignore',
          reason: 'Unused design-token-lint-ignore comment — suppressed no violation',
        },
      ]);
    });

    it('a trailing same-line ignore is NOT unused when either side suppressed a violation', () => {
      setConfig(compileConfig({ ...DEFAULT_CONFIG, reportUnusedIgnores: true }));
      const content = `<div className="flex"> {/* design-token-lint-ignore */}
<div className="p-4">`;
      expect(lintContent('a.tsx', content)).toEqual([]);
    });

    it('CSS: reports an ignore over a clean declaration at the comment line', () => {
      setConfig(
        compileConfig({ ...DEFAULT_CONFIG, css: { zIndex: true }, reportUnusedIgnores: true }),
      );
      const css = `.a {
  /* design-token-lint-ignore */
  color: red;
}`;
      expect(lintContent('a.css', css)).toEqual([
        {
          filePath: 'a.css',
          line: 2,
          className: 'design-token-lint-ignore',
          reason: 'Unused design-token-lint-ignore comment — suppressed no violation',
        },
      ]);
    });
  });

  describe('both flags together', () => {
    it('a bare ignore that suppressed a violation reports only the requireIgnoreReason finding', () => {
      setConfig(
        compileConfig({
          ...DEFAULT_CONFIG,
          requireIgnoreReason: true,
          reportUnusedIgnores: true,
        }),
      );
      const content = `// design-token-lint-ignore
<div className="p-4">`;
      expect(lintContent('a.tsx', content)).toEqual([
        {
          filePath: 'a.tsx',
          line: 2,
          className: 'p-4',
          reason: 'suppressed without documented reason',
        },
      ]);
    });
  });

  it('interleaves hygiene findings with normal violations in top-down line order', () => {
    setConfig(compileConfig({ ...DEFAULT_CONFIG, requireIgnoreReason: true }));
    const content = `<div className="bg-gray-500">
// design-token-lint-ignore
<div className="p-4">
<div className="m-8">`;
    expect(lintContent('a.tsx', content)).toEqual([
      {
        filePath: 'a.tsx',
        line: 1,
        className: 'bg-gray-500',
        reason: expect.stringContaining('Default Tailwind color'),
      },
      {
        filePath: 'a.tsx',
        line: 3,
        className: 'p-4',
        reason: 'suppressed without documented reason',
      },
      {
        filePath: 'a.tsx',
        line: 4,
        className: 'm-8',
        reason: expect.stringContaining('Numeric spacing'),
      },
    ]);
  });

  it('hygiene findings use the exact flat LintResult shape (--json / --format github stay well-formed)', () => {
    setConfig(
      compileConfig({ ...DEFAULT_CONFIG, requireIgnoreReason: true, reportUnusedIgnores: true }),
    );
    const content = `// design-token-lint-ignore
<div className="p-4">
// design-token-lint-ignore
<div className="flex">`;
    const results = lintContent('a.tsx', content);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(['className', 'filePath', 'line', 'reason']);
      expect(typeof r.filePath).toBe('string');
      expect(typeof r.line).toBe('number');
      expect(typeof r.className).toBe('string');
      expect(typeof r.reason).toBe('string');
    }
  });
});
