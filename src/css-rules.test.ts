import { describe, it, expect } from 'vitest';
import { checkDeclaration, type CompiledCssConfig } from './css-rules.js';
import type { CssDeclaration } from './css-extractor.js';

const BOTH: CompiledCssConfig = { zIndex: true, colorLiterals: true, patterns: [] };
const Z_ONLY: CompiledCssConfig = { zIndex: true, colorLiterals: false, patterns: [] };
const COLOR_ONLY: CompiledCssConfig = { zIndex: false, colorLiterals: true, patterns: [] };
const OFF: CompiledCssConfig = { zIndex: false, colorLiterals: false, patterns: [] };

function decl(property: string, value: string, line = 1): CssDeclaration {
  return { property, value, line };
}

describe('checkDeclaration — zIndex rule', () => {
  it('flags a bare integer z-index', () => {
    const v = checkDeclaration(decl('z-index', '9999'), Z_ONLY);
    expect(v).not.toBeNull();
    expect(v!.className).toBe('z-index: 9999');
    expect(v!.category).toBe('z-index');
    expect(v!.reason).toContain('9999');
  });

  it('flags a negative integer z-index', () => {
    expect(checkDeclaration(decl('z-index', '-1'), Z_ONLY)).not.toBeNull();
  });

  it('flags a bare integer with !important', () => {
    expect(checkDeclaration(decl('z-index', '9999 !important'), Z_ONLY)).not.toBeNull();
  });

  it('passes z-index: var(--z-toast)', () => {
    expect(checkDeclaration(decl('z-index', 'var(--z-toast)'), Z_ONLY)).toBeNull();
  });

  it('passes z-index: calc(var(--z-modal) + 1)', () => {
    expect(checkDeclaration(decl('z-index', 'calc(var(--z-modal) + 1)'), Z_ONLY)).toBeNull();
  });

  it.each(['auto', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'AUTO'])(
    'passes keyword z-index: %s',
    (kw) => {
      expect(checkDeclaration(decl('z-index', kw), Z_ONLY)).toBeNull();
    },
  );

  it('does not flag a non-z-index numeric property', () => {
    expect(checkDeclaration(decl('order', '3'), Z_ONLY)).toBeNull();
  });

  it('is case-insensitive on the property name', () => {
    expect(checkDeclaration(decl('Z-Index', '5'), Z_ONLY)).not.toBeNull();
  });

  it('does nothing when zIndex is disabled', () => {
    expect(checkDeclaration(decl('z-index', '9999'), COLOR_ONLY)).toBeNull();
    expect(checkDeclaration(decl('z-index', '9999'), OFF)).toBeNull();
  });
});

describe('checkDeclaration — colorLiterals rule', () => {
  it('flags a #hex literal', () => {
    const v = checkDeclaration(decl('background', '#ffe4e4'), COLOR_ONLY);
    expect(v).not.toBeNull();
    expect(v!.className).toBe('background: #ffe4e4');
    expect(v!.category).toBe('color');
    expect(v!.reason).toContain('#ffe4e4');
  });

  it.each([
    ['color', 'rgb(1,2,3)'],
    ['color', 'rgba(1,2,3,0.5)'],
    ['color', 'hsl(0 95% 92%)'],
    ['color', 'hsla(0, 95%, 92%, 0.5)'],
    ['color', 'oklch(45% 0.18 27)'],
    ['color', 'oklab(45% 0.1 0.1)'],
    ['background', '#fff'],
    ['background', '#ffffff'],
    ['background', '#ffffff80'],
  ])('flags %s: %s', (prop, value) => {
    expect(checkDeclaration(decl(prop, value), COLOR_ONLY)).not.toBeNull();
  });

  it('reports the functional color call in the reason', () => {
    const v = checkDeclaration(decl('color', 'rgb(1, 2, 3)'), COLOR_ONLY);
    expect(v!.reason).toContain('rgb(1, 2, 3)');
  });

  it.each([
    ['color', 'var(--fg)'],
    ['color', 'var(--fg, var(--fallback))'],
    ['color', 'transparent'],
    ['color', 'currentColor'],
    ['color', 'inherit'],
    ['color', 'red'],
    ['display', 'flex'],
    ['background', 'none'],
  ])('passes %s: %s', (prop, value) => {
    expect(checkDeclaration(decl(prop, value), COLOR_ONLY)).toBeNull();
  });

  it('skips custom-property declarations (documented Pass-2 false negative)', () => {
    expect(checkDeclaration(decl('--brand', '#f00'), COLOR_ONLY)).toBeNull();
  });

  it('skips SCSS $-variable declarations', () => {
    expect(checkDeclaration(decl('$brand', '#f00'), COLOR_ONLY)).toBeNull();
  });

  it('does not flag an SVG url(#id) reference as a hex color', () => {
    // `#gradient` is not valid hex (g is out of range), and #id fragments in
    // url() are not hex literals.
    expect(checkDeclaration(decl('fill', 'url(#gradient)'), COLOR_ONLY)).toBeNull();
  });

  it('does nothing when colorLiterals is disabled', () => {
    expect(checkDeclaration(decl('background', '#fff'), Z_ONLY)).toBeNull();
    expect(checkDeclaration(decl('background', '#fff'), OFF)).toBeNull();
  });
});

describe('checkDeclaration — precedence', () => {
  it('reports z-index before color when both could apply', () => {
    // Contrived: property is z-index and value is a bare integer; color rule
    // would never match an integer anyway, but this pins the ordering.
    const v = checkDeclaration(decl('z-index', '10'), BOTH);
    expect(v!.category).toBe('z-index');
  });
});
