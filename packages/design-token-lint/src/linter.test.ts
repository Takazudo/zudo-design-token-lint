import { describe, it, expect } from 'vitest';
import { lintContent } from './linter.js';

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
