export type {
  HeaderNavChildItem,
  HeaderNavItem,
  HeaderRightItem,
  ColorModeConfig,
  HtmlPreviewConfig,
  LocaleConfig,
  VersionConfig,
  FooterConfig,
  FrontmatterPreviewConfig,
  BodyFootUtilAreaConfig,
  TagPlacement,
  TagGovernanceMode,
  TagVocabularyEntry,
  MetaTagsConfig,
} from "./settings-types";
import type {
  HeaderNavItem,
  HeaderRightItem,
  ColorModeConfig,
  HtmlPreviewConfig,
  LocaleConfig,
  VersionConfig,
  FooterConfig,
  FrontmatterPreviewConfig,
  BodyFootUtilAreaConfig,
  TagPlacement,
  TagGovernanceMode,
  MetaTagsConfig,
} from "./settings-types";

export const settings = {
  colorScheme: "Default Dark",
  colorMode: {
    defaultMode: "dark",
    lightScheme: "Default Light",
    darkScheme: "Default Dark",
    respectPrefersColorScheme: true,
  } satisfies ColorModeConfig as ColorModeConfig | false,
  siteName: "Design Token Lint",
  siteDescription: "Forbids Tailwind classes that violate design token rules" as string,
  base: "/",
  trailingSlash: false as boolean,
  noindex: false as boolean,
  editUrl: false as string | false,
  githubUrl: "https://github.com/Takazudo/zudo-design-token-lint" as string | false,
  siteUrl: "https://zudo-design-token-lint.takazudomodular.com" as string,
  metaTags: {
    description: true,
    keywords: "",
    ogImage: "/img/ogp.png",
    ogSiteName: true,
    twitterCard: "summary",
  } satisfies MetaTagsConfig as MetaTagsConfig,
  docsDir: "src/content/docs",
  defaultLocale: "en" as const,
  locales: {
    ja: { label: "JA", dir: "src/content/docs-ja" },
  } satisfies Record<string, LocaleConfig>,
  mermaid: true,
  sitemap: false,
  docMetainfo: false,
  docTags: false,
  tagPlacement: "after-title" as TagPlacement,
  tagGovernance: "off" as TagGovernanceMode,
  tagVocabulary: false as boolean,
  frontmatterPreview: false as FrontmatterPreviewConfig | false,
  llmsTxt: true,
  math: false,
  cjkFriendly: true as boolean,
  onBrokenMarkdownLinks: "warn" as "warn" | "error" | "ignore",
  aiAssistant: false as boolean,
  aiChatDemoMode: false as boolean,
  aiChatAllowedOrigins: [] as string[],
  aiChatGlobalDailyLimit: false as number | false,
  docHistory: true,
  packageOwnedRoutes: true,
  bodyFootUtilArea: {
    docHistory: true,
    viewSourceLink: false,
  } satisfies BodyFootUtilAreaConfig as BodyFootUtilAreaConfig | false,
  designTokenPanel: false as boolean,
  tocMinDepth: 2 as number,
  tocMaxDepth: 4 as number,
  headingIdStrategy: "hierarchical" as "flat" | "hierarchical",
  sidebarResizer: true as boolean,
  sidebarToggle: true as boolean,
  imageEnlarge: true as boolean,
  dynamicPageTransition: true as boolean,
  htmlPreview: undefined as HtmlPreviewConfig | undefined,
  versions: false as VersionConfig[] | false,
  // Hybrid repo: this doc-app lives in `doc/` (cwd at build), while zdtl's
  // Claude resources live at the REPO ROOT, one level up. The 2.5.1 preset
  // (zudolab/zudo-doc#2558) passes claudeDir/projectRoot/scanRoot through to the
  // claude-resources plugin, which anchors ALL relative paths on projectRoot.
  //   - projectRoot "."  → the doc-app root (cwd = doc/). MUST be set explicitly:
  //     when omitted, the zfb plugin substitutes its own ctx.projectRoot, which
  //     mis-resolves claudeDir and silently drops the skills (0 skill pages).
  //   - claudeDir "../.claude" → repo-root .claude (commands/skills/agents source).
  //   - scanRoot ".."    → repo root, for CLAUDE.md discovery only.
  //   - docsDir (top-level "src/content/docs") resolves against projectRoot, so
  //     generated `claude*` pages land under doc/src/content/docs/ — NOT repo root.
  // Do NOT set projectRoot: ".." — that pushes claudeDir AND the docs output up
  // out of doc/ (into the repo-root linter src/).
  claudeResources: {
    claudeDir: "../.claude",
    projectRoot: ".",
    scanRoot: "..",
  } as { claudeDir: string; projectRoot?: string; scanRoot?: string } | false,
  defaultLocaleOnlyPrefixes: [
    "/docs/claude-md/",
    "/docs/claude-skills/",
    "/docs/claude-agents/",
    "/docs/claude-commands/",
  ] as string[],
  footer: {
    links: [],
    copyright: `Copyright © ${new Date().getFullYear()} takazudo. Built with zudo-doc.`,
  } satisfies FooterConfig as FooterConfig | false,
  headerNav: [
    { label: "Overview", path: "/docs/overview", categoryMatch: "overview" },
    { label: "Playground", path: "/docs/playground", categoryMatch: "playground" },
    { label: "Guide", path: "/docs/guide", categoryMatch: "guide" },
    { label: "Reference", path: "/docs/reference", categoryMatch: "reference" },
    { label: "Changelog", path: "/docs/changelog", categoryMatch: "changelog" },
    { label: "Claude", path: "/docs/claude", categoryMatch: "claude" },
  ] satisfies HeaderNavItem[] as HeaderNavItem[],
  headerRightItems: [
    { type: "component", component: "github-link" },
    { type: "component", component: "theme-toggle" },
    { type: "component", component: "search" },
    { type: "component", component: "language-switcher" },
    { type: "component", component: "version-switcher" },
  ] satisfies HeaderRightItem[] as HeaderRightItem[],
};
