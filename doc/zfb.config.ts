import { defineConfig } from 'zfb/config';
import { zudoDoc } from '@takazudo/zudo-doc/config';

export default defineConfig(
  zudoDoc({
    themePack: 'bauhaus',
    siteName: 'Design Token Lint',
    // Home-hero logo: the site's own mark (theme-adaptive mask render).
    // Without this, zudo-doc 4.x defaults to `"auto"` — a generated
    // placeholder plate that replaced our real logo after the rescaffold.
    logo: '/img/logo.svg',
    siteDescription: 'Forbids Tailwind classes that violate design token rules',
    siteUrl: 'https://zudo-design-token-lint.takazudomodular.com',
    locales: {
      ja: {
        label: 'JA',
        dir: 'src/content/docs-ja',
      },
    },
    githubUrl: 'https://github.com/Takazudo/zudo-design-token-lint',
    metaTags: {
      description: true,
      keywords: 'design token, Takazudo, lint, frontend, utility',
      ogImage: '/img/ogp.png',
      ogSiteName: true,
      twitterCard: 'summary_large_image',
      twitterCreator: '@Takazudo',
    },
    llmsTxt: true,
    cjkFriendly: true,
    // Host-callables channel — binds the `<Playground>` MDX tag (the live
    // browser lint demo). See src/chrome-bindings.tsx: the doc-route stubs
    // additionally import that module STATICALLY, because the virtual-module
    // path this setting creates is SSR-presentational only and cannot make an
    // island scanner-reachable.
    chromeBindingsModule: './src/chrome-bindings.tsx',
    designTokenPanel: true,
    sidebarResizer: true,
    sidebarToggle: true,
    imageEnlarge: true,
    dynamicPageTransition: true,
    docHistory: true,
    bodyFootUtilArea: {
      docHistory: true,
      viewSourceLink: true,
    },
    // Versioning: the `versions` array holds OLDER snapshots only — the
    // current/latest docs always live at the default docsDir and are never
    // listed here (zudo-doc versioning guide). Entries are newest-first; that
    // order is what the header switcher and /docs/versions/ render.
    //
    // Release-time snapshot practice: at each release, freeze the then-current
    // src/content/docs(-ja) into src/content/docs-v<X.Y>(-ja) and PREPEND an
    // entry here, so the released docs stay browsable at /v/<X.Y>/ after the
    // default docs move on. "2.0" is the first snapshot taken under this
    // practice — it pins v2.0.0, the current npm release. "1.0" predates the
    // practice: it archives the pre-rescaffold docs (last stable release
    // before the 4.x rescaffold), frozen so Wave 3/4's rewrite of
    // src/content/docs/ didn't lose them.
    //
    // A snapshot copies only git-TRACKED content. src/content/docs/claude* is
    // gitignored build output that the claude-resources plugin regenerates into
    // the DEFAULT docsDir on every build, and that plugin is version-unaware —
    // copying it in would commit build output and freeze a stale mirror of the
    // repo's .claude/. So snapshots carry no Claude section (same as "1.0").
    //
    // A snapshot is NOT a byte-copy of the docs: anything that reaches outside
    // the content dir has to be neutralised, or the "frozen" page silently
    // tracks HEAD. Concretely, playground/index.mdx drops the <Playground /> tag
    // for a link to the live one — the island binds to src/lib/lint-browser.ts,
    // an unversioned mirror of the CURRENT linter, so an archived page would
    // report results from a linter newer than its own label. "1.0" does the same
    // (for a different reason: its old island wiring no longer builds). Apply
    // the same treatment to any future live-data component before snapshotting.
    //
    // Banner: the versioning guide's "Creating a New Version" step says to set
    // `banner: 'unmaintained'` on a new snapshot, and that is right for every
    // entry EXCEPT the one whose label is still the current release. Telling a
    // reader on /v/2.0/ that they are "viewing an older version" is simply
    // false while 2.0.0 IS the latest — so 2.0 carries `banner: false` until
    // the next release lands. See the per-entry note below; that flip is the
    // one piece of this block that needs doing by hand.
    //
    // Known upstream bug (zudo-doc@4.5.0): the `<CategoryNav>` MDX component
    // renders unversioned links on /v/<slug>/ pages (its category-index cards
    // point at the default docs instead of the archive) because
    // `createCategoryNavWrapper` never threads `currentVersion` through,
    // unlike the sidebar/header nav which do this correctly. Applies to every
    // snapshot, 2.0 included. Not fixable from this repo — filed as
    // zudolab/zudo-doc#3194.
    //
    // Also upstream (zudo-doc@4.5.0): the version switcher offers a snapshot
    // link for slugs that exist only in the latest docs, which 404s — the
    // VersionSwitcher component supports unavailableVersions but
    // buildInlineVersionSwitcher never computes it. For 1.0 that is the
    // changelog v1.1.0-next.* pages and the generated /docs/claude* tree; for
    // 2.0 it is /docs/claude* today, plus any doc page added to Latest after
    // this snapshot. Not fixable host-side — filed as zudolab/zudo-doc#3196.
    versions: [
      {
        slug: '2.0',
        label: '2.0.0',
        docsDir: 'src/content/docs-v2.0',
        locales: {
          ja: { dir: 'src/content/docs-v2.0-ja' },
        },
        // FLIP TO 'unmaintained' WHEN A RELEASE AFTER 2.0.0 SHIPS. False only
        // because 2.0.0 is currently the latest release, so an "older version"
        // banner would be a lie. The moment 2.1/3.0 lands this snapshot really
        // is old, and without the banner it loses its only signal that the
        // reader is not on the current docs. Nothing enforces this flip yet —
        // it is a manual step at release time.
        banner: false,
      },
      {
        slug: '1.0',
        label: '1.0.0',
        docsDir: 'src/content/docs-v1.0',
        locales: {
          ja: { dir: 'src/content/docs-v1.0-ja' },
        },
        banner: 'unmaintained',
      },
    ],
    // Hybrid repo: this doc-app lives in `doc/` (cwd at build), while zdtl's
    // Claude resources live at the REPO ROOT, one level up. projectRoot "."
    // anchors claudeDir/docsDir resolution at the doc-app root (cwd = doc/);
    // omitting it lets the plugin substitute its own ctx.projectRoot, which
    // mis-resolves claudeDir and silently drops the skills (0 skill pages).
    // scanRoot ".." is the repo root, for CLAUDE.md discovery only. Do NOT
    // set projectRoot: ".." — that pushes claudeDir AND the docs output up
    // out of doc/ (into the repo-root linter src/).
    claudeResources: {
      claudeDir: '../.claude',
      projectRoot: '.',
      scanRoot: '..',
    },
    defaultLocaleOnlyPrefixes: [
      '/docs/claude-md/',
      '/docs/claude-skills/',
      '/docs/claude-agents/',
      '/docs/claude-commands/',
    ],
    footer: {
      links: [],
      copyright: `Copyright © ${new Date().getFullYear()} takazudo. Built with zudo-doc.`,
    },
    headerNav: [
      { label: 'Overview', path: '/docs/overview', categoryMatch: 'overview' },
      { label: 'Playground', path: '/docs/playground', categoryMatch: 'playground' },
      { label: 'Guide', path: '/docs/guide', categoryMatch: 'guide' },
      { label: 'Reference', path: '/docs/reference', categoryMatch: 'reference' },
      { label: 'Changelog', path: '/docs/changelog', categoryMatch: 'changelog' },
      { label: 'Claude', path: '/docs/claude', categoryMatch: 'claude' },
    ],
    // Rendered left-to-right in the header's right-hand cluster. The version
    // switcher leads so its wide "Version: <label>" pill sits at the cluster's
    // LEFT edge instead of the window edge.
    headerRightItems: [
      {
        type: 'component',
        component: 'version-switcher',
      },
      {
        type: 'component',
        component: 'github-link',
      },
      {
        type: 'component',
        component: 'theme-toggle',
      },
      {
        type: 'component',
        component: 'search',
      },
      {
        type: 'component',
        component: 'language-switcher',
      },
    ],
    // Cloudflare adapter — required for the Workers deploy (dist/_worker.js) and
    // any non-prerendered package-owned routes. Bindings come from wrangler.toml.
    adapter: '@takazudo/zfb-adapter-cloudflare',
  }),
);
