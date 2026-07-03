import { describe, it, expect } from 'vitest';
import { extractClasses } from './extractor.js';
import { checkClass } from './rules.js';

describe('edge cases', () => {
  describe('extractClasses', () => {
    it('extracts from inline comments in className attribute value', () => {
      const content = '<div className="p-4 /* should this be extracted? */">';
      const result = extractClasses(content);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((r) => r.className === 'p-4')).toBe(true);
    });

    it('extracts from multiple className attributes on same line', () => {
      const content = '<div className="p-4" className="m-8">';
      const result = extractClasses(content);
      expect(result.some((r) => r.className === 'p-4')).toBe(true);
      expect(result.some((r) => r.className === 'm-8')).toBe(true);
    });

    it('does not extract from template literal expressions', () => {
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
  });

  describe('checkClass', () => {
    it('flags fractional spacing values', () => {
      expect(checkClass('p-4.5')).not.toBeNull();
    });

    it('allows custom color names', () => {
      expect(checkClass('bg-custom-color')).toBeNull();
    });

    it('allows shade with non-numeric suffix', () => {
      expect(checkClass('bg-gray-500a')).toBeNull();
    });
  });
});
