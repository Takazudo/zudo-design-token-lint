/**
 * Browser-safe lint module.
 *
 * Mirrors the core logic from the lint package (src/config.ts, src/extractor.ts,
 * src/rules.ts) without any Node.js API imports (node:fs, node:path).
 * This allows the playground to run linting entirely in the browser.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface LintConfig {
  prohibited: string[];
  allowed: string[];
  ignore: string[];
  suggestionSuffix?: string;
}

export interface CompiledRule {
  prefix: string;
  valuePattern: RegExp;
  reasonTemplate: string;
  isSpacingRule: boolean;
}

export interface CompiledConfig {
  rules: CompiledRule[];
  allowed: Set<string>;
  ignore: string[];
}

export interface Violation {
  className: string;
  reason: string;
}

export interface ExtractedClass {
  className: string;
  line: number;
}

export interface LintResult {
  line: number;
  className: string;
  reason: string;
}

// ── Config compilation (from src/config.ts) ────────────────────────

const TAILWIND_COLORS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

export function compilePattern(
  pattern: string,
  suggestionSuffix?: string,
): CompiledRule {
  const placeholderIndex = pattern.indexOf("{");
  if (placeholderIndex === -1) {
    return {
      prefix: pattern,
      valuePattern: /^$/,
      reasonTemplate: `Prohibited class "{CLASS}"`,
      isSpacingRule: false,
    };
  }

  const prefix = pattern.slice(0, placeholderIndex - 1);
  const valuePart = pattern.slice(placeholderIndex);

  let regexStr = "^";
  let reasonTemplate = "";
  let isSpacingRule = false;

  if (valuePart === "{n}") {
    regexStr += "\\d+(\\.\\d+)?";
    const spacingSuffix =
      suggestionSuffix ?? "use a semantic spacing token or arbitrary value";
    reasonTemplate = `Numeric spacing "{CLASS}" — ${spacingSuffix}`;
    isSpacingRule = true;
  } else if (valuePart === "{color}-{shade}") {
    const colorGroup = TAILWIND_COLORS.join("|");
    regexStr += `(${colorGroup})-(\\d{2,3})`;
    const colorSuffix =
      suggestionSuffix ?? "use a design system color token";
    reasonTemplate = `Default Tailwind color "{CLASS}" — ${colorSuffix}`;
  } else {
    regexStr += valuePart
      .replace(/\{n\}/g, "\\d+(\\.\\d+)?")
      .replace(/\{color\}/g, `(${TAILWIND_COLORS.join("|")})`)
      .replace(/\{shade\}/g, "\\d{2,3}");
    reasonTemplate = `Prohibited pattern "{CLASS}"`;
  }

  regexStr += "$";

  return {
    prefix,
    valuePattern: new RegExp(regexStr),
    reasonTemplate,
    isSpacingRule,
  };
}

export function compileConfig(config: LintConfig): CompiledConfig {
  return {
    rules: config.prohibited.map((p) =>
      compilePattern(p, config.suggestionSuffix),
    ),
    allowed: new Set(config.allowed),
    ignore: config.ignore,
  };
}

// ── Class extraction (from src/extractor.ts) ───────────────────────

const IGNORE_PATTERNS = [
  /\/\*\s*design-token-lint-ignore\s*\*\//,
  /\{\/\*\s*design-token-lint-ignore\s*\*\/\}/,
  /\/\/\s*design-token-lint-ignore(?!\S)/,
];

const IGNORE_FILE_PATTERNS = [
  /^\s*\/\*\s*design-token-lint-ignore-file\s*\*\/\s*$/,
  /^\s*\{\/\*\s*design-token-lint-ignore-file\s*\*\/\}\s*$/,
  /^\s*\/\/\s*design-token-lint-ignore-file\s*$/,
];

function isIgnoreLine(line: string): boolean {
  return IGNORE_PATTERNS.some((p) => p.test(line));
}

function addClasses(
  results: ExtractedClass[],
  classString: string,
  line: number,
): void {
  const classes = classString
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  for (const className of classes) {
    results.push({ className, line });
  }
}

export function extractClasses(content: string): ExtractedClass[] {
  const lines = content.split("\n");
  const results: ExtractedClass[] = [];
  const ignoredLines = new Set<number>();

  for (const line of lines) {
    if (IGNORE_FILE_PATTERNS.some((p) => p.test(line))) {
      return [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (isIgnoreLine(lines[i])) {
      ignoredLines.add(i + 1);
    }
  }

  const doubleQuoteAttr = /(?:className|class)\s*=\s*"([^"]+)"/g;
  const singleQuoteAttr = /(?:className|class)\s*=\s*'([^']+)'/g;
  const singleQuoteBrace = /(?:className|class)\s*=\s*\{\s*'([^']+)'\s*\}/g;
  const templateLiteral = /(?:className|class)\s*=\s*\{\s*`([^`]+)`\s*\}/g;
  const classListPattern = /class:list\s*=\s*\{\s*\[([^\]]+)\]\s*\}/g;
  const utilFnPattern =
    /(?:cn|clsx|classNames|twMerge)\s*\(\s*([^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    if (ignoredLines.has(i)) continue;

    const line = lines[i];
    const lineNum = i + 1;

    for (const match of line.matchAll(doubleQuoteAttr)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(singleQuoteAttr)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(singleQuoteBrace)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(templateLiteral)) {
      addClasses(results, match[1], lineNum);
    }
    for (const match of line.matchAll(classListPattern)) {
      const arrayContent = match[1];
      for (const strMatch of arrayContent.matchAll(/['"]([^'"]+)['"]/g)) {
        addClasses(results, strMatch[1], lineNum);
      }
    }
    for (const match of line.matchAll(utilFnPattern)) {
      const argsContent = match[1];
      for (const strMatch of argsContent.matchAll(/['"]([^'"]+)['"]/g)) {
        addClasses(results, strMatch[1], lineNum);
      }
    }
  }

  return results;
}

// ── Rule matching (from src/rules.ts) ──────────────────────────────

function matchRule(
  originalClassName: string,
  withoutNeg: string,
  rule: CompiledRule,
): Violation | null {
  if (rule.valuePattern.source === "^$") {
    if (withoutNeg === rule.prefix) {
      return {
        className: originalClassName,
        reason: rule.reasonTemplate.replace("{CLASS}", originalClassName),
      };
    }
    return null;
  }

  if (
    withoutNeg === rule.prefix ||
    !withoutNeg.startsWith(rule.prefix + "-")
  ) {
    return null;
  }

  const value = withoutNeg.slice(rule.prefix.length + 1);

  if (
    rule.isSpacingRule &&
    (value.startsWith("hgap-") || value.startsWith("vgap-"))
  ) {
    return null;
  }

  if (rule.isSpacingRule && (value === "0" || value === "1px")) {
    return null;
  }

  if (rule.valuePattern.test(value)) {
    return {
      className: originalClassName,
      reason: rule.reasonTemplate.replace("{CLASS}", originalClassName),
    };
  }

  return null;
}

export function checkClassWithConfig(
  className: string,
  config: CompiledConfig,
): Violation | null {
  const lastColon = className.lastIndexOf(":");
  let stripped = lastColon >= 0 ? className.slice(lastColon + 1) : className;

  if (stripped.startsWith("!")) {
    stripped = stripped.slice(1);
  }

  const isNegative = stripped.startsWith("-");
  const withoutNeg = isNegative ? stripped.slice(1) : stripped;

  const slashIdx = withoutNeg.indexOf("/");
  const withoutOpacity =
    slashIdx >= 0 ? withoutNeg.slice(0, slashIdx) : withoutNeg;

  if (withoutOpacity.includes("[")) {
    return null;
  }

  if (config.allowed.has(withoutOpacity)) {
    return null;
  }

  for (const rule of config.rules) {
    const violation = matchRule(className, withoutOpacity, rule);
    if (violation) {
      return violation;
    }
  }

  return null;
}

// ── Lint content (browser-safe version of src/linter.ts) ───────────

export function lintContent(
  content: string,
  compiledConfig: CompiledConfig,
): LintResult[] {
  const classes = extractClasses(content);
  const results: LintResult[] = [];

  for (const { className, line } of classes) {
    const violation = checkClassWithConfig(className, compiledConfig);
    if (violation) {
      results.push({
        line,
        className: violation.className,
        reason: violation.reason,
      });
    }
  }

  return results;
}
