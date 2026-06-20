import { z } from "zod";
import { defineConfig } from "zfb/config";
import { settings } from "./src/config/settings";
import { buildDocsSchema } from "./src/config/docs-schema";

const docsSchema = buildDocsSchema();

const docsSchemaJson = z.toJSONSchema(docsSchema) as Record<string, unknown>;

interface CollectionEntryShape {
  name: string;
  path: string;
  schema: Record<string, unknown>;
}

const collections: CollectionEntryShape[] = [];

collections.push({ name: "docs", path: settings.docsDir, schema: docsSchemaJson });

for (const [code, config] of Object.entries(settings.locales)) {
  collections.push({ name: `docs-${code}`, path: config.dir, schema: docsSchemaJson });
}

if (settings.versions) {
  for (const version of settings.versions) {
    collections.push({
      name: `docs-v-${version.slug}`,
      path: version.docsDir,
      schema: docsSchemaJson,
    });
    if (version.locales) {
      for (const [code, config] of Object.entries(version.locales)) {
        collections.push({
          name: `docs-v-${version.slug}-${code}`,
          path: config.dir,
          schema: docsSchemaJson,
        });
      }
    }
  }
}

const localeArray = Object.entries(settings.locales).map(([code, locale]) => ({
  code,
  dir: locale.dir,
}));
const localeRecord = Object.fromEntries(
  Object.entries(settings.locales).map(([code, locale]) => [code, { dir: locale.dir }]),
);

// ---------------------------------------------------------------------------
// claude-resources plugin options — HYBRID-REPO path adaptation.
//
// This repo's root is the npm package; the zfb doc-app lives in `doc/` (cwd at
// build time). The `.claude/` source dir is at the REPO ROOT, one level above.
//
// `runClaudeResourcesPreStep` (in @takazudo/zudo-doc) resolves BOTH `claudeDir`
// and `docsDir` against `projectRoot`:
//     projectRoot = resolve(options.projectRoot)             // here: ".." → repo root
//     claudeDir   = resolve(projectRoot, options.claudeDir)  // want: <repoRoot>/.claude
//     docsDir     = resolve(projectRoot, options.docsDir)    // want: <repoRoot>/doc/src/content/docs
//
// So the options passed to the plugin are projectRoot-RELATIVE, not cwd-relative.
// settings.claudeResources stores cwd-relative values (claudeDir "../.claude",
// projectRoot "..") for documentation/parity; we translate them here:
//   - claudeDir: strip the leading "../" so it resolves under the repo root → ".claude"
//   - docsDir: prefix settings.docsDir with this app's subdir ("doc/") so it
//     lands under doc/, NOT the repo-root linter `src/`.
const claudeResourcesOptions = settings.claudeResources
  ? (() => {
      const projectRoot = settings.claudeResources.projectRoot ?? ".";
      // claudeDir relative to projectRoot (repo root): drop a single leading "../".
      const claudeDirRel = settings.claudeResources.claudeDir.replace(/^\.\.\//, "");
      // docsDir relative to projectRoot (repo root): the doc-app is one level
      // below projectRoot, so prefix with the doc subdir name.
      const docsDirRel =
        projectRoot === ".."
          ? `doc/${settings.docsDir}`
          : settings.docsDir;
      return {
        claudeDir: claudeDirRel,
        projectRoot,
        docsDir: docsDirRel,
      };
    })()
  : null;

const integrationPlugins = [
  ...(claudeResourcesOptions
    ? [
        {
          name: "./plugins/claude-resources-plugin.mjs",
          options: claudeResourcesOptions,
        },
      ]
    : []),
  ...(settings.docHistory
    ? [
        {
          name: "./plugins/doc-history-plugin.mjs",
          options: {
            docsDir: settings.docsDir,
            locales: localeRecord,
            base: settings.base,
          },
        },
      ]
    : []),
  {
    name: "./plugins/search-index-plugin.mjs",
    options: {
      docsDir: settings.docsDir,
      locales: localeRecord,
      base: settings.base,
    },
  },
  ...(settings.llmsTxt
    ? [
        {
          name: "./plugins/llms-txt-plugin.mjs",
          options: {
            siteName: settings.siteName,
            siteDescription: settings.siteDescription,
            base: settings.base,
            siteUrl: settings.siteUrl,
            defaultLocaleDir: settings.docsDir,
            locales: localeArray,
          },
        },
      ]
    : []),
  {
    name: "./plugins/copy-public-plugin.mjs",
    options: {
      publicDir: "public",
    },
  },
];

export default defineConfig({
  framework: "preact",
  // Pin the dev/preview port — zfb defaults to 3000, but the generated
  // CLAUDE.md and the Tauri dev wrappers assume 4321.
  port: 4321,
  tailwind: { enabled: true },
  collections,
  stripMdExt: true,
  resolveMarkdownLinks: {
    enabled: true,
    dirs: [
      { dir: settings.docsDir, routePrefix: "/docs/" },
      ...Object.entries(settings.locales).map(([code, locale]) => ({
        dir: locale.dir,
        routePrefix: `/${code}/docs/`,
      })),
      // Versioned collections: each version's EN dir + per-locale dirs.
      ...(settings.versions
        ? settings.versions.flatMap((version) => [
            { dir: version.docsDir, routePrefix: `/v/${version.slug}/docs/` },
            ...Object.entries(version.locales ?? {}).map(([code, locale]) => ({
              dir: locale.dir,
              routePrefix: `/v/${version.slug}/${code}/docs/`,
            })),
          ])
        : []),
    ],
    onBrokenLinks: "warn",
  },
  base: settings.base,
  trailingSlash: settings.trailingSlash,
  markdown: {
    features: {
      // Former-Core features (were always-on before zfb next.12).
      // imageEnlarge was a former-Core feature but was hard-removed in zfb
      // next.18 — it is now re-implemented via an MDX p-override.
      // Admonitions recipe: register the :::name directive vocabulary
      // (note/tip/info/warning/danger/caution/details) → components.
      directives: {
        note: "Note",
        tip: "Tip",
        info: "Info",
        warning: "Warning",
        danger: "Danger",
        caution: "Caution",
        details: "Details", // collapsible — routes to DetailsWrapper
      },
      mermaid: true,
      headingMarkerToc: true,
      // Safe opt-in features.
      githubAlerts: true,
      readingTime: true,
      codeEnrichment: {},
      codeTabs: true,
      imageDimensions: {},
      // warn-only link validation — failOnBroken: false never fails the build.
      linkValidation: { failOnBroken: false },
      // Heading-ID (anchor) strategy — single source of truth in
      // settings.headingIdStrategy, also mirrored by the host TOC builder
      // (pages/lib/_extract-headings.ts) so TOC anchors match rendered ids.
      headingIds: { strategy: settings.headingIdStrategy },
    },
  },
  adapter: "@takazudo/zfb-adapter-cloudflare",
  plugins: integrationPlugins,
});
