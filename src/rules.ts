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
  /** Rule-family tag from the matched rule's structured `prohibited` entry (e.g. "sizing", "z-index") */
  category?: string;
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
  // Strip variant prefixes by taking everything after the last ":"
  // Handles sm:, hover:, dark:, group-hover:, peer-focus:, aria-selected:, data-[state=open]:, etc.
  const lastColon = className.lastIndexOf(':');
  let stripped = lastColon >= 0 ? className.slice(lastColon + 1) : className;

  // Strip important modifier — leading form is Tailwind v3 (!p-4, sm:!p-4),
  // trailing form is Tailwind v4 (p-4!, sm:p-4!). Both must be stripped before
  // the negative/opacity handling below, or v4's trailing "!" rides along
  // into the value and breaks rule/allowed-list matching.
  if (stripped.startsWith('!')) {
    stripped = stripped.slice(1);
  }
  if (stripped.endsWith('!')) {
    stripped = stripped.slice(0, -1);
  }

  // Handle negative prefixes (e.g., -m-4, -top-2)
  const isNegative = stripped.startsWith('-');
  const withoutNeg = isNegative ? stripped.slice(1) : stripped;

  // Strip opacity modifier (e.g., bg-gray-500/50, text-blue-600/75).
  // Used for the arbitrary-value guard and allowed-list check; spacing rules
  // receive the pre-strip form so that fraction utilities like w-1/2 are not
  // misread as the numeric value "1".
  const slashIdx = withoutNeg.indexOf('/');
  const withoutOpacity = slashIdx >= 0 ? withoutNeg.slice(0, slashIdx) : withoutNeg;

  // Skip arbitrary values like w-[28px], bg-[#123]
  if (withoutOpacity.includes('[')) {
    return null;
  }

  // Check allowed list first. Match against the normalized form (so bare
  // entries like "p-4" still cover variant/negative/important forms) AND the
  // original className verbatim (so exact-match entries like "-mt-4",
  // "hover:p-2", or "bg-red-500/50" — copied straight from a violation
  // message — actually take effect).
  if (config.allowed.has(withoutOpacity) || config.allowed.has(className)) {
    return null;
  }

  // Check each rule
  for (const rule of config.rules) {
    // Spacing/sizing rules must see the value with any `/N` intact so that
    // fraction utilities (e.g. w-1/2) are not confused with numeric values.
    // Color rules receive the opacity-stripped form so bg-gray-500/50 is still
    // matched as bg-gray-500 and flagged.
    const candidate = rule.isSpacingRule ? withoutNeg : withoutOpacity;
    const violation = matchRule(
      className,
      candidate,
      rule,
      config.semanticPrefixes,
      config.suggestions,
    );
    if (violation) {
      return violation;
    }
  }

  return null;
}

/**
 * Build the Violation for a matched rule, carrying an optional category
 * through, appending the semanticPrefixes parenthetical (see
 * `selectSemanticPrefix`) when the match came from a stripped namespace, and
 * finally appending a `— did you mean "..."?` hint when the normalized base
 * class (post variant/important/negative/opacity stripping — the same shape
 * `allowed` entries use) has a `suggestions` mapping.
 */
function buildViolation(
  originalClassName: string,
  rule: CompiledRule,
  normalizedClassName: string,
  suggestions: Map<string, string>,
  semanticPrefix?: string,
): Violation {
  let reason = rule.reasonTemplate.replace('{CLASS}', originalClassName);
  if (semanticPrefix !== undefined) {
    reason += ` (numeric tail after the "${semanticPrefix}" semantic prefix)`;
  }
  const suggestion = suggestions.get(normalizedClassName);
  if (suggestion !== undefined) {
    reason += ` — did you mean "${suggestion}"?`;
  }

  const violation: Violation = {
    className: originalClassName,
    reason,
  };
  if (rule.category !== undefined) {
    violation.category = rule.category;
  }
  return violation;
}

/**
 * Result of matching a value against the configured `semanticPrefixes`
 * entries. A "namespace" match strips the matched entry (its `tail` is
 * re-tested against the rule's numeric pattern by the caller); a "bypass"
 * match preserves the 1.x pure-allowlist behavior outright — the entry
 * matched but not as a namespace (e.g. a digit-leading prefix like "1"
 * against "12", or an entry that consumes the whole value with nothing left
 * to strip).
 */
type SemanticHit = { kind: 'namespace'; prefix: string; tail: string } | { kind: 'bypass' };

