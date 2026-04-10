export type {
  HeaderNavChildItem,
  HeaderNavItem,
  ColorModeConfig,
  HtmlPreviewConfig,
  LocaleConfig,
  VersionConfig,
  FooterConfig,
} from "./settings-types";
import type {
  HeaderNavItem,
  ColorModeConfig,
  HtmlPreviewConfig,
  LocaleConfig,
  VersionConfig,
  FooterConfig,
} from "./settings-types";

export const settings = {
  colorScheme: "Default Dark",
  colorMode: {
    defaultMode: "dark",
    lightScheme: "Default Light",
    darkScheme: "Default Dark",
    respectPrefersColorScheme: true,
  } satisfies ColorModeConfig,
  siteName: "Design Token Lint",
  siteDescription: "Lint Tailwind CSS class names against design system tokens. Enforce semantic spacing and color tokens instead of raw numeric utilities.",
  base: "/pj/zudo-design-token-lint/",
  trailingSlash: false as boolean,
  noindex: false as boolean,
  editUrl: "https://github.com/zudolab/zudo-design-token-lint/edit/main/doc/" as string | false,
  siteUrl: "https://takazudomodular.com" as string,
  docsDir: "src/content/docs",
  locales: {
    ja: { label: "JA", dir: "src/content/docs-ja" },
  } as Record<string, LocaleConfig>,
  mermaid: true,
  sitemap: false,
  docMetainfo: false,
  docTags: false,
  llmsTxt: true,
  math: false,
  onBrokenMarkdownLinks: "warn" as "warn" | "error" | "ignore",
  aiAssistant: false as boolean,
  docHistory: true,
  colorTweakPanel: false as boolean,
  sidebarResizer: true as boolean,
  sidebarToggle: true as boolean,
  htmlPreview: undefined as HtmlPreviewConfig | undefined,
  versions: [] as VersionConfig[],
  claudeResources: {
    claudeDir: "../.claude",
    projectRoot: "..",
  } as { claudeDir: string; projectRoot?: string } | false,
  footer: {
    links: [
      {
        title: "Docs",
        items: [
          { label: "Getting Started", href: "/docs/getting-started" },
          { label: "Configuration", href: "/docs/configuration" },
          { label: "CLI", href: "/docs/cli" },
        ],
      },
      {
        title: "More",
        items: [
          { label: "GitHub", href: "https://github.com/zudolab/zudo-design-token-lint" },
          { label: "npm", href: "https://www.npmjs.com/package/@zudolab/design-token-lint" },
        ],
      },
    ],
    copyright: `Copyright © ${new Date().getFullYear()} zudolab. Built with zudo-doc.`,
  } satisfies FooterConfig as FooterConfig | false,
  headerNav: [
    { label: "Getting Started", path: "/docs/getting-started", categoryMatch: "getting-started" },
    { label: "Guide", path: "/docs/configuration", categoryMatch: "guide" },
    { label: "API", path: "/docs/api", categoryMatch: "api" },
    { label: "Changelog", path: "/docs/changelog", categoryMatch: "changelog" },
  ] as HeaderNavItem[],
};
