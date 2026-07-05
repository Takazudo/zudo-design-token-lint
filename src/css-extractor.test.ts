import { describe, it, expect } from 'vitest';
import {
  extractCssDeclarations,
  extractCssDeclarationsWithMeta,
  type CssDeclaration,
} from './css-extractor.js';

/** Convenience: map declarations to a compact `prop: value @line` form. */
function shape(decls: CssDeclaration[]): string[] {
  return decls.map((d) => `${d.property}: ${d.value} @${d.line}`);
}

describe('extractCssDeclarations — basic parsing', () => {
  it('extracts property/value/line from a simple rule', () => {
    const css = `.modal {
  position: fixed;
  z-index: 9999;
}`;
    expect(extractCssDeclarations(css)).toEqual([
      { property: 'position', value: 'fixed', line: 2 },
      { property: 'z-index', value: '9999', line: 3 },
    ]);
  });

  it('extracts the last declaration even without a trailing semicolon', () => {
    const css = `.a {
  color: red
}`;
    expect(extractCssDeclarations(css)).toEqual([{ property: 'color', value: 'red', line: 2 }]);
  });

  it('does not read selectors (with colons) as declarations', () => {
    const css = `a:hover {
  color: blue;
}`;
    // `a:hover` is a prelude, not a declaration — only `color: blue` is yielded.
    expect(extractCssDeclarations(css)).toEqual([{ property: 'color', value: 'blue', line: 2 }]);
  });

  it('attributes each declaration to its own line', () => {
    const css = `.a {\n  top: 0;\n  left: 0;\n  right: 0;\n}`;
    expect(extractCssDeclarations(css).map((d) => d.line)).toEqual([2, 3, 4]);
  });

  it('yields custom-property declarations (rule kinds filter them, not the extractor)', () => {
    const css = `:root {\n  --brand: #f00;\n}`;
    expect(extractCssDeclarations(css)).toEqual([{ property: '--brand', value: '#f00', line: 2 }]);
  });

  it('handles multiple selectors and nested SCSS declarations', () => {
    const css = `.a {
  color: red;
  .b {
    color: blue;
  }
}`;
    expect(shape(extractCssDeclarations(css))).toEqual(['color: red @2', 'color: blue @4']);
  });

  it('parses a value spanning multiple lines as one declaration on its start line', () => {
    const css = `.a {
  background: linear-gradient(
    #fff,
    #000
  );
  color: red;
}`;
    const decls = extractCssDeclarations(css);
    expect(decls).toHaveLength(2);
    expect(decls[0].property).toBe('background');
    expect(decls[0].line).toBe(2);
    expect(decls[0].value).toContain('#fff');
    expect(decls[1]).toEqual({ property: 'color', value: 'red', line: 6 });
  });

  it('does not read at-rule preludes (media queries) as declarations', () => {
    const css = `@media (min-width: 700px) {
  .a {
    z-index: 5;
  }
}`;
    // `min-width: 700px` lives in the prelude — only `z-index: 5` is a declaration.
    expect(extractCssDeclarations(css)).toEqual([{ property: 'z-index', value: '5', line: 3 }]);
  });
});

describe('extractCssDeclarations — comment awareness (the main risk)', () => {
  it('never yields declarations inside a single-line block comment', () => {
    const css = `.a {
  /* z-index: 9999; background: #fff; */
  color: red;
}`;
    expect(extractCssDeclarations(css)).toEqual([{ property: 'color', value: 'red', line: 3 }]);
  });

  it('never yields declarations inside a MULTI-LINE block comment', () => {
    const css = `.a {
  /* commented out:
     z-index: 9999;
     background: #ffe4e4;
  */
  color: red;
}`;
    // Everything inside the /* ... */ span (lines 2-5) is inert.
    expect(extractCssDeclarations(css)).toEqual([{ property: 'color', value: 'red', line: 6 }]);
  });

  it('strips an inline block comment out of a value', () => {
    const css = `.a {
  z-index: /* tier */ 9999;
}`;
    expect(extractCssDeclarations(css)).toEqual([{ property: 'z-index', value: '9999', line: 2 }]);
  });

  it('does not treat a comment-looking sequence inside a string as a comment', () => {
    const css = `.a {
  content: "/* not a comment */";
  color: red;
}`;
    expect(shape(extractCssDeclarations(css))).toEqual([
      'content: "/* not a comment */" @2',
      'color: red @3',
    ]);
  });

  it('a block comment spanning into code does not swallow the following declaration', () => {
    const css = `.a {
  color: red; /* trailing
  spanning */ z-index: 5;
}`;
    // `z-index: 5` sits after the block comment closes on line 3.
    expect(shape(extractCssDeclarations(css))).toEqual(['color: red @2', 'z-index: 5 @3']);
  });
});

