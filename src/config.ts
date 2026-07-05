/**
 * Configuration loader for design-token-lint.
 *
 * Loads a JSON config file from the project root, falling back to
 * built-in defaults if no config is found.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Thrown by loadConfig when a config file exists but cannot be used —
 * malformed JSON, an unreadable file, or a field with the wrong type.
 * Distinct from "no config file found", which falls through to the next
 * candidate filename (or to DEFAULT_CONFIG) silently.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LintConfig {
  /**
   * Patterns to flag as violations. Placeholders: {n} = number, {color} =
   * Tailwind color, {shade} = shade (50-950). An entry with no placeholder
   * (e.g. "hidden", "-mt-px", "hover:p-2", "p-4!") is an exact-match rule:
   * it fires on the normalized candidate (variant/important/negative/opacity
   * stripped) OR the verbatim className — mirroring `allowed` below — so a
   * leading "-", a variant prefix, or a "!" important modifier in the entry
   * is intentional and matches only that literal form.
   *
   * REPLACE semantics: when present, this list wins outright over whatever
   * `extends` would otherwise have produced. Omit it (and use `extends` /
   * `prohibitedAdd` instead) to inherit and append rather than replace.
   */
  prohibited?: string[];
  /**
   * Exceptions that are always allowed, even if they match a prohibited pattern.
   * Each entry is matched two ways: the normalized form (variant prefix, `!`
   * important modifier, leading `-` negative sign, and `/N` opacity suffix all
   * stripped — so a bare entry like "p-4" also covers "hover:p-4", "-p-4",
   * "p-4!", etc.) AND the exact original string (so a specific variant like
   * "hover:p-2", copied verbatim from a violation message, can be allowed
   * without opening up the bare "p-2" form or its other variants).
   *
   * REPLACE semantics — see `prohibited` above.
   */
  allowed?: string[];
  /** File path globs to skip entirely */
  ignore: string[];
  /** File glob patterns to scan (used by CLI when no args are given) */
  patterns?: string[];
  /** Custom suffix for suggestion messages (replaces the default "use a semantic spacing token..." text) */
  suggestionSuffix?: string;
  /** Value prefixes that indicate a semantic spacing token and bypass spacing rules. Default: ["hgap-", "vgap-"] */
  semanticPrefixes?: string[];
  /** HTML/JSX attributes to scan for class names. Default: ["className", "class"] */
  classAttributes?: string[];
  /** Utility function names to scan for class name arguments. Default: ["cn", "clsx", "classNames", "twMerge"] */
  classFunctions?: string[];
  /**
   * Named preset(s) to inherit `prohibited`/`allowed` patterns from. Layers
   * merge in array order (e.g. `["default", "z-index"]`) — presets never
   * auto-compose with "default", it must be listed explicitly. See
   * `CONFIG_PRESETS` for the registry of known preset names. An unknown name
   * throws `ConfigError`. Absent `extends` is fully backward compatible: the
   * built-in DEFAULT_CONFIG fallback behaves exactly as before.
   */
  extends?: string | string[];
  /**
   * Patterns appended after `prohibited` is resolved (either the explicit
   * `prohibited` list, the `extends`-merged list, or the DEFAULT_CONFIG
   * fallback) — lets a config inherit defaults/presets and add just a few
   * extra rules without duplicating the inherited list.
   */
  prohibitedAdd?: string[];
  /** Same as `prohibitedAdd`, but appended after `allowed` is resolved. */
  allowedAdd?: string[];
}

/**
 * A named, registered preset usable via the `extends` config field. Contributes
 * `prohibited` (required) and optionally `allowed` patterns that get
 * concatenated with sibling extends layers in array order.
 */
export interface ConfigPreset {
  prohibited: string[];
  allowed?: string[];
}

// Standard Tailwind color names
const TAILWIND_COLORS = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