/**
 * Select which configured `semanticPrefixes` entry (if any) applies to
 * `value`, distinguishing a namespace match (strip + re-test the tail) from
 * a bypass match (1.x behavior, unchanged). See the locked v2 contract
 * (issue #158 §2) for the full selection algorithm this implements.
 *
 * A config entry matches when `value` starts with it. It is a *namespace*
 * match when the entry ends with "-", or the remainder after stripping it
 * starts with "-" — this makes the trailing dash optional in config
 * authoring ("hgap" and "hgap-" behave identically). Among namespace
 * matches, the longest one wins, so array order never affects the verdict.
 * If nothing matched as a namespace but something matched anyway, that's a
 * bypass. No match at all returns null.
 */
function selectSemanticPrefix(value: string, semanticPrefixes: string[]): SemanticHit | null {
  let longestNamespace: { prefix: string; tail: string } | null = null;
  let hasBypassMatch = false;

  for (const prefix of semanticPrefixes) {
    if (prefix.length === 0 || !value.startsWith(prefix)) {
      continue;
    }
    const remainder = value.slice(prefix.length);
    const isNamespaceMatch = prefix.endsWith('-') || remainder.startsWith('-');
    if (isNamespaceMatch) {
      const tail = prefix.endsWith('-') ? remainder : remainder.slice(1);
      if (longestNamespace === null || prefix.length > longestNamespace.prefix.length) {
        longestNamespace = { prefix, tail };
      }
    } else {
      hasBypassMatch = true;
    }
  }

  if (longestNamespace !== null) {
    return { kind: 'namespace', prefix: longestNamespace.prefix, tail: longestNamespace.tail };
  }
  if (hasBypassMatch) {
    return { kind: 'bypass' };
  }
  return null;
}

function matchRule(
  originalClassName: string,
  withoutNeg: string,
  rule: CompiledRule,
  semanticPrefixes: string[],
  suggestions: Map<string, string>,
): Violation | null {
  // Exact-match rule (no placeholders, valuePattern is /^$/). Fires when
  // EITHER the normalized candidate (post variant/important/negative/opacity
  // stripping) equals the entry — so a bare entry like "hidden" also covers
  // "sm:hidden" — OR the raw className equals the entry verbatim. The
  // verbatim side is what lets an entry carry a leading "-" (e.g. "-mt-px"),
  // a variant prefix (e.g. "hover:p-2"), or "!" (e.g. "p-4!") and have that
  // literal form actually match — mirrors the allowed-list dual matching
  // above (see the "Check allowed list first" comment).
  if (rule.valuePattern.source === '^$') {
    if (withoutNeg === rule.prefix || originalClassName === rule.prefix) {
      return buildViolation(originalClassName, rule, withoutNeg, suggestions);
    }
    return null;
  }

  // The class must start with the prefix followed by "-"
  if (withoutNeg === rule.prefix || !withoutNeg.startsWith(rule.prefix + '-')) {
    return null;
  }

  const value = withoutNeg.slice(rule.prefix.length + 1);

  // semanticPrefixes only ever adds violations, it never removes one: a
  // namespace match (e.g. "hgap-") strips the matched entry and re-tests the
  // remaining tail against this same rule's own "0" bypass and numeric
  // valuePattern — nothing else. The `allowed` set, the arbitrary-value "["
  // guard, and variant/negative/important/opacity normalization all ran
  // earlier in checkClassWithConfig against the whole class and are
  // deliberately not re-run against the tail. A bypass match (an entry that
  // matched but not as a namespace — e.g. a digit-leading prefix like "1"
  // against "12") preserves the 1.x pure-allowlist behavior unchanged
  // (pinned in rules.test.ts under "semanticPrefixes bypass — priority over
  // the numeric check").
  if (rule.isSpacingRule) {
    const hit = selectSemanticPrefix(value, semanticPrefixes);
    if (hit !== null) {
      if (hit.kind === 'bypass') {
        return null;
      }
      if (hit.tail === '' || hit.tail === '0') {
        return null;
      }
      return rule.valuePattern.test(hit.tail)
        ? buildViolation(originalClassName, rule, withoutNeg, suggestions, hit.prefix)
        : null;
    }
  }

  // Allow "0" for spacing rules. (There is no equivalent "1px" bypass here:
  // isSpacingRule is only ever set for the literal "{n}" placeholder shape
  // (see compilePattern in config.ts), whose valuePattern is always
  // ^\d+(\.\d+)?$ — a value like "1px" contains non-digit characters and can
  // never satisfy that pattern, so a dedicated "value === '1px'" bypass here
  // would be dead code. "p-1px" is instead allowed via the config's
  // `allowed` list — see DEFAULT_CONFIG.allowed.)
  if (rule.isSpacingRule && value === '0') {
    return null;
  }

  if (rule.valuePattern.test(value)) {
    return buildViolation(originalClassName, rule, withoutNeg, suggestions);
  }

  return null;
}
