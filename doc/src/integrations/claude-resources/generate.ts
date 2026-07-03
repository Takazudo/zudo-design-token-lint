import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { escapeForMdx } from "./escape-for-mdx";

export interface ClaudeResourcesConfig {
  claudeDir: string;
  projectRoot?: string;
  docsDir: string;
}

interface ClaudeMdItem {
  displayPath: string;
  slug: string;
  relPath: string;
}

interface CommandItem {
  name: string;
  description: string;
}

interface SkillReference {
  name: string;
  title: string;
  content: string;
}

interface SkillItem {
  name: string;
  dir: string;
  description: string;
  references: SkillReference[];
}

interface AgentItem {
  name: string;
  file: string;
  description: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function parseFrontmatter(content: string) {
  try {
    return matter(content);
  } catch {
    return null;
  }
}

function escapeTitle(s: string): string {
  // Backslashes must be escaped first — the value is embedded in
  // double-quoted YAML frontmatter where `\d` or `C:\path` is invalid.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();
}

function writeCategoryIndex(
  outputDir: string,
  label: string,
  position: number,
  description: string,
) {
  const mdx = `---
title: "${escapeTitle(label)}"
description: "${escapeTitle(description)}"
sidebar_position: ${position}
category_no_page: true
generated: true
---
`;
  fs.writeFileSync(path.join(outputDir, "index.mdx"), mdx);
}

/**
 * Writes an unlisted sub-page MDX file. Used for skill references, scripts,
 * and assets.
 *
 * The route is derived from the file's path within the content collection —
 * deliberately NOT from an explicit `slug:`. zfb's `resolveMarkdownLinks`
 * resolves relative links against the *source file path*, so the on-disk
 * location of these pages must match the URL the skill page links to. Writing
 * them at `<dir>/ref-<name>.mdx` (siblings of the skill's `index.mdx`) is what
 * makes the `./ref-<name>` links resolve (#2411).
 */
function writeUnlistedSubPage(
  outputPath: string,
  title: string,
  body: string,
) {
  fs.writeFileSync(
    outputPath,
    `---\ntitle: "${escapeTitle(title)}"\nunlisted: true\ngenerated: true\n---\n\n${body}\n`,
  );
}

/**
 * Guards that the given name/slug is not the reserved "index" value.
 * Throws with a contextual message if it is.
 */
function assertNotIndexReserved(
  nameOrSlug: string,
  errorMessage: string,
) {
  if (nameOrSlug === "index") {
    throw new Error(errorMessage);
  }
}

/**
 * Whether a markdown link target is a repo-relative file reference
 * (`./wrangler.toml`, `../../schema/photos.sql`, `foo/bar.md`) rather than
 * something the doc site can resolve: an absolute URL (`https://…`), a
 * protocol-relative URL (`//…`), a site-absolute path (`/docs/…`), a pure
 * anchor (`#…`), or a scheme (`mailto:`, `tel:`).
 */
function isRepoRelativeLink(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("#")) return false; // anchor
  if (trimmed.startsWith("/")) return false; // site-absolute or protocol-relative (//host)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false; // has a scheme (http:, mailto:, …)
  return true;
}

/**
 * Downgrade repo-relative markdown links in a mirrored `CLAUDE.md` body to
 * inline code so they don't dangle in the flattened mirror tree (#2411).
 *
 * A `CLAUDE.md`'s relative links point at real repo files (correct for an
 * in-repo reader), but the mirror flattens each file into a single
 * `claude-md/<name>.mdx` page with no counterpart for those targets — left as
 * links they surface as `broken link:` warnings on every affected page. Inline
 * code keeps the reference legible (`` `wrangler.toml` ``) without a href.
 *
 * Code spans are preserved verbatim: a `[x](./y)` inside a fenced block or an
 * inline-code span is literal text, not a link, and must not be rewritten.
 */
