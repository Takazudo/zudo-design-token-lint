import { describe, it, expect } from 'vitest';
import { extractClasses, DEFAULT_CLASS_ATTRIBUTES, DEFAULT_CLASS_FUNCTIONS } from './extractor.js';

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

  it("extracts from class='...' (single-quote HTML)", () => {
    const content = "<div class='p-4 flex'>";
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 1 },
      { className: 'flex', line: 1 },
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

  it('does not treat design-token-lint-ignore-file as a line-level ignore', () => {
    const content = `// design-token-lint-ignore-file
<div className="p-4">
<div className="m-8">`;
    // file-level directive causes early return — whole file is empty
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

  describe('should not extract from data- attributes', () => {
    it('does not extract from data-class="..."', () => {
      const content = '<div data-class="p-4" />';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('does not extract from data-classes="..."', () => {
      const content = '<div data-classes="bg-gray-500" />';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('does not extract from aria-class="..."', () => {
      const content = '<div aria-class="foo" />';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });
  });

  describe('should strip CSS comments from className', () => {
    it('strips a trailing CSS comment', () => {
      const content = '<div className="p-4 /* comment */">';
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('strips multiple inline CSS comments', () => {
      const content = '<div className="p-4 /* a */ m-8 /* b */">';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
      ]);
    });

    it('returns nothing when className is a full comment', () => {
      const content = '<div className="/* full comment */">';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('strips comment with no surrounding spaces', () => {
      const content = '<div className="p-4/* no-space */m-8">';
      const result = extractClasses(content);
      // Comment replaced with a space so adjacent tokens remain separate
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
      ]);
    });
  });

  describe('should extract from multiline className attributes', () => {
    it('basic multiline with double quotes (3 lines)', () => {
      const content = `<div
  className="p-4
    bg-gray-500
    m-8"
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'bg-gray-500', line: 2 },
        { className: 'm-8', line: 2 },
      ]);
    });

    it('basic multiline with single quotes', () => {
      const content = `<div
  class='p-4
    flex
    gap-2'
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'flex', line: 2 },
        { className: 'gap-2', line: 2 },
      ]);
    });

    it('multiline spanning 4+ lines', () => {
      const content = `<div className="p-4
  m-2
  flex
  items-center
  gap-4"
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-2', line: 1 },
        { className: 'flex', line: 1 },
        { className: 'items-center', line: 1 },
        { className: 'gap-4', line: 1 },
      ]);
    });

    it('multiline className with indentation (Prettier-style)', () => {
      const content = `<div
  className="
    p-4
    bg-gray-500
    m-8
  "
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'bg-gray-500', line: 2 },
        { className: 'm-8', line: 2 },
      ]);
    });

    it('single-line still works (regression check)', () => {
      const content = '<div className="p-4 flex bg-gray-500">';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'flex', line: 1 },
        { className: 'bg-gray-500', line: 1 },
      ]);
    });

    it('line numbers reference the opening line', () => {
      const content = `<div>
  <span>text</span>
  <div
    className="p-4
      m-8"
  />
</div>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 4 },
        { className: 'm-8', line: 4 },
      ]);
    });

    it('mix of single-line and multiline in the same file', () => {
      const content = `<div className="p-4 flex">
  <span
    className="m-8
      gap-2"
  >
    <p className="text-sm">hi</p>
  </span>
</div>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'flex', line: 1 },
        { className: 'm-8', line: 3 },
        { className: 'gap-2', line: 3 },
        { className: 'text-sm', line: 6 },
      ]);
    });

    it('skips multiline block when opening line has ignore comment on previous line', () => {
      const content = `// design-token-lint-ignore
<div className="p-4
  m-8"
/>
<span className="flex">text</span>`;
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'flex', line: 5 }]);
    });
  });

  describe('file-level ignore', () => {
    it('respects /* design-token-lint-ignore-file */ at top of file', () => {
      const content = `/* design-token-lint-ignore-file */
<div className="p-4 flex">
<div class="m-8">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('respects {/* design-token-lint-ignore-file */} JSX style at top of file', () => {
      const content = `{/* design-token-lint-ignore-file */}
<div className="p-4 flex">
<div class="m-8">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('respects // design-token-lint-ignore-file at top of file', () => {
      const content = `// design-token-lint-ignore-file
<div className="p-4 flex">
<div class="m-8">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('ignores entire file when comment is mid-file', () => {
      const content = `<div className="p-4 flex">
/* design-token-lint-ignore-file */
<div class="m-8">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('extracts normally when no file-level ignore comment is present', () => {
      const content = `<div className="p-4 flex">`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'flex', line: 1 },
      ]);
    });

    it('does not trigger on ignore-file text inside a string literal', () => {
      const content = `<div className="p-4">
  <p>Use /* design-token-lint-ignore-file */ to skip</p>
</div>`;
      const result = extractClasses(content);
      expect(result.length).toBeGreaterThan(0);
    });

    it('does not trigger on ignore-file text inside JSX text content', () => {
      const content = `<div className="p-4">
  The comment design-token-lint-ignore-file skips files
</div>`;
      const result = extractClasses(content);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('ExtractorOptions — custom classAttributes', () => {
    it('exports DEFAULT_CLASS_ATTRIBUTES containing className and class', () => {
      expect(DEFAULT_CLASS_ATTRIBUTES).toContain('className');
      expect(DEFAULT_CLASS_ATTRIBUTES).toContain('class');
    });

    it('does not extract from custom attribute by default', () => {
      const content = '<div inputClassName="p-4">';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('extracts from custom attribute when specified', () => {
      const content = '<div inputClassName="p-4">';
      const result = extractClasses(content, { classAttributes: ['inputClassName'] });
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('extracts from multiple custom attributes in one file', () => {
      const content = '<div inputClassName="p-4" wrapperClass="m-8">';
      const result = extractClasses(content, {
        classAttributes: ['inputClassName', 'wrapperClass'],
      });
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
      ]);
    });

    it('handles empty classAttributes array (matches nothing)', () => {
      const content = '<div className="p-4" class="m-8">';
      const result = extractClasses(content, { classAttributes: [] });
      expect(result).toEqual([]);
    });

    it('handles single-item classAttributes array', () => {
      const content = '<div myClass="p-4" className="m-8">';
      const result = extractClasses(content, { classAttributes: ['myClass'] });
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('extracts from multiline custom attribute', () => {
      const content = `<div
  inputClassName="p-4
    m-8"
/>`;
      const result = extractClasses(content, { classAttributes: ['inputClassName'] });
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'm-8', line: 2 },
      ]);
    });

    it('class:list still works regardless of classAttributes option', () => {
      const content = `<div class:list={["p-4 flex", 'bg-gray-500']}>`;
      const result = extractClasses(content, { classAttributes: [] });
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'flex', line: 1 },
        { className: 'bg-gray-500', line: 1 },
      ]);
    });

    it('preserves backward compatibility when no options passed (className and class)', () => {
      const content = '<div className="p-4" class="m-8">';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
      ]);
    });
  });

  describe('ExtractorOptions — custom classFunctions', () => {
    it('exports DEFAULT_CLASS_FUNCTIONS containing cn, clsx, classNames, twMerge', () => {
      expect(DEFAULT_CLASS_FUNCTIONS).toContain('cn');
      expect(DEFAULT_CLASS_FUNCTIONS).toContain('clsx');
      expect(DEFAULT_CLASS_FUNCTIONS).toContain('classNames');
      expect(DEFAULT_CLASS_FUNCTIONS).toContain('twMerge');
    });

    it('does not extract from custom function by default', () => {
      const content = `const cls = cva("p-4");`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('extracts from custom function when specified', () => {
      const content = `const cls = cva("p-4");`;
      const result = extractClasses(content, { classFunctions: ['cva'] });
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('extracts from multiple custom functions in one file', () => {
      const content = `const a = cva("p-4"); const b = tv("m-8");`;
      const result = extractClasses(content, { classFunctions: ['cva', 'tv'] });
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
      ]);
    });

    it('handles empty classFunctions array (matches nothing for functions)', () => {
      const content = `const cls = cn("p-4");`;
      const result = extractClasses(content, { classFunctions: [] });
      expect(result).toEqual([]);
    });

    it('handles single-item classFunctions array', () => {
      const content = `const a = cva("p-4"); const b = cn("m-8");`;
      const result = extractClasses(content, { classFunctions: ['cva'] });
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('preserves backward compatibility when no options passed (cn, clsx, classNames, twMerge)', () => {
      const content = `cn("p-4") clsx("m-8") classNames("gap-4") twMerge("flex")`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
        { className: 'gap-4', line: 1 },
        { className: 'flex', line: 1 },
      ]);
    });
  });
});
