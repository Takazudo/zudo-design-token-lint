import { describe, it, expect } from 'vitest';
import { extractClasses } from './extractor.js';

describe('extractClasses', () => {
  it('extracts from className="..."', () => {
    const content = '<div className="p-4 flex bg-zd-black">';
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 1 },
      { className: 'flex', line: 1 },
      { className: 'bg-zd-black', line: 1 },
    ]);
  });

  it('extracts from class="..." (Astro)', () => {
    const content = '<div class="m-8 grid">';
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'm-8', line: 1 },
      { className: 'grid', line: 1 },
    ]);
  });

  it("extracts from className={'...'}", () => {
    const content = "<div className={'gap-4 hidden'}>";
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'gap-4', line: 1 },
      { className: 'hidden', line: 1 },
    ]);
  });

  it('extracts from template literals', () => {
    const content = '<div className={`px-6 relative`}>';
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'px-6', line: 1 },
      { className: 'relative', line: 1 },
    ]);
  });

  it('extracts from class:list (Astro)', () => {
    const content = `<div class:list={["p-4 flex", 'bg-gray-500']}>`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 1 },
      { className: 'flex', line: 1 },
      { className: 'bg-gray-500', line: 1 },
    ]);
  });

  it('extracts from cn/clsx utility calls', () => {
    const content = `const cls = cn("p-4 flex", 'bg-zd-black');`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 1 },
      { className: 'flex', line: 1 },
      { className: 'bg-zd-black', line: 1 },
    ]);
  });

  it('tracks correct line numbers', () => {
    const content = `<div>
  <span className="p-4">
  <span class="m-8">
</div>`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 2 },
      { className: 'm-8', line: 3 },
    ]);
  });

  it('respects /* design-token-lint-ignore */ comment', () => {
    const content = `/* design-token-lint-ignore */
<div className="p-4 flex">`;
    const result = extractClasses(content);
    expect(result).toEqual([]);
  });

  it('respects {/* design-token-lint-ignore */} JSX comment', () => {
    const content = `{/* design-token-lint-ignore */}
<div className="p-4 flex">`;
    const result = extractClasses(content);
    expect(result).toEqual([]);
  });

  it('respects // design-token-lint-ignore comment', () => {
    const content = `// design-token-lint-ignore
<div className="p-4 flex">`;
    const result = extractClasses(content);
    expect(result).toEqual([]);
  });

  it('only ignores the next line after ignore comment', () => {
    const content = `/* design-token-lint-ignore */
<div className="p-4">
<div className="m-8">`;
    const result = extractClasses(content);
    expect(result).toEqual([{ className: 'm-8', line: 3 }]);
  });

  it('handles multiple className attributes on separate lines', () => {
    const content = `<div className="p-hgap-sm">
<span className="bg-zd-black text-zd-white">`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-hgap-sm', line: 1 },
      { className: 'bg-zd-black', line: 2 },
      { className: 'text-zd-white', line: 2 },
    ]);
  });

  it('handles empty class strings', () => {
    const content = '<div className="">';
    const result = extractClasses(content);
    expect(result).toEqual([]);
  });
});