function downgradeRepoRelativeLinks(content: string): string {
  const blockPlaceholder = "\x00CRLINK_BLOCK_";
  const inlinePlaceholder = "\x00CRLINK_INLINE_";

  // Extract fenced code blocks so their contents are untouched. Both backtick
  // (```) and tilde (~~~) fences are recognised; the `\1` backreference makes
  // the closing fence match the same delimiter the block opened with.
  const codeBlocks: string[] = [];
  const withBlocks = content.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, (match) => {
    codeBlocks.push(match);
    return `${blockPlaceholder}${codeBlocks.length - 1}\x00`;
  });

  const transformed = withBlocks
    .split(new RegExp(`(${blockPlaceholder}\\d+\x00)`, "g"))
    .map((part) => {
      if (new RegExp(`^${blockPlaceholder}\\d+\x00$`).test(part)) return part;

      // Preserve inline-code spans, then rewrite links in the remaining text.
      const inlineCodes: string[] = [];
      const withInline = part.replace(
        /(`{1,3})(?!`)([\s\S]*?[^`])\1(?!`)/g,
        (match) => {
          inlineCodes.push(match);
          return `${inlinePlaceholder}${inlineCodes.length - 1}\x00`;
        },
      );

      const rewritten = withInline.replace(
        /!?\[([^\]]*)\]\(([^)]+)\)/g,
        (match, text: string, url: string) =>
          isRepoRelativeLink(url) ? `\`${text}\`` : match,
      );

      return rewritten.replace(
        new RegExp(`${inlinePlaceholder}(\\d+)\x00`, "g"),
        (_, idx: string) => inlineCodes[Number(idx)] ?? "",
      );
    })
    .join("");

  return transformed.replace(
    new RegExp(`${blockPlaceholder}(\\d+)\x00`, "g"),
    (_, idx: string) => codeBlocks[Number(idx)] ?? "",
  );
}

// ---------------------------------------------------------------------------
// CLAUDE.md discovery
// ---------------------------------------------------------------------------

