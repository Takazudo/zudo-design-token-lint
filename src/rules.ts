/**
 * Design token lint rules.
 *
 * Checks Tailwind class names against compiled config patterns.
 * Falls back to built-in defaults when no config file is present.
 */

import { DEFAULT_CONFIG, compileConfig, type CompiledConfig, type CompiledRule } from './config.js';

export interface Violation {
  className: string;
  reason: string;
}

// Default compiled config (used when no external config is loaded)
let activeConfig: CompiledConfig = compileConfig(DEFAULT_CONFIG);

/**
 * Set the active lint config. Call this after loading a config file.
 */
export function setConfig(config: CompiledConfig): void {
  activeConfig = config;
}

/**
 * Get the currently active compiled config.
 */
export function getConfig(): CompiledConfig {
  return activeConfig;
}

/**
 * Check a single Tailwind class name for design token violations.
 * Returns a Violation if the class is prohibited, or null if it's fine.
 */
export function checkClass(className: string): Violation | null {
  return checkClassWithConfig(className, activeConfig);
}

/**
 * Check a class against a specific compiled config (for testing).
 */
export function checkClassWithConfig(className: string, config: CompiledConfig): Violation | null {
  // Strip responsive/state prefixes (e.g., "sm:", "hover:", "dark:", "md:hover:")
  const stripped = className.replace(/^(?:[a-z0-9]+:)+/, '');

  // Handle negative prefixes (e.g., -m-4, -top-2)
  const isNegative = stripped.startsWith('-');
  const withoutNeg = isNegative ? stripped.slice(1) : stripped;

  // Skip arbitrary values like w-[28px], bg-[#123]
  if (withoutNeg.includes('[')) {
    return null;
  }

  // Check allowed list first (exact match on stripped class)
  if (config.allowed.has(withoutNeg)) {
    return null;
  }

  // Check each rule
  for (const rule of config.rules) {
    const violation = matchRule(className, withoutNeg, rule);
    if (violation) {
      return violation;
    }
  }

  return null;
}

function matchRule(
  originalClassName: string,
  withoutNeg: string,
  rule: CompiledRule,
): Violation | null {
  // The class must start with the prefix followed by "-"
  if (withoutNeg === rule.prefix || !withoutNeg.startsWith(rule.prefix + '-')) {
    return null;
  }

  const value = withoutNeg.slice(rule.prefix.length + 1);

  // Allow semantic tokens (hgap-*, vgap-*) — only for spacing rules, not color rules
  if (rule.isSpacingRule && (value.startsWith('hgap-') || value.startsWith('vgap-'))) {
    return null;
  }

  // Allow "0" and "1px" for spacing rules
  if (rule.isSpacingRule && (value === '0' || value === '1px')) {
    return null;
  }

  if (rule.valuePattern.test(value)) {
    return {
      className: originalClassName,
      reason: rule.reasonTemplate.replace('{CLASS}', originalClassName),
    };
  }

  return null;
}
