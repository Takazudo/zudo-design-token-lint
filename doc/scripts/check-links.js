#!/usr/bin/env node

/**
 * check-links.js — Post-build broken link checker
 *
 * Mode 1: Scan built HTML in dist/ for broken internal links
 * Mode 2: Scan MDX source for absolute links bypassing base path
 */

import { readFile, readdir, access } from "node:fs/promises";
import { join, extname, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL(".", import.meta.url));

// --- Utilities ---

/**
 * Strip a top-level `versions: [ ... ]` array (bracket-depth aware) out of a
 * zfb.config.ts source string before regex field extraction.
 *
 * Since 4.x, the host no longer has a standalone `src/config/settings.ts` —
 * `base` / `trailingSlash` / `docsDir` / `locales` live inline in the
 * `zudoDoc({...})` call in `zfb.config.ts`. That same call's `versions`
 * array carries PER-VERSION entries that reuse the identical field names
 * (`docsDir`, `locales.<lang>.dir`) for older doc snapshots. A naive regex
 * over the whole file grabs whichever occurrence comes first, which silently
 * picks up a versioned snapshot's `docsDir` instead of the project's actual
 * (default) one when the project doesn't override `docsDir` at the top
 * level. Stripping the array first keeps extraction scoped to top-level
 * settings regardless of field order.
 */
function stripVersionsBlock(content) {
  const idx = content.indexOf("versions:");
  if (idx === -1) return content;
  let i = content.indexOf("[", idx);
  const colonIdx = content.indexOf(":", idx);
  const valueStart = content.slice(colonIdx + 1).search(/\S/) + colonIdx + 1;
  if (content[valueStart] !== "[" || i === -1 || i > valueStart + 1) {
    // Not an array literal (e.g. `versions: false`) — nothing to strip.
    return content;
  }
  let depth = 0;
  do {
    if (content[i] === "[") depth++;
    else if (content[i] === "]") depth--;
    i++;
  } while (depth > 0 && i < content.length);
  return content.slice(0, idx) + content.slice(i);
}

/**
 * Extract the content between a top-level `key: { ... }` block's braces
 * (bracket-depth aware). A naive `/key:\s*\{([\s\S]*?)\n\s*\},?/` regex stops
 * at the FIRST nested closing brace, so with more than one locale entry
 * (`locales: { ja: {...}, de: {...} }`) it silently returns only the first
 * locale's block and every later locale gets dropped from `localeDirs`.
 */