function findClaudeMdFiles(dir: string, excludeDirs: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  // Strip trailing separators (path.join preserves one on e.g. "docs/") so the
  // boundary compare below stays exact for such entries too.
  const excludes = excludeDirs.map((d) =>
    d.endsWith(path.sep) ? d.slice(0, -path.sep.length) : d,
  );

  for (const item of fs.readdirSync(dir)) {
    if (item === "node_modules") continue;
    if (item.startsWith(".")) continue;
    const itemPath = path.join(dir, item);
    // Path-segment-boundary-aware: a raw startsWith(d) would also match a
    // sibling like "dist-extra" against an excluded "dist" (#2561).
    if (excludes.some((d) => itemPath === d || itemPath.startsWith(d + path.sep))) continue;

    // lstat (not stat) so symlinks aren't followed — a symlinked dir can point
    // back into the project (e.g. e2e fixtures linking to packages/) or out to
    // a slow mount (e.g. /mnt/c on WSL) and either turns the walk into a
    // multi-minute hang.
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(itemPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findClaudeMdFiles(itemPath, excludes));
    } else if (stat.isFile() && item === "CLAUDE.md") {
      results.push(itemPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

function generateClaudemdDocs(
  config: ClaudeResourcesConfig,
): ClaudeMdItem[] {
  const projectRoot = config.projectRoot ?? config.claudeDir;
  const outputDir = path.join(config.docsDir, "claude-md");

  cleanDir(outputDir);

  const excludeDirs = [
    path.join(projectRoot, ".git"),
    path.join(projectRoot, "node_modules"),
    path.join(projectRoot, "worktrees"),
    path.join(projectRoot, "dist"),
    path.join(projectRoot, "out"),
    path.join(projectRoot, "public"),
    path.join(projectRoot, "__inbox"),
    path.join(projectRoot, "test-results"),
    path.join(projectRoot, "e2e", "fixtures"),
    path.join(config.docsDir),
  ];

  const files = findClaudeMdFiles(projectRoot, excludeDirs);
  if (files.length === 0) return [];

  ensureDir(outputDir);
  const items: ClaudeMdItem[] = [];

  for (const filePath of files) {
    const relPath = path.relative(projectRoot, filePath);
    const displayPath = `/${relPath}`;
    const dirPart = path.dirname(relPath);
    const slug = dirPart === "." ? "root" : dirPart.replace(/\//g, "--");
    items.push({ displayPath, slug, relPath });
  }

  // Sort BEFORE writing: sidebar_position is baked into each generated .mdx,
  // so the root-first/alphabetical order must be applied first — sorting after
  // the write loop would leave positions in filesystem-walk order.
  items.sort((a, b) => {
    if (a.slug === "root") return -1;
    if (b.slug === "root") return 1;
    return a.displayPath.localeCompare(b.displayPath);
  });

  const emittedSlugs = new Map<string, string>();
  items.forEach((item, index) => {
    assertNotIndexReserved(
      item.slug,
      `claude-resources: "${item.relPath}" maps to the reserved slug "index", which is used for the category metadata file. Rename the directory to resolve the conflict.`,
    );
    const previous = emittedSlugs.get(item.slug);
    if (previous !== undefined) {
      throw new Error(
        `claude-resources: slug collision — "${item.slug}" is produced by both "${previous}" and "${item.relPath}". Rename one of the directories to resolve the conflict.`,
      );
    }
    emittedSlugs.set(item.slug, item.relPath);
    const content = fs.readFileSync(path.join(projectRoot, item.relPath), "utf8");
    const mdx = `---
title: "${escapeTitle(item.displayPath)}"
description: "CLAUDE.md at ${escapeTitle(item.displayPath)}"
sidebar_position: ${index + 1}
sidebar_label: "${escapeTitle(item.relPath)}"
generated: true
---

**Path:** \`${item.relPath}\`

${escapeForMdx(downgradeRepoRelativeLinks(content.trim()))}
`;
    fs.writeFileSync(path.join(outputDir, `${item.slug}.mdx`), mdx);
  });

  writeCategoryIndex(outputDir, "CLAUDE.md", 900, "Project-specific instructions");
  return items;
}

// ---------------------------------------------------------------------------
// Commands generation
// ---------------------------------------------------------------------------

function generateCommandsDocs(config: ClaudeResourcesConfig): CommandItem[] {
  const commandsDir = path.join(config.claudeDir, "commands");
  const outputDir = path.join(config.docsDir, "claude-commands");

  cleanDir(outputDir);

  if (!fs.existsSync(commandsDir)) return [];

  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return [];

  ensureDir(outputDir);
  const items: CommandItem[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(commandsDir, file), "utf8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const name = file.replace(/\.md$/, "");
    assertNotIndexReserved(
      name,
      `claude-resources: ".claude/commands/index.md" uses the reserved name "index", which is used for the category metadata file. Rename the command file to resolve the conflict.`,
    );
    const description = (parsed.data.description as string) || "";

    items.push({ name, description });

    const mdx = `---
title: "${escapeTitle(name)}"
description: "${escapeTitle(description)}"
sidebar_label: "${escapeTitle(name)}"
generated: true
---

${escapeForMdx(parsed.content.trim())}
`;
    fs.writeFileSync(path.join(outputDir, `${name}.mdx`), mdx);
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  writeCategoryIndex(outputDir, "Commands", 901, "Custom slash commands");
  return items;
}

// ---------------------------------------------------------------------------
// Skills generation
// ---------------------------------------------------------------------------

type TreeEntry =
  | { isDir: false; name: string }
  | { isDir: true; name: string; children: string[] };

function getSkillFileTree(
  skillDir: string,
  subDirs: { name: string; files: string[] }[],
): string {
  const lines: string[] = [`${skillDir}/`];
  const entries: TreeEntry[] = [{ isDir: false, name: "SKILL.md" }];

  for (const sub of subDirs) {
    entries.push({ isDir: true, name: sub.name, children: sub.files });
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const isLast = i === entries.length - 1;
    const prefix = isLast ? "└── " : "├── ";

    if (!entry.isDir) {
      lines.push(`${prefix}${entry.name}`);
    } else {
      lines.push(`${prefix}${entry.name}/`);
      for (let j = 0; j < entry.children.length; j++) {
        const child = entry.children[j];
        if (!child) continue;
        const childIsLast = j === entry.children.length - 1;
        const continuation = isLast ? "    " : "│   ";
        const childPrefix = childIsLast ? "└── " : "├── ";
        lines.push(`${continuation}${childPrefix}${child}`);
      }
    }
  }

  return lines.join("\n");
}

function getScriptDescription(filePath: string): string {
  try {
    const topLines = fs.readFileSync(filePath, "utf8").split("\n", 2);
    // Skip shebang, use second line if available
    const firstLine = topLines[0] ?? "";
    const commentLine = firstLine.startsWith("#!")
      ? topLines[1] ?? ""
      : firstLine;
    // Match # comments (shell/python) or // comments (JS/TS)
    const match = commentLine.match(/^(?:#|\/\/)\s*(.+)/);
    return match ? ` — ${match[1]}` : "";
  } catch {
    return "";
  }
}

function getSkillReferences(
  skillsDir: string,
  skillDir: string,
): SkillReference[] {
  const refsDir = path.join(skillsDir, skillDir, "references");
  if (!fs.existsSync(refsDir)) return [];

  return fs
    .readdirSync(refsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const content = fs.readFileSync(path.join(refsDir, f), "utf8");
      const name = f.replace(/\.md$/, "");
      const h1Match = content.match(/^#\s+(.+)$/m);
      const title = h1Match?.[1] ?? name;
      return { name, title, content };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function generateSkillsDocs(config: ClaudeResourcesConfig): SkillItem[] {
  const skillsDir = path.join(config.claudeDir, "skills");
  const outputDir = path.join(config.docsDir, "claude-skills");

  cleanDir(outputDir);

  if (!fs.existsSync(skillsDir)) return [];

  const dirs = fs.readdirSync(skillsDir).filter((d) => {
    const skillPath = path.join(skillsDir, d);
    return (
      fs.statSync(skillPath).isDirectory() &&
      fs.existsSync(path.join(skillPath, "SKILL.md"))
    );
  });

  if (dirs.length === 0) return [];

  ensureDir(outputDir);
  const items: SkillItem[] = [];

  for (const dir of dirs) {
    assertNotIndexReserved(
      dir,
      `claude-resources: skill directory ".claude/skills/index/" uses the reserved name "index", which is used for the category metadata file. Rename the skill directory to resolve the conflict.`,
    );
    const content = fs.readFileSync(
      path.join(skillsDir, dir, "SKILL.md"),
      "utf8",
    );
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const name = (parsed.data.name as string) || dir;
    const description = (parsed.data.description as string) || "";
    const references = getSkillReferences(skillsDir, dir);

    items.push({ name, dir, description, references });

    const scriptFiles = listFiles(path.join(skillsDir, dir, "scripts"));
    const assetFiles = listFiles(path.join(skillsDir, dir, "assets"));
    const refFiles = references.map((r) => `${r.name}.md`);

    // Collect non-empty subdirectories for tree display
    const subDirs: { name: string; files: string[] }[] = [];
    if (scriptFiles.length > 0) subDirs.push({ name: "scripts", files: scriptFiles });
    if (refFiles.length > 0) subDirs.push({ name: "references", files: refFiles });
    if (assetFiles.length > 0) subDirs.push({ name: "assets", files: assetFiles });

    // File tree + links to renderable .md sub-files
    let fileStructureSection = "";
    if (subDirs.length > 0) {
      const tree = `\`\`\`\n${getSkillFileTree(dir, subDirs)}\n\`\`\``;

      // Collect links to all .md sub-files that get pages. Links use
      // ./<subpage>; because the skill page is written as `<dir>/index.mdx`,
      // these resolve to the sibling `<dir>/<subpage>.mdx` files (#2411).
      const links: string[] = [];
      for (const ref of references) {
        links.push(`- [references/${ref.name}.md](./ref-${ref.name})`);
      }
      for (const f of scriptFiles.filter((s) => s.endsWith(".md"))) {
        const slug = f.replace(/\.md$/, "");
        links.push(`- [scripts/${f}](./script-${slug})`);
      }
      for (const f of assetFiles.filter((a) => a.endsWith(".md"))) {
        const slug = f.replace(/\.md$/, "");
        links.push(`- [assets/${f}](./asset-${slug})`);
      }

      const linkList = links.length > 0 ? `\n\n${links.join("\n")}` : "";
      fileStructureSection = `## File Structure\n\n${tree}${linkList}`;
    }

    const shortDesc = description.length > 200
      ? description.substring(0, 200) + "..."
      : description;

    // Rewrite references/scripts/assets links in skill body to match doc site URLs
    let skillBody = parsed.content.trim();
    skillBody = skillBody
      .replace(/\]\(references\/([^)]+)\.md\)/g, "](./ref-$1)")
      .replace(/\]\(scripts\/([^)]+)\.md\)/g, "](./script-$1)")
      .replace(/\]\(assets\/([^)]+)\.md\)/g, "](./asset-$1)");

    const body = [
      fileStructureSection,
      escapeForMdx(skillBody),
    ]
      .filter(Boolean)
      .join("\n\n");

    const mdx = `---
title: "${escapeTitle(name)}"
description: "${escapeTitle(shortDesc)}"
sidebar_label: "${escapeTitle(name)}"
generated: true
---

${body}`;

    // Write the skill page as the directory index (`<dir>/index.mdx`) so its
    // route is `claude-skills/<dir>` served at URL `.../claude-skills/<dir>/`.
    // This makes the reference/script/asset pages genuine siblings inside
    // `<dir>/`, which is what lets the `./ref-<name>` links above resolve.
    const skillDirOut = path.join(outputDir, dir);
    ensureDir(skillDirOut);
    fs.writeFileSync(path.join(skillDirOut, "index.mdx"), mdx);

    // Generate unlisted sub-pages as nested files inside `<dir>/`. Their routes
    // (`claude-skills/<dir>/ref-<name>`, …) are derived from these file paths
    // and therefore match the `./ref-<name>` / `./script-<name>` /
    // `./asset-<name>` links emitted above (#2411).
    for (const ref of references) {
      writeUnlistedSubPage(
        path.join(skillDirOut, `ref-${ref.name}.mdx`),
        ref.title,
        escapeForMdx(ref.content.trim()),
      );
    }

    for (const f of scriptFiles.filter((s) => s.endsWith(".md"))) {
      const slug = f.replace(/\.md$/, "");
      const raw = fs.readFileSync(
        path.join(skillsDir, dir, "scripts", f),
        "utf8",
      );
      const h1Match = raw.match(/^#\s+(.+)$/m);
      const title = h1Match?.[1] ?? slug;
      writeUnlistedSubPage(
        path.join(skillDirOut, `script-${slug}.mdx`),
        title,
        escapeForMdx(raw.trim()),
      );
    }

    for (const f of assetFiles.filter((a) => a.endsWith(".md"))) {
      const slug = f.replace(/\.md$/, "");
      const raw = fs.readFileSync(
        path.join(skillsDir, dir, "assets", f),
        "utf8",
      );
      const h1Match = raw.match(/^#\s+(.+)$/m);
      const title = h1Match?.[1] ?? slug;
      writeUnlistedSubPage(
        path.join(skillDirOut, `asset-${slug}.mdx`),
        title,
        escapeForMdx(raw.trim()),
      );
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  writeCategoryIndex(outputDir, "Skills", 902, "Skill packages");
  return items;
}

// ---------------------------------------------------------------------------
// Agents generation
// ---------------------------------------------------------------------------

function generateAgentsDocs(config: ClaudeResourcesConfig): AgentItem[] {
  const agentsDir = path.join(config.claudeDir, "agents");
  const outputDir = path.join(config.docsDir, "claude-agents");

  cleanDir(outputDir);

  if (!fs.existsSync(agentsDir)) return [];

  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return [];

  ensureDir(outputDir);
  const items: AgentItem[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), "utf8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const name = (parsed.data.name as string) || file.replace(/\.md$/, "");
    const description = (parsed.data.description as string) || "";
    const model = (parsed.data.model as string) || "";
    const fileSlug = file.replace(/\.md$/, "");
    assertNotIndexReserved(
      fileSlug,
      `claude-resources: ".claude/agents/index.md" uses the reserved name "index", which is used for the category metadata file. Rename the agent file to resolve the conflict.`,
    );

    items.push({ name, file: fileSlug, description, model });

    const modelBadge = model ? `**Model:** \`${model}\`\n` : "";

    const mdx = `---
title: "${escapeTitle(name)}"
description: "${escapeTitle(description)}"
sidebar_label: "${escapeTitle(name)}"
generated: true
---

${modelBadge}
${escapeForMdx(parsed.content.trim())}
`;
    fs.writeFileSync(path.join(outputDir, `${fileSlug}.mdx`), mdx);
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  writeCategoryIndex(outputDir, "Agents", 903, "Custom subagents");
  return items;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function generateOverviewIndex(
  config: ClaudeResourcesConfig,
  {
    hasCommands,
    hasSkills,
    hasAgents,
    hasClaudemd,
  }: { hasCommands: boolean; hasSkills: boolean; hasAgents: boolean; hasClaudemd: boolean },
) {
  const outputDir = path.join(config.docsDir, "claude");
  cleanDir(outputDir);
  ensureDir(outputDir);

  // Build the explicit slug list from whichever sub-categories were generated.
  // CategoryNav with `categories` renders cards for each slug by resolving
  // the node in the nav tree (including noPage auto-index categories) and
  // falling back to docsUrl(slug, locale) for the href when noPage=true.
  const categorySlugs: string[] = [];
  if (hasClaudemd) categorySlugs.push("claude-md");
  if (hasSkills) categorySlugs.push("claude-skills");
  if (hasAgents) categorySlugs.push("claude-agents");
  if (hasCommands) categorySlugs.push("claude-commands");

  const categoriesAttr = JSON.stringify(categorySlugs);

  const index = `---
title: "Claude"
description: "Claude Code configuration reference."
sidebar_position: 899
generated: true
---

Claude Code configuration reference.

## Resources

<CategoryNav categories={${categoriesAttr}} />
`;
  fs.writeFileSync(path.join(outputDir, "index.mdx"), index);
}

export function generateClaudeResourcesDocs(config: ClaudeResourcesConfig) {
  const claudemds = generateClaudemdDocs(config);
  const commands = generateCommandsDocs(config);
  const skills = generateSkillsDocs(config);
  const agents = generateAgentsDocs(config);

  generateOverviewIndex(config, {
    hasClaudemd: claudemds.length > 0,
    hasCommands: commands.length > 0,
    hasSkills: skills.length > 0,
    hasAgents: agents.length > 0,
  });

  return {
    claudemd: claudemds.length,
    commands: commands.length,
    skills: skills.length,
    agents: agents.length,
  };
}
