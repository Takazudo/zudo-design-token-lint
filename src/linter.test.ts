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
