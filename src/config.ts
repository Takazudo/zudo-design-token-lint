/**
 * Configuration loader for design-token-lint.
 *
 * Loads a JSON config file from the project root, falling back to
 * built-in defaults if no config is found.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface LintConfig {
  /** Patterns to flag as violations. Placeholders: {n} = number, {color} = Tailwind color, {shade} = shade (50-950) */
  prohibited: string[];
  /** Exceptions that are always allowed, even if they match a prohibited pattern */
  allowed: string[];
  /** File path globs to skip entirely */
  ignore: string[];
  /** File glob patterns to scan (used by CLI when no args are given) */
  patterns?: string[];
  /** Custom suffix for suggestion messages (replaces the default "use a semantic spacing token..." text) */
  suggestionSuffix?: string;
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
export const DEFAULT_CONFIG: LintConfig = {
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
    'outline-{color}-{shade}',
    'ring-{color}-{shade}',
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
  ],
  allowed: ['p-0', 'm-0', 'gap-0', 'p-1px'],
  ignore: ['**/*.test.*', '**/*.stories.*'],
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

/**
 * Compile a single pattern string into a rule.
 */
export function compilePattern(pattern: string, suggestionSuffix?: string): CompiledRule {
  // Find the first placeholder
  const placeholderIndex = pattern.indexOf('{');
  if (placeholderIndex === -1) {
    // Exact match pattern (no placeholders)
    return {
      prefix: pattern,
      valuePattern: /^$/,
      reasonTemplate: `Prohibited class "{CLASS}"`,
      isSpacingRule: false,
    };
  }

  // Split into prefix (everything before the placeholder, minus trailing -)
  const prefix = pattern.slice(0, placeholderIndex - 1);
  const valuePart = pattern.slice(placeholderIndex);

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
    // Generic placeholder handling
    regexStr += valuePart
      .replace(/\{n\}/g, '\\d+(\\.\\d+)?')
      .replace(/\{color\}/g, `(${TAILWIND_COLORS.join('|')})`)
      .replace(/\{shade\}/g, '\\d{2,3}');
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
}

export function compileConfig(config: LintConfig): CompiledConfig {
  return {
    rules: config.prohibited.map((p) => compilePattern(p, config.suggestionSuffix)),
    allowed: new Set(config.allowed),
    ignore: config.ignore,
  };
}

const CONFIG_FILENAMES = ['.design-token-lint.json', 'design-token-lint.config.json'];

/**
 * Load config from the given directory, falling back to defaults.
 */
export async function loadConfig(cwd: string): Promise<LintConfig> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);
    try {
      const raw = await readFile(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LintConfig>;
      return {
        prohibited: parsed.prohibited ?? DEFAULT_CONFIG.prohibited,
        allowed: parsed.allowed ?? DEFAULT_CONFIG.allowed,
        ignore: parsed.ignore ?? DEFAULT_CONFIG.ignore,
        patterns: parsed.patterns,
        suggestionSuffix: parsed.suggestionSuffix,
      };
    } catch {
      // File doesn't exist or is invalid, try next
    }
  }

  return DEFAULT_CONFIG;
}
