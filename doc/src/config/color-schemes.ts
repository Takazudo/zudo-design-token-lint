/** A color reference: palette index (number) or direct color value (string) */
export type ColorRef = number | string;

export interface ColorScheme {
  background: ColorRef;
  foreground: ColorRef;
  cursor: ColorRef;
  selectionBg: ColorRef;
  selectionFg: ColorRef;
  palette: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
  /** Optional, vestigial. Carried only in the optional color-scheme config
   *  envelope consumed by the design token panel tooling (falls back to
   *  DEFAULT_SHIKI_THEME when omitted), but has no visible effect: that
   *  tooling's Shiki integration is a no-op stub, and page code highlighting is
   *  done by syntect (dual-theme, configured via `codeHighlight` in
   *  zfb.config.ts), not Shiki. */
  shikiTheme?: string;
  /** Optional semantic overrides — when omitted, defaults are used:
   *  surface=p0, muted=p8, accent=p5, accentHover=p14
   *  codeBg=p10, codeFg=p11, success=p2, danger=p1, warning=p3, info=p4
   *  Each field accepts a palette index (number) or a direct color value (string). */
  semantic?: {
    surface?: ColorRef;
    muted?: ColorRef;
    accent?: ColorRef;
    accentHover?: ColorRef;
    codeBg?: ColorRef;
    codeFg?: ColorRef;
    success?: ColorRef;
    danger?: ColorRef;
    warning?: ColorRef;
    info?: ColorRef;
    mermaidNodeBg?: ColorRef;
    mermaidText?: ColorRef;
    mermaidLine?: ColorRef;
    mermaidLabelBg?: ColorRef;
    mermaidNoteBg?: ColorRef;
    chatUserBg?: ColorRef;
    chatUserText?: ColorRef;
    chatAssistantBg?: ColorRef;
    chatAssistantText?: ColorRef;
    /** UI chrome over user images — enlarge/close overlay buttons */
    imageOverlayBg?: ColorRef;
    imageOverlayFg?: ColorRef;
    /** <mark> highlight for matched keywords in search results */
    matchedKeywordBg?: ColorRef;
    matchedKeywordFg?: ColorRef;
  };
}

/**
 * Standard palette index convention (all schemes should follow this):
 *
 * | Index | Role              | Description                              |
 * |-------|-------------------|------------------------------------------|
 * | p0    | Dark surface      | Deepest surface (code blocks, mermaid)   |
 * | p1    | Danger            | Red family — errors, destructive actions  |
 * | p2    | Success           | Green family — confirmations, tips        |
 * | p3    | Warning           | Yellow/amber — caution messages           |
 * | p4    | Info              | Blue family — informational highlights    |
 * | p5    | Accent            | Primary interactive color (links, CTA)    |
 * | p6    | Neutral           | Slate/cyan — borders, secondary elements  |
 * | p7    | Secondary neutral | Gray or muted accent                      |
 * | p8    | Muted             | Gray — borders, secondary text, comments  |
 * | p9    | Background        | Page background                           |
 * | p10   | Surface           | Elevated surface (panels, sidebars)       |
 * | p11   | Text primary      | Main body text                            |
 * | p12   | Accent variant    | Brighter or alternate accent              |
 * | p13   | Decorative        | Purple/lavender — non-semantic decoration  |
 * | p14   | Accent hover      | Hover state for interactive elements      |
 * | p15   | Text secondary    | Secondary text or muted foreground         |
 */
