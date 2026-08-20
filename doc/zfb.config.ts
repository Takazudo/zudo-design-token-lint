import { defineConfig } from 'zfb/config';
import { zudoDoc } from '@takazudo/zudo-doc/config';

export default defineConfig(
  zudoDoc({
    themePack: 'bauhaus',
    siteName: 'Design Token Lint',
    // Home-hero logo: the site's own mark (theme-adaptive mask render).
    // Keep this explicit so the generated fallback cannot replace the real
    // site mark.
    logo: '/img/logo.svg',
    siteDescription: 'Forbids Tailwind classes that violate design token rules',
    siteUrl: 'https://zudo-design-token-lint.takazudomodular.com',
    locales: {
      ja: {
        label: 'JA',
        dir: 'src/content/docs-ja',
      },
    },
    // The site's entry document is nested under the Overview category. This
    // keeps the generated versions page's Docs links on the canonical route.
    entryDocSlug: 'overview/getting-started',
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
    // default docs move on. "2.0" pins v2.0.0, the current npm release, and is
    // the first snapshot taken under this practice.
    //
    // There was also a "1.0" entry archiving the pre-rescaffold docs. It was
    // removed deliberately: it predated this practice and was a by-product of
    // the 4.x rescaffold rather than a snapshot anyone chose to publish, so it
    // documented a state that was never a meaningful released reference. Its
    // content is still in git history if it is ever wanted back. /v/1.0/ URLs
    // now 404 by design — redirecting them to Latest would silently serve
    // different content under a version label, which is worse than a 404.
    //
    // A snapshot copies only git-TRACKED content. src/content/docs/claude* is
    // gitignored build output that the claude-resources plugin regenerates into
    // the DEFAULT docsDir on every build, and that plugin is version-unaware —
    // copying it in would commit build output and freeze a stale mirror of the
    // repo's .claude/. So snapshots carry no Claude section; headerNav marks
    // Claude `versioned: false`, and version switchers disable its unavailable
    // archive destinations instead of emitting active links to them.
    //
    // A snapshot is NOT a byte-copy of the docs: anything that reaches outside
    // the content dir has to be neutralised, or the "frozen" page silently
    // tracks HEAD. Concretely, playground/index.mdx drops the <Playground /> tag
    // for a link to the live one — the island binds to src/lib/lint-browser.ts,
    // an unversioned mirror of the CURRENT linter, so an archived page would
    // report results from a linter newer than its own label. Apply the same
    // treatment to any future live-data component before snapshotting.
    //
    // Banner: the versioning guide's "Creating a New Version" step says to set
    // `banner: 'unmaintained'` on a new snapshot, and that is right for every
    // entry EXCEPT the one whose label is still the current release. Telling a
    // reader on /v/2.0/ that they are "viewing an older version" is simply
    // false while 2.0.0 IS the latest — so 2.0 carries `banner: false` until
    // the next release lands. See the per-entry note below; that flip is the
    // one piece of this block that needs doing by hand.
    //
    // Current zudo-doc releases carry category-nav version context and compute
    // unavailable archive destinations for both version switchers. The
    // generated Claude section remains latest-only, so its availability state
    // is intentionally disabled on every archived Claude-family destination.
    versions: [
      {
        slug: '2.0',
        label: '2.0.0',
        docsDir: 'src/content/docs-v2.0',
        locales: {
          ja: { dir: 'src/content/docs-v2.0-ja' },
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
      {
        label: 'Claude',
        path: '/docs/claude',
        categoryMatch: 'claude',
        // Claude resources are generated from the live repo and have no
        // versioned snapshot; keep this target canonical on archived pages.
        versioned: false,
      },
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