function extractBracedBlock(content, key) {
  const keyIdx = content.indexOf(`${key}:`);
  if (keyIdx === -1) return null;
  const braceStart = content.indexOf("{", keyIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  let i = braceStart;
  do {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
    i++;
  } while (depth > 0 && i < content.length);
  return content.slice(braceStart + 1, i - 1);
}

export async function parseBasePath(settingsPath) {
  const content = stripVersionsBlock(await readFile(settingsPath, "utf-8"));
  const match = content.match(/base:\s*["']([^"']*)["']/);
  return match ? match[1] : "/";
}

export async function parseTrailingSlash(settingsPath) {
  const content = stripVersionsBlock(await readFile(settingsPath, "utf-8"));
  const match = content.match(/trailingSlash:\s*(true|false)/);
  return match ? match[1] === "true" : false;
}

export async function parseContentDirs(settingsPath) {
  const content = stripVersionsBlock(await readFile(settingsPath, "utf-8"));

  // Extract docsDir
  const docsDirMatch = content.match(/docsDir:\s*["']([^"']*)["']/);
  const docsDir = docsDirMatch ? docsDirMatch[1] : "src/content/docs";

  // Extract locale content dirs. Supports both the legacy `docsJaDir: "..."`
  // form and the current settings shape `locales: { ja: { dir: "..." } }`.
  const localeDirs = [];
  const legacyRegex = /docs[A-Z][a-z]+Dir:\s*["']([^"']*)["']/g;
  let legacyMatch;
  while ((legacyMatch = legacyRegex.exec(content)) !== null) {
    localeDirs.push(legacyMatch[1]);
  }
  // Current shape: pull each `dir: "..."` out of the `locales` object —
  // depth-aware so every configured locale is captured, not just the first.
  const localesBlock = extractBracedBlock(content, "locales");
  if (localesBlock) {
    const dirRegex = /\bdir:\s*["']([^"']*)["']/g;
    let dirMatch;
    while ((dirMatch = dirRegex.exec(localesBlock)) !== null) {
      localeDirs.push(dirMatch[1]);
    }
  }

  return { docsDir, localeDirs: [...new Set(localeDirs)] };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function collectFiles(dir, extensions) {
  const results = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results.sort();
}

// --- HTML Link Extraction ---

export function extractHtmlLinks(html) {
  const links = [];
  // 4.x `zfb build` output is minified with UNQUOTED attribute values
  // (`href=/docs/...` rather than `href="/docs/..."`), unlike the pre-4.x
  // build. Match all three HTML5 attribute-value forms — double-quoted,
  // single-quoted, and unquoted (terminated by whitespace/`>`/backtick, per
  // the HTML5 unquoted-attribute-value grammar) — or this extractor returns
  // zero links against real 4.x dist output and every check silently no-ops.
  const regex = /<a\s[^>]*?href=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))[^>]*>/gi;
  let match;
  let lastIndex = 0;
  let currentLine = 1;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1] ?? match[2] ?? match[3];
    if (/^https?:\/\//i.test(href)) continue;
    if (/^#/.test(href)) continue;
    if (/^mailto:/i.test(href)) continue;
    if (/^javascript:/i.test(href)) continue;
    if (/^data:/i.test(href)) continue;
    if (/^tel:/i.test(href)) continue;

    for (let i = lastIndex; i < match.index; i++) {
      if (html[i] === '\n') currentLine++;
    }
    lastIndex = match.index;
    links.push({ href, line: currentLine });
  }
  return links;
}

// --- Link Resolution ---

/**
 * Resolve a link and return its resolution type:
 *   'root'           — empty path or resolves to the site root (always valid)
 *   'file'           — resolved to a file with an extension or a .html file
 *   'directoryIndex' — resolved via dir/index.html (page link without trailing slash)
 *   'missing'        — target does not exist
 */
/**
 * Parse dist/_redirects (Cloudflare Workers static-asset redirects) into
 * matchers. Without this the checker reports a redirected URL as broken: it
 * resolves hrefs against files on disk, and a redirect source has no file.
 *
 * Supports the two rule forms this project uses — `:placeholder` (one segment)
 * and `*` (splat) — and substitutes captures back into the target so the
 * TARGET is resolved too. A rule pointing at a nonexistent page is still a
 * broken link, and must not be laundered into a pass by the mere presence of
 * a redirect.
 *
 * Cached per distDir: _redirects does not change during a run.
 */
const redirectRuleCache = new Map();

async function loadRedirectRules(distDir) {
  if (redirectRuleCache.has(distDir)) return redirectRuleCache.get(distDir);

  const rules = [];
  const file = join(distDir, "_redirects");
  if (await fileExists(file)) {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [from, to] = trimmed.split(/\s+/);
      if (!from || !to) continue;

      // Capture names in SOURCE order, so the target can substitute by name.
      // Cloudflare binds `*` to `:splat` and `:name` to that same `:name` —
      // positional substitution breaks as soon as a rule has both (a target
      // `:splat` would otherwise pick up the `:version` capture).
      const names = [];
      for (const m of from.matchAll(/\*|:[A-Za-z_]\w*/g)) {
        names.push(m[0] === "*" ? "splat" : m[0].slice(1));
      }

      // Escape regex metacharacters, then re-open the two wildcard forms.
      const pattern = from
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, "(.*)")
        .replace(/:[A-Za-z_]\w*/g, "([^/]+)");
      rules.push({ regex: new RegExp(`^${pattern}$`), to, names });
    }
  }
  redirectRuleCache.set(distDir, rules);
  return rules;
}

