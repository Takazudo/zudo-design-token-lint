import { defineConfig } from "zfb/config";
import { zudoDocPreset } from "@takazudo/zudo-doc/preset";
import { settings } from "./src/config/settings";
import { buildDocsSchema } from "./src/config/docs-schema";
import { translations } from "./src/config/i18n";
import { colorSchemes } from "./src/config/color-schemes";

const directiveVocabulary = {
  note: "Note",
  tip: "Tip",
  info: "Info",
  warning: "Warning",
  danger: "Danger",
  caution: "Caution",
  details: "Details",
};

export default defineConfig({
  // ── Host-owned shell fields ──────────────────────────────────────────────
  framework: "preact",
  // Pin the dev/preview port — zfb defaults to 3000, but the generated
  // CLAUDE.md and the Tauri dev wrappers assume 4321.
  port: 4321,
  tailwind: { enabled: true },
  // Public URL prefix for <link rel="stylesheet"> and <script> tags.
  base: settings.base,
  // Cloudflare adapter — required for the Workers deploy (dist/_worker.js) and
  // any non-prerendered package-owned routes. Bindings come from wrangler.toml.
  adapter: "@takazudo/zfb-adapter-cloudflare",
  // The Playground island (wired in S4, src/components) imports hooks from
  // "react", which zfb's framework=preact resolves to `preact/compat`. That
  // nested compat build is exposed only via a bare `main` field (no exports
  // map), and esbuild's `--platform=neutral` page/SSR pass has an EMPTY
  // main-fields list by default → "Main fields must be configured explicitly
  // when using the neutral platform." Setting them lets the react→preact/compat
  // resolve complete. zfb-documented escape hatch (BundleConfig.mainFields, #676).
  // The reference thin config omits this; zdtl needs it for the island.
  bundle: { mainFields: ["main", "module"] },

  // ── Preset-owned fields (content collections, plugins, markdown, …) ────────
  ...zudoDocPreset({ settings, buildDocsSchema, directiveVocabulary, translations, colorSchemes }),
});