export const colorSchemes: Record<string, ColorScheme> = {
  "Default Light": {
    background: 9,
    foreground: 11,
    cursor: 6,
    selectionBg: 11,
    selectionFg: 10,
    palette: [
      "oklch(0.309 0.000 0.00)" /* #303030 */, "oklch(0.453 0.172 27.68)" /* #a01515 */, "oklch(0.398 0.090 147.43)" /* #1f5429 */, "oklch(0.451 0.130 23.94)" /* #903030 */,  // p0-3: dark surface, danger, success, warning — darkened for WCAG AA (#2298)
      "oklch(0.441 0.144 258.56)" /* #174fa0 */, "oklch(0.453 0.0997 61.17)" /* #7d470b */, "oklch(0.704 0.040 256.99)" /* #90a1b9 */, "oklch(0.472 0.089 71.81)" /* #7a5218 */,  // p4-7: info, accent, neutral, secondary — darkened for WCAG AA (#2298)
      "oklch(0.528 0.000 0.00)" /* #6b6b6b */, "oklch(0.901 0.007 53.44)" /* #e2ddda */, "oklch(0.936 0.003 17.22)" /* #ece9e9 */, "oklch(0.309 0.000 0.00)" /* #303030 */,  // p8-11: muted, background, surface, text
      "oklch(0.670 0.119 251.69)" /* #5b99dc */, "oklch(0.749 0.106 300.21)" /* #b89ee7 */, "oklch(0.650 0.027 257.67)" /* #8590a0 */, "oklch(0.417 0.0755 72.95)" /* #654516 */,  // p12-15: accent variant, decorative, hover, muted foreground
    ],
    semantic: {
      surface: 10,
      muted: "oklch(0.492 0.000 0.00)" /* upstream #6b6b6b (p8) → L-0.036 for AA (scheme-a11y #2489) */, // muted-vs-bg → 4.61:1
      accent: 5,
      accentHover: "oklch(0.492 0.027 257.67)" /* upstream #8590a0 (p14) → L-0.158, C-0.000 for AA (scheme-a11y #2489) */, // accent-hover-vs-bg → 4.61:1
      codeBg: 10,
      codeFg: 11,
      success: 2,
      danger: 1,
      warning: 3,
      info: 4,
      mermaidNoteBg: "oklch(0.821 0.007 53.44)" /* derived bg-elevated from bg (p9) — default (p0) collided 1:1 with mermaidText/p11 (scheme-a11y #2489) */,
      imageOverlayBg: 11,
      imageOverlayFg: 10,
      matchedKeywordBg: "oklch(0.959 0.109 102.63)" /* #fff59d */,
      matchedKeywordFg: "oklch(0.000 0.000 0.00)" /* #000000 */,
    },
  },
  "Default Dark": {
    background: 9,
    foreground: 15,
    cursor: 6,
    selectionBg: 10,
    selectionFg: 11,
    palette: [
      "oklch(0.226 0.000 0.00)" /* #1c1c1c */, "oklch(0.656 0.143 16.99)" /* #da6871 */, "oklch(0.746 0.103 133.16)" /* #93bb77 */, "oklch(0.809 0.096 82.54)" /* #dfbb77 */,  // p0-3: dark surface, danger, success, warning
      "oklch(0.714 0.120 245.01)" /* #5caae9 */, "oklch(0.677 0.160 318.34)" /* #c074d6 */, "oklch(0.704 0.040 256.99)" /* #90a1b9 */, "oklch(0.706 0.000 0.00)" /* #a0a0a0 */,  // p4-7: info, accent, neutral, secondary
      "oklch(0.627 0.000 0.00)" /* #888888 */, "oklch(0.209 0.000 0.00)" /* #181818 */, "oklch(0.341 0.000 0.00)" /* #383838 */, "oklch(0.907 0.000 0.00)" /* #e0e0e0 */,   // p8-11: muted, background, surface, text
      "oklch(0.733 0.099 61.25)" /* #d69a66 */, "oklch(0.677 0.160 318.34)" /* #c074d6 */, "oklch(0.801 0.057 256.82)" /* #a7c0e3 */, "oklch(0.783 0.000 0.00)" /* #b8b8b8 */,  // p12-15: accent variant, decorative, hover, text secondary
    ],
    semantic: {
      surface: 0,
      muted: "oklch(0.657 0.000 0.00)" /* upstream #888888 (p8) → L+0.030 for AA (scheme-a11y #2489) */, // muted-vs-{bg,codeBg,chatAssistantBg} → 4.62:1
      accent: 12,
      accentHover: 14,
      codeBg: "oklch(0.281 0.000 0.00)" /* upstream #383838 (p10) → L-0.060 toward bg for muted-vs-codeBg AA (rendered-bg #2510) */,
      codeFg: 11,
      success: 2,
      danger: "oklch(0.662 0.143 16.99)" /* upstream #da6871 → L+0.006 for AA (scheme-a11y #2489) */, // admonition-danger → 4.61:1
      warning: 3,
      info: 4,
      imageOverlayBg: 0,
      imageOverlayFg: 11,
      matchedKeywordBg: "oklch(0.959 0.109 102.63)" /* #fff59d */,
      matchedKeywordFg: "oklch(0.000 0.000 0.00)" /* #000000 */,
    },
  },
};