/** Substitute a rule's captures into its target, matching `:name` by name. */
function applyRedirectTarget(to, names, captures) {
  const bound = new Map(names.map((n, i) => [n, captures[i] ?? ""]));
  return to.replace(/:[A-Za-z_]\w*/g, (token) => bound.get(token.slice(1)) ?? token);
}

export async function resolveLinkDetail(
  href,
  distDir,
  basePath = "/",
  fileDir = "",
  followRedirects = true,
) {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return "root";

  let absolute = clean;

  // Resolve relative links against the file's directory within dist
  if (!clean.startsWith("/")) {
    // Relative link — resolve against the file's containing directory
    const dirInDist = fileDir ? relative(distDir, fileDir) : "";
    absolute = "/" + join(dirInDist, clean);
  }

  // Strip base path prefix from the href to get the path relative to dist/
  let stripped = absolute;
  if (basePath !== "/" && stripped.startsWith(basePath)) {
    stripped = "/" + stripped.slice(basePath.length);
  }

  const relPath = stripped.startsWith("/") ? stripped.slice(1) : stripped;
  if (!relPath) return "root";

  const onDisk = await resolveOnDisk(relPath, distDir);
  if (onDisk !== "missing") return onDisk;

  // Nothing on disk — the asset layer may still serve it via _redirects.
  // This fallback must sit AFTER every on-disk branch, not inside one: a
  // redirect source is exactly a path with no file behind it, and each branch
  // shape (extension / trailing slash / bare) can be a redirect source.
  if (followRedirects) {
    const redirected = await resolveViaRedirects(stripped, distDir, basePath);
    if (redirected) return redirected;
  }
  return "missing";
}

/** Resolve a dist-relative path against built files only. */
async function resolveOnDisk(relPath, distDir) {
  // Has file extension → check exact path
  if (extname(relPath)) {
    return (await fileExists(join(distDir, relPath))) ? "file" : "missing";
  }

  // Ends with / → check index.html inside
  if (relPath.endsWith("/")) {
    return (await fileExists(join(distDir, relPath, "index.html"))) ? "directoryIndex" : "missing";
  }

  // No extension, no trailing slash → try dir/index.html then .html
  if (await fileExists(join(distDir, relPath, "index.html"))) return "directoryIndex";
  if (await fileExists(join(distDir, relPath + ".html"))) return "file";
  return "missing";
}

/**
 * Match a path against dist/_redirects and resolve the rule's target.
 * Returns "redirect" only when the target itself resolves — a rule pointing
 * nowhere leaves the link broken.
 */
async function resolveViaRedirects(pathname, distDir, basePath) {
  const rules = await loadRedirectRules(distDir);
  for (const rule of rules) {
    const m = pathname.match(rule.regex);
    if (!m) continue;
    const target = applyRedirectTarget(rule.to, rule.names, m.slice(1));
    const targetType = await resolveLinkDetail(target, distDir, basePath, "", false);
    if (targetType !== "missing") return "redirect";
  }
  return null;
}

export async function resolveLink(href, distDir, basePath = "/", fileDir = "") {
  const type = await resolveLinkDetail(href, distDir, basePath, fileDir);
  return type !== "missing";
}

// --- MDX Source Scan ---

/**
 * Strip inline-code spans from a line before running link regexes.
 * Handles double-backtick spans (``...``) and single-backtick spans (`...`).
 * Escaped backticks (\`) are ignored.
 */
