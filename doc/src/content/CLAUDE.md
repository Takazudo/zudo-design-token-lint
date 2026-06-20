# CLAUDE.md — src/content

## Bilingual Rule (EN + JA)

When adding or modifying any documentation page, **always update both languages**:

- English: `src/content/docs/<category>/<page>.mdx`
- Japanese: `src/content/docs-ja/<category>/<page>.mdx`

The JA directory mirrors the EN directory structure exactly. Every EN page has a corresponding JA page.

**Exception**: Pages with `generated: true` in frontmatter (e.g. claude-resources auto-generated pages) do not require Japanese translations.

## Translation Rules

- **Prose**: Translate to Japanese
- **Code blocks**: Keep identical to EN — do NOT translate comments, strings, or identifiers in code blocks
- **Frontmatter `title` and `description`**: Translate
- **Frontmatter `category`, `sidebar_position`, `tags`**: Keep identical to EN
- **Inline code (`` ` ``)**: Keep identical
- **Link text**: Translate
- **Link URLs**: Keep identical (they resolve to the same page under the appropriate locale)

## Internal Links

Use **relative `.mdx` paths** for cross-page links, not absolute paths. The `resolveMarkdownLinks` plugin rewrites `.md`/`.mdx` extensions and applies the base prefix; bare absolute paths bypass it.

```md
<!-- Good — relative path -->
See the [methodology](../../reference/methodology/index.mdx) page.

<!-- Bad — breaks under settings.base -->
See the [methodology](/docs/reference/methodology) page.
```

External links (`https://...`) pass through unchanged.

## Frontmatter Schema

```yaml
---
title: Page Title
description: Short description (shown in sidebar and SEO)
sidebar_position: 1
category: guide
---
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Page title, rendered as the page h1 |
| `description` | string | No | Subtitle displayed below the title; also used for SEO |
| `sidebar_position` | number | No | Sort order within the category (lower = higher). Always set for predictable ordering |
| `sidebar_label` | string | No | Custom sidebar text (overrides `title`) |
| `category` | string | No | Groups pages in the sidebar; must match a `categoryMatch` in `src/config/settings.ts` |
| `tags` | string[] | No | Optional tag list |
| `draft` | boolean | No | Excluded from production builds when `true` |
| `generated` | boolean | No | Build-time generated content — skip bilingual requirement |

## Content Rules

- **No h1 in content body**: The frontmatter `title` is automatically rendered as the page h1. Start your content with `## h2` headings.
- **Always set `sidebar_position`**: Without it, pages sort alphabetically, which is unpredictable.
- **Kebab-case file names**: Use `my-article.mdx`, not `myArticle.mdx`.

## Linking Between Docs

Use relative file paths with the `.mdx` extension:

```markdown
[Link text](./sibling-page.mdx)
[Link text](../other-category/page.mdx#anchor)
```

## Admonitions

Available globally without imports: `<Note>`, `<Tip>`, `<Info>`, `<Warning>`, `<Danger>`

```mdx
<Note>This is a note.</Note>
<Warning>This is a warning.</Warning>
```

## Navigation Structure

Navigation is **filesystem-driven**. The directory structure under `src/content/docs/` directly becomes the sidebar. Pages are ordered by `sidebar_position` (ascending). Category index pages (`index.mdx`) control category position via their own `sidebar_position`.

There are no `_category_.json` files — category metadata (label, sort order) is expressed via the `index.mdx` frontmatter in each directory.

## Categories and Header Nav

Top-level directories under `src/content/docs/` that have header nav entries (mapped via `categoryMatch` in `src/config/settings.ts`):

- `overview/` — What is?, Getting Started
- `playground/` — Playground
- `guide/` — Configuration, CLI, Ignore Syntax, Examples
- `reference/` — API, Methodology
- `changelog/` — Changelog

Auto-generated directories (managed by `claude-resources` integration on every build; gitignored — do not hand-edit):

- `claude/` — Claude Skills documentation
- `claude-md/` — CLAUDE.md file documentation

Adding a new header nav category requires updating `headerNav` in `src/config/settings.ts`.

## Content Creation Workflow

1. Create English `.mdx` file under `src/content/docs/` with `title` and `sidebar_position`
2. Write content starting with `## h2` headings (not `# h1`)
3. Create matching Japanese file under `src/content/docs-ja/` with translated prose
4. Keep code blocks identical between languages — only translate prose
5. Run `pnpm format:md` then `pnpm build:doc` from the repo root (or `pnpm build` inside `doc/`) to verify
