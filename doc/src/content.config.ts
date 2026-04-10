import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import { settings } from "./config/settings";

const docsSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  sidebar_position: z.number().optional(),
  sidebar_label: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search_exclude: z.boolean().optional(),
  pagination_next: z.string().nullable().optional(),
  pagination_prev: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  unlisted: z.boolean().optional(),
  hide_sidebar: z.boolean().optional(),
  hide_toc: z.boolean().optional(),
  standalone: z.boolean().optional(),
  slug: z.string().optional(),
  generated: z.boolean().optional(),
});

const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: `./${settings.docsDir}` }),
  schema: docsSchema,
});

const localeCollections: Record<string, ReturnType<typeof defineCollection>> = {};
for (const [code, config] of Object.entries(settings.locales)) {
  localeCollections[`docs-${code}`] = defineCollection({
    loader: glob({ pattern: "**/*.{md,mdx}", base: `./${config.dir}` }),
    schema: docsSchema,
  });
}

const versionCollections: Record<string, ReturnType<typeof defineCollection>> = {};
if (settings.versions) {
  for (const version of settings.versions) {
    versionCollections[`docs-v-${version.slug}`] = defineCollection({
      loader: glob({ pattern: "**/*.{md,mdx}", base: `./${version.docsDir}` }),
      schema: docsSchema,
    });
    if (version.locales) {
      for (const [code, config] of Object.entries(version.locales)) {
        versionCollections[`docs-v-${version.slug}-${code}`] = defineCollection({
          loader: glob({ pattern: "**/*.{md,mdx}", base: `./${config.dir}` }),
          schema: docsSchema,
        });
      }
    }
  }
}

export const collections = { docs, ...localeCollections, ...versionCollections };