export function stripInlineCode(line) {
  // Replace double-backtick spans first to avoid partial single-backtick matches
  let result = line.replace(/(?<!\\)``[^`]*(?:``|$)/g, (m) => " ".repeat(m.length));
  // Replace single-backtick spans
  result = result.replace(/(?<!\\)`[^`]*(?:`|$)/g, (m) => " ".repeat(m.length));
  return result;
}

export function extractMdxAbsoluteLinks(content) {
  const issues = [];
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const searchLine = stripInlineCode(line);

    // Markdown link syntax: [text](/docs/...) or [text](/ja/docs/...)
    const mdRegex = /\]\((\/(?:ja\/)?docs\/[^)]*)\)/g;
    let match;
    while ((match = mdRegex.exec(searchLine)) !== null) {
      issues.push({ href: match[1], line: i + 1 });
    }

    // JSX href attributes: href="/docs/..." or href="/ja/docs/..."
    const jsxRegex = /href="(\/(?:ja\/)?docs\/[^"]*)"/g;
    while ((match = jsxRegex.exec(searchLine)) !== null) {
      issues.push({ href: match[1], line: i + 1 });
    }
  }

  return issues;
}

// --- Main Check Functions ---

export async function checkHtmlLinks(distDir, rootDir, basePath = "/", excludePatterns = []) {
  const broken = [];
  const htmlFiles = await collectFiles(distDir, [".html"]);
  const cache = new Map();

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf-8");
    const links = extractHtmlLinks(content);
    const fileDir = dirname(file);

    for (const { href, line } of links) {
      if (excludePatterns.some((p) => p.test(href))) continue;

      // Cache key: absolute links use href only; relative links include fileDir
      const cacheKey = href.startsWith("/") ? href : `${fileDir}:${href}`;
      let exists;
      if (cache.has(cacheKey)) {
        exists = cache.get(cacheKey);
      } else {
        exists = await resolveLink(href, distDir, basePath, fileDir);
        cache.set(cacheKey, exists);
      }

      if (!exists) {
        broken.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return broken;
}

export async function checkTrailingSlashLinks(distDir, rootDir, basePath = "/", excludePatterns = []) {
  const warnings = [];
  const htmlFiles = await collectFiles(distDir, [".html"]);
  const cache = new Map();

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf-8");
    const links = extractHtmlLinks(content);
    const fileDir = dirname(file);

    for (const { href, line } of links) {
      if (excludePatterns.some((p) => p.test(href))) continue;

      // Extract path portion (strip query string and fragment)
      const pathPart = href.split("#")[0].split("?")[0];

      // Skip root-like paths: empty, "/", ".", "./"
      if (!pathPart || pathPart === "/" || pathPart === "." || pathPart === "./") continue;

      // Skip links that already have a trailing slash
      if (pathPart.endsWith("/")) continue;

      // Skip links with file extensions (assets)
      if (extname(pathPart)) continue;

      // Cache key: absolute links use href only; relative links include fileDir
      const cacheKey = href.startsWith("/") ? href : `${fileDir}:${href}`;
      let type;
      if (cache.has(cacheKey)) {
        type = cache.get(cacheKey);
      } else {
        type = await resolveLinkDetail(href, distDir, basePath, fileDir);
        cache.set(cacheKey, type);
      }

      // Only warn for links that resolve to a directory index (page links missing trailing slash)
      if (type === "directoryIndex") {
        warnings.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return warnings;
}

export async function checkMdxLinks(contentDirs, rootDir, distDir = null, basePath = "/") {
  const warnings = [];

  for (const dir of contentDirs) {
    if (!(await fileExists(dir))) continue;
    const files = await collectFiles(dir, [".mdx", ".md"]);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const issues = extractMdxAbsoluteLinks(content);

      for (const { href, line } of issues) {
        // If dist/ is available, drop warnings for hrefs that resolve to built routes
        if (distDir && (await resolveLink(href, distDir, basePath))) continue;
        warnings.push({ file: relative(rootDir, file), line, href });
      }
    }
  }

  return warnings;
}

// --- Report ---

export function formatReport(brokenLinks, mdxWarnings, trailingSlashWarnings = []) {
  const lines = [];

  if (brokenLinks.length > 0) {
    lines.push("=== Broken Links in Built HTML ===");
    for (const { file, line, href } of brokenLinks) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  if (mdxWarnings.length > 0) {
    lines.push("=== Absolute Links Bypassing Base Path (MDX Source) ===");
    for (const { file, line, href } of mdxWarnings) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  if (trailingSlashWarnings.length > 0) {
    lines.push("=== Links Missing Trailing Slash ===");
    for (const { file, line, href } of trailingSlashWarnings) {
      lines.push(`  ${file}:${line}  ${href}`);
    }
    lines.push("");
  }

  const total = brokenLinks.length + mdxWarnings.length + trailingSlashWarnings.length;
  if (total > 0) {
    const parts = [];
    if (brokenLinks.length > 0) {
      parts.push(
        `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"}`,
      );
    }
    if (mdxWarnings.length > 0) {
      parts.push(
        `${mdxWarnings.length} absolute path warning${mdxWarnings.length === 1 ? "" : "s"}`,
      );
    }
    if (trailingSlashWarnings.length > 0) {
      parts.push(
        `${trailingSlashWarnings.length} trailing slash warning${trailingSlashWarnings.length === 1 ? "" : "s"}`,
      );
    }
    lines.push(`✗ Found ${parts.join(" and ")}`);
  } else {
    lines.push("✓ No broken links or absolute path issues found");
  }

  return lines.join("\n");
}

// --- Allowlist ---

/**
 * Read the allowlist file (one entry per line; `#` comments stripped).
 * Each non-blank line is a literal `<file>:<line>:<href>` exact match.
 * Returns a Set for O(1) lookup against `entryKey()` output below.
 */
export async function readAllowlist(allowlistPath) {
  const empty = { exact: new Set(), hrefs: new Set() };
  if (!allowlistPath) return empty;
  if (!(await fileExists(allowlistPath))) return empty;
  const text = await readFile(allowlistPath, "utf-8");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0);

  // Two entry forms:
  //   file:line:href  — pins one occurrence (default; precise but line-fragile)
  //   href=<href>     — allows that href wherever it appears
  // The href= form exists for upstream bugs that emit the SAME broken link
  // from every page of a tree: pinning those by line means dozens of entries
  // that all silently stop matching the moment any content edit shifts a line,
  // turning the allowlist into a no-op without anyone noticing.
  const exact = new Set();
  const hrefs = new Set();
  for (const line of lines) {
    if (line.startsWith("href=")) hrefs.add(line.slice("href=".length).trim());
    else exact.add(line);
  }
  return { exact, hrefs };
}

function entryKey(e) {
  return `${e.file}:${e.line}:${e.href}`;
}

function isAllowlisted(allowlist, e) {
  return allowlist.exact.has(entryKey(e)) || allowlist.hrefs.has(e.href);
}

// --- Main ---

async function main() {
  const rootDir = resolve(__dirname, "..");
  // 4.x: settings live inline in the `zudoDoc({...})` call in zfb.config.ts —
  // there is no standalone `src/config/settings.ts` anymore.
  const settingsPath = join(rootDir, "zfb.config.ts");
  const basePath = await parseBasePath(settingsPath);
  const trailingSlash = await parseTrailingSlash(settingsPath);
  const distDir = join(rootDir, "dist");

  console.log(`Checking links (base: ${basePath}, trailingSlash: ${trailingSlash})...\n`);

  if (!(await fileExists(distDir))) {
    console.error("Error: dist/ directory not found. Run 'pnpm build' first.");
    process.exit(1);
  }

  // Versioned (/v/<slug>/) links ARE checked. They used to be excluded
  // wholesale ("version content may be incomplete"), but that also hid real,
  // fixable 404s — the versions-page entry-slug bug (issue #168) lived under
  // that blanket exemption for its whole life. Genuinely unavoidable
  // upstream-caused breakage belongs in .check-links-allowlist, named and
  // dated, so it stays visible instead of silently covering the whole tree.
  const excludePatterns = [];

  const { docsDir, localeDirs } = await parseContentDirs(settingsPath);
  const contentDirs = [join(rootDir, docsDir), ...localeDirs.map((d) => join(rootDir, d))];

  const checks = [
    checkHtmlLinks(distDir, rootDir, basePath, excludePatterns),
    checkMdxLinks(contentDirs, rootDir, distDir, basePath),
  ];

  if (trailingSlash) {
    checks.push(checkTrailingSlashLinks(distDir, rootDir, basePath, excludePatterns));
  }

  let [brokenLinks, mdxWarnings, trailingSlashWarnings = []] = await Promise.all(checks);

  // --- Flag parsing ---
  //
  // Three strict knobs (separable so a deploy can fail on real 404s
  // without blocking on warn-only categories) plus an allowlist:
  //
  //   --strict           legacy: fail when any category has entries
  //   --strict-broken    fail when broken links > 0 (after allowlist)
  //   --strict-absolute  fail when absolute warnings > 0 (after allowlist)
  //   --strict-trailing  fail when trailing-slash warnings > 0 (after allowlist)
  //   --allowlist=PATH   skip entries listed in PATH (one
  //                      `<file>:<line>:<href>` per line, `#` comments)
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const strictBroken = strict || argv.includes("--strict-broken");
  const strictAbsolute = strict || argv.includes("--strict-absolute");
  const strictTrailing = strict || argv.includes("--strict-trailing");
  const allowlistArg = argv.find((a) => a.startsWith("--allowlist="));
  const allowlistPath = allowlistArg ? allowlistArg.split("=").slice(1).join("=") : null;
  const resolvedAllowlist = allowlistPath
    ? (allowlistPath.startsWith("/") ? allowlistPath : join(rootDir, allowlistPath))
    : null;
  const allowlist = await readAllowlist(resolvedAllowlist);

  // Filter out allowlisted entries before strict-mode decisions but
  // AFTER the printed report — so the report shows the full picture
  // and the strict gate counts only "real" entries.
  const filterOut = (entries) => entries.filter((e) => !isAllowlisted(allowlist, e));
  const realBroken = filterOut(brokenLinks);
  const realAbsolute = filterOut(mdxWarnings);
  const realTrailing = filterOut(trailingSlashWarnings);

  console.log(formatReport(brokenLinks, mdxWarnings, trailingSlashWarnings));

  if (allowlist.exact.size + allowlist.hrefs.size > 0) {
    const skipped =
      (brokenLinks.length - realBroken.length) +
      (mdxWarnings.length - realAbsolute.length) +
      (trailingSlashWarnings.length - realTrailing.length);
    if (skipped > 0) {
      console.log(
        `\nAllowlist: ${skipped} known exception${skipped === 1 ? "" : "s"} excluded from strict-mode counts (${resolvedAllowlist}).`,
      );
    }
  }

  const hasIssues =
    brokenLinks.length > 0 || mdxWarnings.length > 0 || trailingSlashWarnings.length > 0;

  // Per-category strict failure (real counts). Combined into one exit
  // code so b4push only needs one invocation. Print which category
  // tripped before exiting so the diagnosis is obvious from the log.
  let failed = false;
  if (strictBroken && realBroken.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realBroken.length} broken link${realBroken.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (strictAbsolute && realAbsolute.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realAbsolute.length} absolute MDX-source link${realAbsolute.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (strictTrailing && realTrailing.length > 0) {
    console.log(`\n❌ STRICT FAIL: ${realTrailing.length} trailing-slash warning${realTrailing.length === 1 ? "" : "s"} (after allowlist).`);
    failed = true;
  }
  if (failed) {
    process.exit(1);
  }

  if (hasIssues && !strictBroken && !strictAbsolute && !strictTrailing) {
    console.log("\nNote: Issues found but running in non-strict mode (exit 0).");
    console.log(
      "Use --strict-broken / --strict-absolute / --strict-trailing (or --strict for all) to fail on issues.",
    );
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
