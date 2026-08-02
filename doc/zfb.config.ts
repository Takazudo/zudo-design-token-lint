import { defineConfig } from 'zfb/config';
import { zudoDoc } from '@takazudo/zudo-doc/config';

export default defineConfig(
  zudoDoc({
    themePack: 'bauhaus',
    siteName: 'Design Token Lint',
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
    // Versioning (newly enabled): the `versions` array holds OLDER snapshots
    // only — the current/latest docs always live at the default docsDir and
    // are never listed here (zudo-doc versioning guide). "1.0" archives the
    // pre-rescaffold docs content (last stable npm release before this
    // 4.x rescaffold) as of this commit, frozen under src/content/docs-v1.0(-ja)
    // so Wave 3/4's rewrite of src/content/docs/ doesn't lose it.
    //
    // Known upstream bug (zudo-doc@4.5.0): the `<CategoryNav>` MDX component
    // renders unversioned links on /v/1.0/ pages (its category-index cards
    // point at the default docs instead of the v1.0 archive) because
    // `createCategoryNavWrapper` never threads `currentVersion` through,
    // unlike the sidebar/header nav which do this correctly. Not fixable
    // from this repo — filed as zudolab/zudo-doc#3194.
    //
    // Also upstream (zudo-doc@4.5.0): the version switcher offers a v1.0 link
    // for slugs that exist only in the latest docs (changelog v1.1.0-next.*,
    // the generated /docs/claude* tree), which 404s — the VersionSwitcher
    // component supports unavailableVersions but buildInlineVersionSwitcher
    // never computes it. Not fixable host-side — filed as zudolab/zudo-doc#3196.
    versions: [
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
    headerRightItems: [
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
      {
        type: 'component',
        component: 'version-switcher',
      },
    ],
    // Cloudflare adapter — required for the Workers deploy (dist/_worker.js) and
    // any non-prerendered package-owned routes. Bindings come from wrangler.toml.
    adapter: '@takazudo/zfb-adapter-cloudflare',
  }),
);