describe('extractCssDeclarations — string / paren / url edge cases', () => {
  it('does not split on a semicolon inside url(data:...)', () => {
    const css = `.a {
  background: url(data:image/png;base64,AAAA);
  color: red;
}`;
    expect(shape(extractCssDeclarations(css))).toEqual([
      'background: url(data:image/png;base64,AAAA) @2',
      'color: red @3',
    ]);
  });

  it('does not split on delimiters inside a string value', () => {
    const css = `.a {
  content: "a; b { c }";
  color: red;
}`;
    expect(shape(extractCssDeclarations(css))).toEqual([
      'content: "a; b { c }" @2',
      'color: red @3',
    ]);
  });

  it('keeps the first colon as the property separator (url with scheme)', () => {
    const css = `.a {
  background: url(http://example.com/x.png);
}`;
    expect(extractCssDeclarations(css)).toEqual([
      { property: 'background', value: 'url(http://example.com/x.png)', line: 2 },
    ]);
  });
});

describe('extractCssDeclarations — SCSS line comments', () => {
  it('treats // as a comment only when scss:true', () => {
    const scss = `.a {
  color: red; // z-index: 9999;
}`;
    // scss mode: everything after // is a comment.
    expect(extractCssDeclarations(scss, { scss: true })).toEqual([
      { property: 'color', value: 'red', line: 2 },
    ]);
  });

  it('does NOT treat // as a comment in plain css mode', () => {
    const css = `.a {
  color: red;
}`;
    // Sanity: default (css) mode leaves this alone; no // here anyway.
    expect(extractCssDeclarations(css)).toEqual([{ property: 'color', value: 'red', line: 2 }]);
  });

  it('does not treat // inside url() as an scss line comment', () => {
    const scss = `.a {
  background: url(http://example.com/x.png);
  color: red;
}`;
    expect(shape(extractCssDeclarations(scss, { scss: true }))).toEqual([
      'background: url(http://example.com/x.png) @2',
      'color: red @3',
    ]);
  });
});

describe('extractCssDeclarations — ignore comments', () => {
  it('next-line: a directive on its own line suppresses the following declaration', () => {
    const css = `.a {
  /* design-token-lint-ignore */
  z-index: 9999;
}`;
    expect(extractCssDeclarations(css)).toEqual([]);
  });

  it('same-line: a trailing directive suppresses its own line AND the next line (class-side parity)', () => {
    // Matching the Tailwind extractor (#123): a directive that is NOT alone on
    // its line suppresses both its own line and the following line. Here line 2
    // (own) and line 3 (next) are both suppressed; line 4 is unaffected.
    const css = `.a {
  z-index: 9999; /* design-token-lint-ignore */
  background: #fff;
  color: red;
}`;
    expect(extractCssDeclarations(css)).toEqual([{ property: 'color', value: 'red', line: 4 }]);
  });

  it('tolerates and does not choke on a trailing reason after the directive', () => {
    const css = `.a {
  /* design-token-lint-ignore - legacy widget, tracked at #123 */
  z-index: 9999;
}`;
    expect(extractCssDeclarations(css)).toEqual([]);
  });

  it('a next-line directive only suppresses the immediately following line', () => {
    const css = `.a {
  /* design-token-lint-ignore */
  z-index: 9999;
  background: #fff;
}`;
    expect(extractCssDeclarations(css)).toEqual([
      { property: 'background', value: '#fff', line: 4 },
    ]);
  });

  it('design-token-lint-ignore-file suppresses the whole file', () => {
    const css = `/* design-token-lint-ignore-file */
.a {
  z-index: 9999;
  background: #fff;
}`;
    expect(extractCssDeclarations(css)).toEqual([]);
  });
});

describe('extractCssDeclarationsWithMeta — #129-style metadata', () => {
  it('captures next-line kind + reason text', () => {
    const css = `.a {
  /* design-token-lint-ignore - because legacy */
  z-index: 9999;
}`;
    const { declarations, ignores } = extractCssDeclarationsWithMeta(css);
    expect(declarations).toEqual([]);
    expect(ignores).toHaveLength(1);
    expect(ignores[0]).toMatchObject({
      line: 2,
      kind: 'next-line',
      reasonText: 'because legacy',
      targetLine: 3,
    });
    expect(shape(ignores[0].suppressedDeclarations)).toEqual(['z-index: 9999 @3']);
  });

  it('a trailing directive yields both a same-line and a next-line record', () => {
    const css = `.a {
  z-index: 9999; /* design-token-lint-ignore */
  background: #fff;
}`;
    const { ignores } = extractCssDeclarationsWithMeta(css);
    expect(ignores.map((r) => r.kind)).toEqual(['same-line', 'next-line']);
    // same-line record claims its own line's suppressed declaration.
    expect(shape(ignores[0].suppressedDeclarations)).toEqual(['z-index: 9999 @2']);
  });

  it('reports a file-level ignore record', () => {
    const css = `/* design-token-lint-ignore-file */
.a { z-index: 9999; }`;
    const { declarations, ignores } = extractCssDeclarationsWithMeta(css);
    expect(declarations).toEqual([]);
    expect(ignores).toHaveLength(1);
    expect(ignores[0]).toMatchObject({ kind: 'file', targetLine: 0 });
    expect(shape(ignores[0].suppressedDeclarations)).toEqual(['z-index: 9999 @2']);
  });
});