/** Built-in defaults matching the original hardcoded rules */
export const DEFAULT_CONFIG: LintConfig & {
  prohibited: string[];
  allowed: string[];
  classAttributes: string[];
  classFunctions: string[];
  semanticPrefixes: string[];
} = {
  prohibited: [
    'p-{n}',
    'px-{n}',
    'py-{n}',
    'pt-{n}',
    'pr-{n}',
    'pb-{n}',
    'pl-{n}',
    'ps-{n}',
    'pe-{n}',
    'm-{n}',
    'mx-{n}',
    'my-{n}',
    'mt-{n}',
    'mr-{n}',
    'mb-{n}',
    'ml-{n}',
    'ms-{n}',
    'me-{n}',
    'gap-{n}',
    'gap-x-{n}',
    'gap-y-{n}',
    'space-x-{n}',
    'space-y-{n}',
    'inset-{n}',
    'inset-x-{n}',
    'inset-y-{n}',
    'top-{n}',
    'right-{n}',
    'bottom-{n}',
    'left-{n}',
    'start-{n}',
    'end-{n}',
    'scroll-m-{n}',
    'scroll-mx-{n}',
    'scroll-my-{n}',
    'scroll-mt-{n}',
    'scroll-mr-{n}',
    'scroll-mb-{n}',
    'scroll-ml-{n}',
    'scroll-p-{n}',
    'scroll-px-{n}',
    'scroll-py-{n}',
    'scroll-pt-{n}',
    'scroll-pr-{n}',
    'scroll-pb-{n}',
    'scroll-pl-{n}',
    'bg-{color}-{shade}',
    'text-{color}-{shade}',
    'border-{color}-{shade}',
    'border-t-{color}-{shade}',
    'border-r-{color}-{shade}',
    'border-b-{color}-{shade}',
    'border-l-{color}-{shade}',
    'border-x-{color}-{shade}',
    'border-y-{color}-{shade}',
    'border-s-{color}-{shade}',
    'border-e-{color}-{shade}',
    'outline-{color}-{shade}',
    'ring-{color}-{shade}',
    'ring-offset-{color}-{shade}',
    'inset-ring-{color}-{shade}',
    'divide-{color}-{shade}',
    'from-{color}-{shade}',
    'via-{color}-{shade}',
    'to-{color}-{shade}',
    'accent-{color}-{shade}',
    'caret-{color}-{shade}',
    'fill-{color}-{shade}',
    'stroke-{color}-{shade}',
    'decoration-{color}-{shade}',
    'placeholder-{color}-{shade}',
    'shadow-{color}-{shade}',
    'inset-shadow-{color}-{shade}',
    'text-shadow-{color}-{shade}',
  ],
  allowed: ['p-0', 'm-0', 'gap-0', 'p-1px'],
  ignore: ['**/*.test.*', '**/*.stories.*'],
  semanticPrefixes: ['hgap-', 'vgap-'],
  classAttributes: ['className', 'class'],
  classFunctions: ['cn', 'clsx', 'classNames', 'twMerge'],
};

/** Name of the built-in preset wrapping DEFAULT_CONFIG's prohibited/allowed lists. */
export const DEFAULT_PRESET_NAME = 'default';

/**
 * Registry of named presets usable via the `extends` config field. To add a
 * new preset (e.g. a future "z-index" preset), add an entry here — extends
 * resolution and merging pick it up automatically with no other code changes.
 */
export const CONFIG_PRESETS: Record<string, ConfigPreset> = {
  [DEFAULT_PRESET_NAME]: {
    prohibited: DEFAULT_CONFIG.prohibited,
    allowed: DEFAULT_CONFIG.allowed,
  },
};

/**
 * Convert a config pattern like "p-{n}" or "bg-{color}-{shade}" into a RegExp
 * that matches actual Tailwind class values (the part after the prefix).
 *
 * Returns { prefix, valuePattern } where prefix is the utility prefix
 * and valuePattern is a RegExp for the value portion.
 */
