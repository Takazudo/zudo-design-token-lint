import { describe, it, expect } from 'vitest';
import {
  extractClasses,
  extractClassesWithMeta,
  DEFAULT_CLASS_ATTRIBUTES,
  DEFAULT_CLASS_FUNCTIONS,
} from './extractor.js';

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

  it('attr-level template literal: static tokens are flagged; ${...} tokens fall through unmatched', () => {
    // Mirrors the cn(`p-6 ${x} m-6`) coverage below, but at the attribute
    // level (className={`...`}) — only the fully-static form was tested here
    // before, so an interpolated attr-level template literal was unpinned.
    const content = '<div className={`px-6 ${x}`}>';
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'px-6', line: 1 },
      { className: '${x}', line: 1 },
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

  it('does not double-report a classFunction call nested inside class:list', () => {
    const content = `<div class:list={[cn('p-4')]}>`;
    const result = extractClasses(content);
    expect(result).toEqual([{ className: 'p-4', line: 1 }]);
  });

  it('does not extract a token opened and closed with mismatched quotes in class:list', () => {
    const content = `<div class:list={["p-4']}>`;
    const result = extractClasses(content);
    expect(result).toEqual([]);
  });

  it('extracts from a multiline class:list array (Prettier style)', () => {
    const content = `<div class:list={[
  "p-4 flex",
  'bg-gray-500',
]}>`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 2 },
      { className: 'flex', line: 2 },
      { className: 'bg-gray-500', line: 3 },
    ]);
  });

  it('extracts a multiline class:list array with object-key syntax (Astro)', () => {
    const content = `<div class:list={[
  { "p-4": true, "m-8": isActive }
]}>`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 2 },
      { className: 'm-8', line: 2 },
    ]);
  });

  it('a `]` inside a class:list string literal does not close the array early', () => {
    const content = `<div class:list={[
  "p-4]",
  "m-8"
]}>`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4]', line: 2 },
      { className: 'm-8', line: 3 },
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

  it('extracts from className={"..."} (double-quote brace form)', () => {
    const content = '<div className={"p-4 flex"}>';
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 1 },
      { className: 'flex', line: 1 },
    ]);
  });

  describe('multiline utility function calls', () => {
    it('extracts from a multiline cn() call (Prettier/shadcn style)', () => {
      const content = `const cls = cn(
  "p-4",
  isActive && "bg-blue-500",
  className,
);`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'bg-blue-500', line: 3 },
      ]);
    });

    it('extracts from a multiline clsx() call', () => {
      const content = `const cls = clsx(
  'gap-4',
  'hidden'
);`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'gap-4', line: 2 },
        { className: 'hidden', line: 3 },
      ]);
    });

    it('a `)` inside a string literal does not close the call early', () => {
      const content = `const cls = cn(
  "p-4)",
  "m-8"
);`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4)', line: 2 },
        { className: 'm-8', line: 3 },
      ]);
    });

    it('balances nested calls before closing (single line)', () => {
      const content = `const cls = cn(cond ? 'p-2' : cx('p-4'));`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-2', line: 1 },
        { className: 'p-4', line: 1 },
      ]);
    });

    it('balances nested calls before closing (multiline)', () => {
      const content = `const cls = cn(
  cond ? 'p-2' : cx('p-4'),
  'm-8'
);`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-2', line: 2 },
        { className: 'p-4', line: 2 },
        { className: 'm-8', line: 3 },
      ]);
    });

    it('bails gracefully past the 50-line cap, extracting exactly what the cap allows', () => {
      const argLines = Array.from({ length: 60 }, (_, i) => `  "p-${i}",`);
      const content = `const cls = cn(\n${argLines.join('\n')}\n);`;
      expect(() => extractClasses(content)).not.toThrow();
      const result = extractClasses(content);
      // 50 arg lines are consumed (the cap), starting right after the opening
      // `cn(` line — so p-0..p-49 on source lines 2..51 — and everything past
      // the cap (p-50..p-59) is silently dropped rather than extracted.
      expect(result).toHaveLength(50);
      expect(result[0]).toEqual({ className: 'p-0', line: 2 });
      expect(result[49]).toEqual({ className: 'p-49', line: 51 });
      expect(result.some((r) => r.className === 'p-50')).toBe(false);
    });

    it('still scans source after a multiline call closes mid-line', () => {
      const content = `const a = cn(
  'p-4'
); const b = cn('m-8');`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'm-8', line: 3 },
      ]);
    });

    it('still scans attributes after a multiline class:list closes mid-line', () => {
      const content = `<div class:list={[
  'p-4'
]} class="m-8">`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'm-8', line: 3 },
      ]);
    });
  });

  describe('function-name word boundary', () => {
    it('does not scan an identifier merely ending in a function name', () => {
      const content = `const cls = mycn("p-4");`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('still scans the configured function name itself', () => {
      const content = `const cls = cn("p-4");`;
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('does not scan a function name preceded by $ (word-boundary lookbehind)', () => {
      const content = 'const cls = $cn("p-4");';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('scans a call whose name is immediately preceded by a non-word character', () => {
      const content = '<div className={cn("p-4")}>';
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });
  });

  describe('template-literal arguments in utility function calls', () => {
    it('extracts from a fully static template-literal argument', () => {
      const content = 'const cls = cn(`p-6 m-6`);';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-6', line: 1 },
        { className: 'm-6', line: 1 },
      ]);
    });

    it('static tokens are flagged; ${...} tokens fall through unmatched', () => {
      const content = 'const cls = cn(`p-6 ${x} m-6`);';
      const result = extractClasses(content);
      expect(result.some((r) => r.className === 'p-6')).toBe(true);
      expect(result.some((r) => r.className === 'm-6')).toBe(true);
      expect(result.some((r) => r.className.includes('${x}'))).toBe(true);
    });
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

  it('extracts from multiple className attributes on the same line', () => {
    const content = '<div className="p-4" className="m-8">';
    const result = extractClasses(content);
    expect(result.some((r) => r.className === 'p-4')).toBe(true);
    expect(result.some((r) => r.className === 'm-8')).toBe(true);
  });

  it('does not extract from a bare template literal expression outside any recognized attribute/function wrapper', () => {
    const content = 'const cls = `p-${size} m-4`;';
    const result = extractClasses(content);
    expect(result.some((r) => r.className === 'm-4')).toBe(false);
  });

  it('mixes a multiline cn() call with a single-line cn() call in the same file', () => {
    const content = `const a = cn("p-4", "flex");
const b = cn(
  "m-8",
  "gap-2"
);`;
    const result = extractClasses(content);
    expect(result).toEqual([
      { className: 'p-4', line: 1 },
      { className: 'flex', line: 1 },
      { className: 'm-8', line: 3 },
      { className: 'gap-2', line: 4 },
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
    it('attributes each class to its own actual source line (3 lines)', () => {
      const content = `<div
  className="p-4
    bg-gray-500
    m-8"
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'bg-gray-500', line: 3 },
        { className: 'm-8', line: 4 },
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
        { className: 'flex', line: 3 },
        { className: 'gap-2', line: 4 },
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
        { className: 'm-2', line: 2 },
        { className: 'flex', line: 3 },
        { className: 'items-center', line: 4 },
        { className: 'gap-4', line: 5 },
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
        { className: 'p-4', line: 3 },
        { className: 'bg-gray-500', line: 4 },
        { className: 'm-8', line: 5 },
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

    it('line numbers reference each actual continuation line, not just the opening line', () => {
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
        { className: 'm-8', line: 5 },
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
        { className: 'gap-2', line: 4 },
        { className: 'text-sm', line: 6 },
      ]);
    });

    it('still scans the remainder of the closing line after a multiline attribute closes mid-line', () => {
      const content = '<div className="p-4\n  m-8" id="x"><span className="gap-4">';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 2 },
        { className: 'gap-4', line: 2 },
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

  describe('ignore comments inside multiline constructs', () => {
    it('// ignore comment before an inner cn() argument suppresses only that line', () => {
      const content = `const cls = cn(
  "flex",
  // design-token-lint-ignore
  "p-4",
  "m-8",
);`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'flex', line: 2 },
        { className: 'm-8', line: 5 },
      ]);
    });

    it('// ignore comment before an inner class:list element suppresses only that line', () => {
      const content = `<div class:list={[
  'flex',
  // design-token-lint-ignore
  'p-4',
  'm-8',
]}>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'flex', line: 2 },
        { className: 'm-8', line: 5 },
      ]);
    });

    it('{/* design-token-lint-ignore */} JSX comment before an inner cn() argument suppresses only that line', () => {
      const content = `const cls = cn(
  "flex",
  {/* design-token-lint-ignore */}
  "p-4",
  "m-8",
);`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'flex', line: 2 },
        { className: 'm-8', line: 5 },
      ]);
    });

    it('{/* design-token-lint-ignore */} JSX comment before an inner class:list element suppresses only that line', () => {
      const content = `<div class:list={[
  'flex',
  {/* design-token-lint-ignore */}
  'p-4',
  'm-8',
]}>`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'flex', line: 2 },
        { className: 'm-8', line: 5 },
      ]);
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
        { className: 'm-8', line: 3 },
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

  describe('comment-aware extraction (does not lint commented-out code)', () => {
    it('does not extract from a JSX-commented-out className', () => {
      const content = '{/* <div className="p-4"> */}';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('does not extract from a // commented-out className', () => {
      const content = '// <div className="p-4">';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('still extracts a real className on a line with no comment', () => {
      const content = '<div className="p-4">';
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });

    it('still extracts className text embedded inside a string value (regression)', () => {
      // The className value itself may contain a CSS comment — that's a
      // different, already-handled concern (addClasses strips it). Comment
      // detection must not be fooled by comment-like text inside a string.
      const content = '<div className="p-4 /* should this be extracted? */">';
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });
  });

  describe('comment awareness inside scanBalancedDelimited', () => {
    it('does not let an unpaired quote inside a /* */ comment corrupt the balanced scan', () => {
      const content = "cn(a /* don't */, 'p-4')";
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 1 }]);
    });
  });

  describe('backslash-escaped quotes inside call arguments (scanBalancedDelimited)', () => {
    it('a backslash-escaped quote does not end the call early, so a later sibling argument is still reached', () => {
      // scanBalancedDelimited's backslash handling keeps the whole first
      // argument inside one quoted span despite the embedded escaped quotes,
      // so the call's true closing paren is found correctly and "m-8" is
      // reached at all. Originally (#133) extractFromCallArgs' own
      // token regex had no escape awareness, so the escaped-quote argument
      // was mangled into fragments (`say`, `\`, `p-4`) rather than one clean
      // string — that quirk was deliberately pinned as out of scope for that
      // task. #139 made scanQuotedLiterals (the token scanner shared by
      // extractFromCallArgs/extractFromClassListArray) backslash-escape
      // aware too, so the whole first argument is now recognized as ONE
      // literal token (escape sequences left raw/unresolved, matching
      // scanBalancedDelimited's own style) — this re-pins the corrected
      // output. The key invariant #133 actually cared about — that "p-4" and
      // "m-8" are never lost — still holds, and holds more cleanly now.
      const content = `const cls = cn("say \\"hi\\" p-4", "m-8");`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'say', line: 1 },
        { className: '\\"hi\\"', line: 1 },
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 1 },
      ]);
    });
  });

  describe('backslash-escaped quotes no longer drop a sibling violation (#139)', () => {
    it('a sibling violation after an escaped single-quoted argument is still extracted', () => {
      // Before #139, the naive per-token regex closed the first string on the
      // escaped quote itself, desyncing the remaining scan so the trailing
      // unpaired quote around "p-4" never found a partner and the violation
      // was silently dropped entirely (not just mangled). This is the exact
      // repro from the issue.
      const content = `const cls = cn('it\\'s', 'p-4');`;
      const result = extractClasses(content);
      expect(result.some((r) => r.className === 'p-4')).toBe(true);
    });

    it('a sibling violation after an escaped double-quoted argument is still extracted', () => {
      const content = `const cls = cn("a\\"b", "p-4");`;
      const result = extractClasses(content);
      expect(result.some((r) => r.className === 'p-4')).toBe(true);
    });

    it('handles escaped quotes in both single- and double-quoted call args, keeping every sibling violation', () => {
      const content = `const cls = cn('a\\'b', "c\\"d", 'p-4', "m-8");`;
      const result = extractClasses(content);
      expect(result.some((r) => r.className === 'p-4')).toBe(true);
      expect(result.some((r) => r.className === 'm-8')).toBe(true);
    });

    it('a class:list array argument with an escaped quote does not drop a sibling violation', () => {
      const content = `<div class:list={["it\\'s", 'p-4']}>`;
      const result = extractClasses(content);
      expect(result.some((r) => r.className === 'p-4')).toBe(true);
    });

    it('a class token containing an escaped quote is extracted verbatim, not silently dropped', () => {
      // Pins the corrected behavior: the escaped-quote token itself is
      // extracted as one raw (still-escaped) whitespace-delimited chunk
      // rather than vanishing — the key contract is "nothing is silently
      // dropped", not any particular unescaping of the token's own text.
      const content = `const cls = cn('it\\'s', 'p-4');`;
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: "it\\'s", line: 1 },
        { className: 'p-4', line: 1 },
      ]);
    });
  });

  describe('CRLF (\\r\\n) line endings (Windows-authored files)', () => {
    it('extracts correctly from single-line className attributes with CRLF endings', () => {
      const content = '<div className="p-4 flex">\r\n<span className="m-8">\r\n';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'flex', line: 1 },
        { className: 'm-8', line: 2 },
      ]);
    });

    it('a multiline className attribute spanning CRLF-terminated lines extracts clean class names (no trailing \\r)', () => {
      const content = '<div\r\n  className="p-4\r\n    bg-gray-500\r\n    m-8"\r\n/>';
      const result = extractClasses(content);
      expect(result).toEqual([
        { className: 'p-4', line: 2 },
        { className: 'bg-gray-500', line: 3 },
        { className: 'm-8', line: 4 },
      ]);
    });
  });

  describe('ignore comment with reason text', () => {
    it('respects /* design-token-lint-ignore <reason> */ block comment', () => {
      const content = `/* design-token-lint-ignore - vendor requires literal p-4 */
<div className="p-4">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('respects {/* design-token-lint-ignore <reason> */} JSX comment', () => {
      const content = `{/* design-token-lint-ignore — vendor requires literal p-4 */}
<div className="p-4">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('respects // design-token-lint-ignore <reason> line comment', () => {
      const content = `// design-token-lint-ignore - vendor requires literal p-4
<div className="p-4">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('still respects /* design-token-lint-ignore */ without reason text (regression)', () => {
      const content = `/* design-token-lint-ignore */
<div className="p-4">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('still respects {/* design-token-lint-ignore */} without reason text (regression)', () => {
      const content = `{/* design-token-lint-ignore */}
<div className="p-4">`;
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('does not treat design-token-lint-ignore-file as a reason-text line ignore', () => {
      const content = `/* design-token-lint-ignore-file */
<div className="p-4">`;
      const result = extractClasses(content);
      // File-level ignore still takes precedence and empties the whole file.
      expect(result).toEqual([]);
    });
  });

  describe('same-line and continuation-line ignores', () => {
    it('suppresses its own line when a trailing JSX ignore comment follows real content', () => {
      const content = '<div className="p-4"> {/* design-token-lint-ignore */}';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('suppresses its own line when a trailing block ignore comment follows real content', () => {
      const content = '<div class="p-4"> /* design-token-lint-ignore */';
      const result = extractClasses(content);
      expect(result).toEqual([]);
    });

    it('a trailing same-line ignore suppresses both its own line and the next (pre-existing next-line semantics)', () => {
      const content = `<div className="p-4"> {/* design-token-lint-ignore */}
<div className="m-8">
<div className="gap-2">`;
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'gap-2', line: 3 }]);
    });

    it('an ignore comment alone on its own line still only suppresses the next line (regression)', () => {
      const content = `{/* design-token-lint-ignore */}
<div className="p-4">
<div className="m-8">`;
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'm-8', line: 3 }]);
    });

    it('honors an ignore comment before a continuation line of a multiline attribute', () => {
      const content = `<div
  className="p-4
  // design-token-lint-ignore
  m-8"
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 2 }]);
    });

    it('honors a JSX ignore comment before a continuation line of a multiline attribute', () => {
      const content = `<div
  className="p-4
  {/* design-token-lint-ignore */}
  m-8"
/>`;
      const result = extractClasses(content);
      expect(result).toEqual([{ className: 'p-4', line: 2 }]);
    });
  });
});

describe('extractClassesWithMeta', () => {
  describe('regression: classes output is byte-identical to extractClasses()', () => {
    // A corpus of fixtures pulled from the extractClasses() describe blocks
    // above — every ignore style, multiline construct, and edge case those
    // tests cover. extractClassesWithMeta().classes must match extractClasses()
    // exactly for every one of them, since it runs through the exact same
    // extractClassesCore(..., false) code path.
    const fixtures: string[] = [
      '<div className="p-4 flex bg-zd-black">',
      "<div class='p-4 flex'>",
      "<div className={'gap-4 hidden'}>",
      '<div className={`px-6 relative`}>',
      `<div class:list={["p-4 flex", 'bg-gray-500']}>`,
      `<div class:list={[cn('p-4')]}>`,
      `<div class:list={["p-4']}>`,
      `<div class:list={[\n  "p-4 flex",\n  'bg-gray-500',\n]}>`,
      `const cls = cn("p-4 flex", 'bg-zd-black');`,
      `const cls = cn(\n  "p-4",\n  isActive && "bg-blue-500",\n  className,\n);`,
      `const cls = cn(\n  "p-4)",\n  "m-8"\n);`,
      `const cls = cn(cond ? 'p-2' : cx('p-4'));`,
      `/* design-token-lint-ignore */\n<div className="p-4 flex">`,
      `{/* design-token-lint-ignore */}\n<div className="p-4 flex">`,
      `// design-token-lint-ignore\n<div className="p-4 flex">`,
      `// design-token-lint-ignore-file\n<div className="p-4">\n<div className="m-8">`,
      `/* design-token-lint-ignore */\n<div className="p-4">\n<div className="m-8">`,
      `/* design-token-lint-ignore - vendor requires literal p-4 */\n<div className="p-4">`,
      `{/* design-token-lint-ignore — vendor requires literal p-4 */}\n<div className="p-4">`,
      `// design-token-lint-ignore - vendor requires literal p-4\n<div className="p-4">`,
      `<div className="p-4"> {/* design-token-lint-ignore */}\n<div className="m-8">\n<div className="gap-2">`,
      `{/* design-token-lint-ignore */}\n<div className="p-4">\n<div className="m-8">`,
      `<div\n  className="p-4\n  // design-token-lint-ignore\n  m-8"\n/>`,
      `<div\n  className="p-4\n  {/* design-token-lint-ignore */}\n  m-8"\n/>`,
      `const cls = cn(\n  "flex",\n  // design-token-lint-ignore\n  "p-4",\n  "m-8",\n);`,
      `<div class:list={[\n  'flex',\n  // design-token-lint-ignore\n  'p-4',\n  'm-8',\n]}>`,
      `/* design-token-lint-ignore-file */\n<div className="p-4 flex">\n<div class="m-8">`,
      `<div className="p-4 flex">\n/* design-token-lint-ignore-file */\n<div class="m-8">`,
      `<div className="p-4">\n  <p>Use /* design-token-lint-ignore-file */ to skip</p>\n</div>`,
      `<div\n  className="p-4\n    bg-gray-500\n    m-8"\n/>`,
      `<div className="p-4\n  m-2\n  flex\n  items-center\n  gap-4"\n/>`,
      '<div className="p-4\n  m-8" id="x"><span className="gap-4">',
      `// design-token-lint-ignore\n<div className="p-4\n  m-8"\n/>\n<span className="flex">text</span>`,
    ];

    it.each(fixtures.map((content, i) => [i, content] as const))(
      'fixture %i matches extractClasses()',
      (_i, content) => {
        expect(extractClassesWithMeta(content).classes).toEqual(extractClasses(content));
      },
    );
  });

  describe('reasonText across the three comment styles', () => {
    it('captures reason text from // line comment', () => {
      const content = `// design-token-lint-ignore - vendor requires literal p-4\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toHaveLength(1);
      expect(ignores[0].reasonText).toBe('vendor requires literal p-4');
    });

    it('captures reason text from /* */ block comment', () => {
      const content = `/* design-token-lint-ignore - vendor requires literal p-4 */\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toHaveLength(1);
      expect(ignores[0].reasonText).toBe('vendor requires literal p-4');
    });

    it('captures reason text from {/* */} JSX comment (em dash separator)', () => {
      const content = `{/* design-token-lint-ignore — vendor requires literal p-4 */}\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toHaveLength(1);
      expect(ignores[0].reasonText).toBe('vendor requires literal p-4');
    });

    it('reasonText is null when no reason text is present (// style)', () => {
      const content = `// design-token-lint-ignore\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toHaveLength(1);
      expect(ignores[0].reasonText).toBeNull();
    });

    it('reasonText is null when no reason text is present (/* */ style)', () => {
      const content = `/* design-token-lint-ignore */\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toHaveLength(1);
      expect(ignores[0].reasonText).toBeNull();
    });

    it('reasonText is null when no reason text is present ({/* */} style)', () => {
      const content = `{/* design-token-lint-ignore */}\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toHaveLength(1);
      expect(ignores[0].reasonText).toBeNull();
    });
  });

  describe('kind and targetLine', () => {
    it('reports kind: next-line for an ignore comment alone on its own line', () => {
      const content = `/* design-token-lint-ignore */\n<div className="p-4">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toEqual([
        {
          line: 1,
          kind: 'next-line',
          reasonText: null,
          targetLine: 2,
          suppressedClasses: [{ className: 'p-4', line: 2 }],
        },
      ]);
    });

    it('reports both same-line and next-line records for a trailing ignore comment', () => {
      const content = `<div className="p-4"> {/* design-token-lint-ignore */}\n<div className="m-8">\n<div className="gap-2">`;
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toEqual([
        {
          line: 1,
          kind: 'same-line',
          reasonText: null,
          targetLine: 1,
          suppressedClasses: [{ className: 'p-4', line: 1 }],
        },
        {
          line: 1,
          kind: 'next-line',
          reasonText: null,
          targetLine: 2,
          suppressedClasses: [{ className: 'm-8', line: 2 }],
        },
      ]);
    });

    it('reports kind: file for a file-level ignore, with the full-file candidate set suppressed', () => {
      const content = `/* design-token-lint-ignore-file */\n<div className="p-4 flex">\n<div class="m-8">`;
      const { classes, ignores } = extractClassesWithMeta(content);
      expect(classes).toEqual([]);
      expect(ignores).toEqual([
        {
          line: 1,
          kind: 'file',
          reasonText: null,
          targetLine: 0,
          suppressedClasses: [
            { className: 'p-4', line: 2 },
            { className: 'flex', line: 2 },
            { className: 'm-8', line: 3 },
          ],
        },
      ]);
    });

    it('reports kind: file when the file-level comment is mid-file', () => {
      const content = `<div className="p-4 flex">\n/* design-token-lint-ignore-file */\n<div class="m-8">`;
      const { classes, ignores } = extractClassesWithMeta(content);
      expect(classes).toEqual([]);
      expect(ignores).toEqual([
        {
          line: 2,
          kind: 'file',
          reasonText: null,
          targetLine: 0,
          suppressedClasses: [
            { className: 'p-4', line: 1 },
            { className: 'flex', line: 1 },
            { className: 'm-8', line: 3 },
          ],
        },
      ]);
    });

    it('returns no ignore records when the file has no ignore comments', () => {
      const content = '<div className="p-4 flex">';
      const { ignores } = extractClassesWithMeta(content);
      expect(ignores).toEqual([]);
    });

    it('does not misread a non-alone design-token-lint-ignore-file mention as a bare line-ignore with reason "-file"', () => {
      // IGNORE_FILE_PATTERNS only matches when the comment is ALONE on its
      // line, so this mid-sentence mention isn't a real file-level ignore —
      // but the unanchored block-comment line-ignore pattern used to also
      // match it (its `\b` boundary was satisfied right before "-file"),
      // producing a bogus same-line/next-line record with reasonText "file".
      const content = `<div className="p-4">
  <p>Use /* design-token-lint-ignore-file */ to skip</p>
</div>
<div className="m-8">`;
      const { classes, ignores } = extractClassesWithMeta(content);
      expect(classes).toEqual([
        { className: 'p-4', line: 1 },
        { className: 'm-8', line: 4 },
      ]);
      expect(ignores).toEqual([]);
    });
  });

  describe('suppressed-candidate attribution for a multiline construct swallowed by one ignore', () => {
    it('attributes every line of a multiline attribute to the single next-line ignore that swallowed it', () => {
      const content = `// design-token-lint-ignore\n<div className="p-4\n  m-8"\n/>\n<span className="flex">text</span>`;
      const { classes, ignores } = extractClassesWithMeta(content);
      expect(classes).toEqual([{ className: 'flex', line: 5 }]);
      expect(ignores).toEqual([
        {
          line: 1,
          kind: 'next-line',
          reasonText: null,
          targetLine: 2,
          suppressedClasses: [
            { className: 'p-4', line: 2 },
            { className: 'm-8', line: 3 },
          ],
        },
      ]);
    });

    it('suppresses inner cn() argument lines individually without touching unrelated arguments', () => {
      const content = `const cls = cn(\n  "flex",\n  // design-token-lint-ignore\n  "p-4",\n  "m-8",\n);`;
      const { classes, ignores } = extractClassesWithMeta(content);
      expect(classes).toEqual([
        { className: 'flex', line: 2 },
        { className: 'm-8', line: 5 },
      ]);
      expect(ignores).toEqual([
        {
          line: 3,
          kind: 'next-line',
          reasonText: null,
          targetLine: 4,
          suppressedClasses: [{ className: 'p-4', line: 4 }],
        },
      ]);
    });
  });

  describe('ExtractorOptions passthrough', () => {
    it('respects custom classAttributes/classFunctions like extractClasses()', () => {
      const content = '<div inputClassName="p-4">';
      const { classes } = extractClassesWithMeta(content, { classAttributes: ['inputClassName'] });
      expect(classes).toEqual([{ className: 'p-4', line: 1 }]);
    });
  });
});
