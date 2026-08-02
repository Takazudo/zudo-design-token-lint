# Doc site pre-migration baseline

Captured before the 4.x doc-rescaffold (issues #144 / #145) touched anything.
Built with the pre-migration stack: `@takazudo/zfb@0.1.0-next.76`,
`@takazudo/zudo-doc@^2.5.1`. This file is the parity yardstick for Waves 4-6
and is removed by the Wave-6 confirm sub once parity is confirmed.

Captured via `pnpm build:doc` at commit `b73862d` (branch point) on 2026-08-02.

## Route manifest

`find dist -name "*.html" | sort` — 53 HTML files total: 1 `404.html`,
29 EN routes (including `/index.html`), 23 JA routes (under `/ja/`, no
`/ja/404.html` — 404 is locale-agnostic).

Non-HTML dist output: `_worker.js`, `_zfb_inner.mjs`, `.assetsignore`,
`llms.txt`, `llms-full.txt`, `robots.txt`, `search-index.json`, `sitemap.xml`.

```
dist/404.html
dist/docs/changelog/index.html
dist/docs/changelog/v0.1.0/index.html
dist/docs/changelog/v0.2.0/index.html
dist/docs/changelog/v1.0.0/index.html
dist/docs/changelog/v1.1.0-next.1/index.html
dist/docs/changelog/v1.1.0-next.2/index.html
dist/docs/changelog/v1.1.0-next.3/index.html
dist/docs/claude-md/doc--src--content/index.html
dist/docs/claude-md/root/index.html
dist/docs/claude-skills/l-make-release/index.html
dist/docs/claude-skills/zudo-doc-design-system/index.html
dist/docs/claude-skills/zudo-doc-translate/index.html
dist/docs/claude-skills/zudo-doc-version-bump/index.html
dist/docs/claude/index.html
dist/docs/guide/cli/index.html
dist/docs/guide/configuration/index.html
dist/docs/guide/examples/index.html
dist/docs/guide/ignore-syntax/index.html
dist/docs/guide/index.html
dist/docs/overview/contribution/index.html
dist/docs/overview/getting-started/index.html
dist/docs/overview/index.html
dist/docs/overview/what-is/index.html
dist/docs/playground/index.html
dist/docs/reference/api/index.html
dist/docs/reference/index.html
dist/docs/reference/limitations/index.html
dist/docs/reference/methodology/index.html
dist/index.html
dist/ja/docs/changelog/index.html
dist/ja/docs/changelog/v0.1.0/index.html
dist/ja/docs/changelog/v0.2.0/index.html
dist/ja/docs/changelog/v1.0.0/index.html
dist/ja/docs/changelog/v1.1.0-next.1/index.html
dist/ja/docs/changelog/v1.1.0-next.2/index.html
dist/ja/docs/changelog/v1.1.0-next.3/index.html
dist/ja/docs/claude/index.html
dist/ja/docs/guide/cli/index.html
dist/ja/docs/guide/configuration/index.html
dist/ja/docs/guide/examples/index.html
dist/ja/docs/guide/ignore-syntax/index.html
dist/ja/docs/guide/index.html
dist/ja/docs/overview/contribution/index.html
dist/ja/docs/overview/getting-started/index.html
dist/ja/docs/overview/index.html
dist/ja/docs/overview/what-is/index.html
dist/ja/docs/playground/index.html
dist/ja/docs/reference/api/index.html
dist/ja/docs/reference/index.html
dist/ja/docs/reference/limitations/index.html
dist/ja/docs/reference/methodology/index.html
dist/ja/index.html
```

Build log also confirmed 3 user `pages/` routes shadow package routes
(`/docs/[[...slug]]`, `/[locale]`, `/[locale]/docs/[[...slug]]`) plus 2
package-only routes (`/404`, `/sitemap.xml`, `/robots.txt`) — `zfb build`
reported `55 pages built` (HTML pages + the two non-HTML package routes).

## Head `<link>` tags (unique shapes, page-specific `href` values stripped)

```html
<link rel="canonical" href="..."/>
<link rel="icon" href="..." sizes="any"/>
<link rel="icon" type="image/png" sizes="16x16" href="..."/>
<link rel="icon" type="image/png" sizes="32x32" href="..."/>
<link rel="stylesheet" href="...">
```

## Head `<meta>` tags (unique shapes, page-specific `content` values stripped)

```html
<meta charset="utf-8"/>
<meta name="description" content="..."/>
<meta name="robots" content="..."/>
<meta name="twitter:card" content="..."/>
<meta name="twitter:image" content="..."/>
<meta name="viewport" content="..."/>
<meta name="zfb-preserve-html-attrs" content="..."/>
<meta name="zfb-view-transitions-enabled" content="..."/>
<meta name="zfb-view-transitions-fallback" content="..."/>
<meta property="og:description" content="..."/>
<meta property="og:image" content="..."/>
<meta property="og:image:alt" content="..."/>
<meta property="og:image:height" content="..."/>
<meta property="og:image:width" content="..."/>
<meta property="og:site_name" content="..."/>
<meta property="og:title" content="..."/>
<meta property="og:type" content="..."/>
<meta property="og:url" content="..."/>
```

Note: no `twitter:site` / `twitter:creator` meta tags in the current build —
the pre-migration hand-built config doesn't emit them. The Wave-1 preset
(`doc/setup-preset.json`) sets `metaTags.twitterCreator`, so the 4.5.0 build
is expected to add a `twitter:creator` tag that wasn't present before; this
is an intentional preset choice, not a parity regression.

## Island inventory (both `data-zfb-island` and `data-zfb-island-skip-ssr`)

`grep -rohE 'data-zfb-island(-skip-ssr)?="[^"]*"' dist -r | sort -u`:

```
data-zfb-island-skip-ssr="DocHistory"
data-zfb-island-skip-ssr="ImageEnlarge"
data-zfb-island-skip-ssr="MermaidEnlarge"
data-zfb-island-skip-ssr="Playground"
data-zfb-island="ClientRouterBootstrap"
data-zfb-island="DesktopSidebarToggle"
data-zfb-island="MobileToc"
data-zfb-island="SidebarToggle"
data-zfb-island="SidebarTree"
data-zfb-island="SiteTreeNav"
data-zfb-island="ThemeToggle"
data-zfb-island="Toc"
```

12 distinct islands total: 4 skip-SSR (`DocHistory`, `ImageEnlarge`,
`MermaidEnlarge`, `Playground`) and 8 regular SSR-hydrated islands.
