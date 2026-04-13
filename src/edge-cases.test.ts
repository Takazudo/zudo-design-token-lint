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