export interface CompiledRule {
  prefix: string;
  valuePattern: RegExp;
  /** Reason template with {CLASS} as placeholder for the actual class name */
  reasonTemplate: string;
  /** True for numeric spacing rules — enables semantic token (hgap-/vgap-) allowance */
  isSpacingRule: boolean;
}

// Matches the placeholders compilePattern understands inside a value part.
const PLACEHOLDER_TOKEN = /\{n\}|\{color\}|\{shade\}/g;
const KNOWN_PLACEHOLDER_TOKENS = new Set(['{n}', '{color}', '{shade}']);

/**
 * Escape regex metacharacters in a literal string segment. Mirrors the
 * escapeRegExp helper in extractor.ts (kept local here since config.ts must
 * not depend on extractor.ts).
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate every "{...}" occurrence in a value part: it must be one of the
 * known placeholder tokens ({n}, {color}, {shade}), fully closed, with no
 * stray "}" left unmatched. Without this, a typo like "{number}" or a bare
 * "{}" would silently compile as escaped literal text — the rule would
 * compile without error but never match the classes it was meant to catch.
 */
function validatePlaceholders(pattern: string, valuePart: string): void {
  let i = 0;
  while (i < valuePart.length) {
    const ch = valuePart[i];
    if (ch === '{') {
      const close = valuePart.indexOf('}', i);
      if (close === -1) {
        throw new Error(`Invalid pattern "${pattern}": unclosed placeholder "{"`);
      }
      const token = valuePart.slice(i, close + 1);
      if (!KNOWN_PLACEHOLDER_TOKENS.has(token)) {
        throw new Error(`Invalid pattern "${pattern}": unknown placeholder "${token}"`);
      }
      i = close + 1;
    } else if (ch === '}') {
      throw new Error(`Invalid pattern "${pattern}": unmatched "}" with no preceding "{"`);
    } else {
      i++;
    }
  }
}

/**
 * Expand a placeholder-bearing value part (e.g. "{n}px" or "{color}/{shade}")
 * into a regex source string. Placeholders are expanded to their matcher;
 * everything else is escaped via escapeRegExp so literal regex metacharacters
 * in a custom pattern (e.g. ".", "(", "+") are treated as literal text.
 */
function expandValuePart(valuePart: string): string {
  let result = '';
  let lastIndex = 0;
  PLACEHOLDER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_TOKEN.exec(valuePart))) {
    result += escapeRegExp(valuePart.slice(lastIndex, match.index));
    if (match[0] === '{n}') {
      result += '\\d+(\\.\\d+)?';
    } else if (match[0] === '{color}') {
      result += `(${TAILWIND_COLORS.join('|')})`;
    } else {
      result += '\\d{2,3}';
    }
    lastIndex = match.index + match[0].length;
  }
  result += escapeRegExp(valuePart.slice(lastIndex));
  return result;
}

/**
 * Compile a single pattern string into a rule.
 *
 * Throws a plain Error when the pattern is malformed (e.g. a placeholder
 * not preceded by "-", an unclosed "{", or an unrecognized placeholder
 * like "{number}").
 */
export function compilePattern(pattern: string, suggestionSuffix?: string): CompiledRule {
  // Find the first placeholder
  const placeholderIndex = pattern.indexOf('{');
  if (placeholderIndex === -1) {
    // Exact match pattern (no placeholders). Matched by checkClassWithConfig
    // against BOTH the normalized className and the verbatim className (see
    // the exact-match branch in rules.ts's matchRule). This is deliberate:
    // a pattern containing ":" (e.g. "hover:p-2"), a leading "-" (e.g.
    // "-mt-px"), or a "!" important modifier (e.g. "p-4!", "!p-4") is a
    // valid, intentional exact rule — it only matches that literal verbatim
    // class, never the bare/unmodified token. No validation error is thrown
    // for these shapes; they are a supported (if less common) authoring
    // style, same as prohibited's own README/type-level documentation.
    return {
      prefix: pattern,
      valuePattern: /^$/,
      reasonTemplate: `Prohibited class "{CLASS}"`,
      isSpacingRule: false,
    };
  }

  if (placeholderIndex === 0 || pattern[placeholderIndex - 1] !== '-') {
    throw new Error(`Invalid pattern "${pattern}": placeholder "{" must be preceded by "-"`);
  }

  // Split into prefix (everything before the placeholder, minus trailing -)
  const prefix = pattern.slice(0, placeholderIndex - 1);
  const valuePart = pattern.slice(placeholderIndex);
  validatePlaceholders(pattern, valuePart);

  // Build regex from the value part
  let regexStr = '^';
  let reasonTemplate = '';
  let isSpacingRule = false;

  if (valuePart === '{n}') {
    regexStr += '\\d+(\\.\\d+)?';
    const spacingSuffix = suggestionSuffix ?? 'use a semantic spacing token or arbitrary value';
    reasonTemplate = `Numeric spacing "{CLASS}" — ${spacingSuffix}`;
    isSpacingRule = true;
  } else if (valuePart === '{color}-{shade}') {
    const colorGroup = TAILWIND_COLORS.join('|');
    regexStr += `(${colorGroup})-(\\d{2,3})`;
    const colorSuffix = suggestionSuffix ?? 'use a design system color token';
    reasonTemplate = `Default Tailwind color "{CLASS}" — ${colorSuffix}`;
  } else {
    // Generic placeholder handling (literal segments are escaped for safety)
    regexStr += expandValuePart(valuePart);
    reasonTemplate = `Prohibited pattern "{CLASS}"`;
  }

  regexStr += '$';

  return {
    prefix,
    valuePattern: new RegExp(regexStr),
    reasonTemplate,
    isSpacingRule,
  };
}

/**
 * Compile an entire config into a set of rules ready for matching.
 */
export interface CompiledConfig {
  rules: CompiledRule[];
  allowed: Set<string>;
  ignore: string[];
  /** Value prefixes that bypass spacing rules (e.g. semantic token names) */
  semanticPrefixes: string[];
  /** HTML/JSX attributes to scan for class names */
  classAttributes: string[];
  /** Utility function names to scan for class name arguments */
  classFunctions: string[];
}

/**
 * Normalize the `extends` field into an ordered list of preset names.
 * A bare string is treated as a single-element list.
 */
function normalizeExtendsList(extendsField: string | string[] | undefined): string[] {
  if (extendsField === undefined) {
    return [];
  }
  return Array.isArray(extendsField) ? extendsField : [extendsField];
}

/** Look up a preset by name, throwing ConfigError for an unregistered name. */
function resolvePreset(name: string): ConfigPreset {
  const preset = CONFIG_PRESETS[name];
  if (!preset) {
    const known = Object.keys(CONFIG_PRESETS).join(', ');
    throw new ConfigError(`Unknown preset "${name}" in "extends" (known presets: ${known})`);
  }
  return preset;
}

/**
 * Resolve the effective `prohibited`/`allowed` lists for a config, applying
 * (in order): an explicit list (replace), else the `extends` layers merged
 * in array order, else the DEFAULT_CONFIG fallback — followed by
 * `prohibitedAdd`/`allowedAdd` appended on top of whichever base won.
 */
function resolvePatternLists(config: LintConfig): { prohibited: string[]; allowed: string[] } {
  const presetNames = normalizeExtendsList(config.extends);
  const presets = presetNames.map(resolvePreset);
  const hasExtends = presets.length > 0;

  const baseProhibited =
    config.prohibited ??
    (hasExtends ? presets.flatMap((preset) => preset.prohibited) : DEFAULT_CONFIG.prohibited);
  const baseAllowed =
    config.allowed ??
    (hasExtends ? presets.flatMap((preset) => preset.allowed ?? []) : DEFAULT_CONFIG.allowed);

  return {
    prohibited: config.prohibitedAdd
      ? [...baseProhibited, ...config.prohibitedAdd]
      : baseProhibited,
    allowed: config.allowedAdd ? [...baseAllowed, ...config.allowedAdd] : baseAllowed,
  };
}

export function compileConfig(config: LintConfig): CompiledConfig {
  const { prohibited, allowed } = resolvePatternLists(config);
  return {
    rules: prohibited.map((p) => compilePattern(p, config.suggestionSuffix)),
    allowed: new Set(allowed),
    ignore: config.ignore,
    semanticPrefixes: (config.semanticPrefixes ?? DEFAULT_CONFIG.semanticPrefixes).filter(
      (p) => p.length > 0,
    ),
    classAttributes: config.classAttributes ?? DEFAULT_CONFIG.classAttributes,
    classFunctions: config.classFunctions ?? DEFAULT_CONFIG.classFunctions,
  };
}

const CONFIG_FILENAMES = ['.design-token-lint.json', 'design-token-lint.config.json'];

// Config fields whose value, when present, must be a string array.
const STRING_ARRAY_FIELDS = [
  'prohibited',
  'allowed',
  'ignore',
  'patterns',
  'semanticPrefixes',
  'classAttributes',
  'classFunctions',
  'prohibitedAdd',
  'allowedAdd',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validate the shape of a parsed config object. Throws ConfigError naming
 * the offending file and field on the first mismatch found.
 */
function validateConfigFields(parsed: Record<string, unknown>, filename: string): void {
  for (const field of STRING_ARRAY_FIELDS) {
    const value = parsed[field];
    if (value !== undefined && !isStringArray(value)) {
      throw new ConfigError(`Invalid config ${filename}: "${field}" must be an array of strings`);
    }
  }
  if (
    parsed.extends !== undefined &&
    typeof parsed.extends !== 'string' &&
    !isStringArray(parsed.extends)
  ) {
    throw new ConfigError(
      `Invalid config ${filename}: "extends" must be a string or an array of strings`,
    );
  }
  if (parsed.suggestionSuffix !== undefined && typeof parsed.suggestionSuffix !== 'string') {
    throw new ConfigError(`Invalid config ${filename}: "suggestionSuffix" must be a string`);
  }
}

/**
 * Load config from the given directory, falling back to defaults.
 *
 * A missing file (ENOENT) falls through to the next candidate filename, and
 * to DEFAULT_CONFIG if none are found — silently, as before. A file that
 * exists but cannot be read, isn't valid JSON, or has a wrongly-typed field
 * throws a ConfigError instead of being swallowed.
 */
export async function loadConfig(cwd: string): Promise<LintConfig> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);

    let raw: string;
    try {
      raw = await readFile(filepath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        continue;
      }
      throw new ConfigError(
        `Failed to read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new ConfigError(
        `Failed to parse ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    validateConfigFields(parsed, filename);
    const p = parsed as Partial<LintConfig>;

    // `prohibited`/`allowed` are passed through as-is (possibly undefined) —
    // resolving them against `extends`/`prohibitedAdd`/`allowedAdd` or the
    // DEFAULT_CONFIG fallback is compileConfig's job (see resolvePatternLists),
    // so the same resolution applies whether the config came from a file or
    // was constructed programmatically and passed straight to compileConfig.
    return {
      prohibited: p.prohibited,
      allowed: p.allowed,
      ignore: p.ignore ?? DEFAULT_CONFIG.ignore,
      patterns: p.patterns,
      suggestionSuffix: p.suggestionSuffix,
      semanticPrefixes: p.semanticPrefixes,
      classAttributes: p.classAttributes,
      classFunctions: p.classFunctions,
      extends: p.extends,
      prohibitedAdd: p.prohibitedAdd,
      allowedAdd: p.allowedAdd,
    };
  }

  return DEFAULT_CONFIG;
}
