import { describe, it, expect } from 'vitest';
import {
  compilePattern,
  compileConfig,
  loadConfig,
  ConfigError,
  DEFAULT_CONFIG,
  CONFIG_PRESETS,
  DEFAULT_PRESET_NAME,
  type LintConfig,
  type CompiledConfig,
} from './config.js';
import { checkClassWithConfig } from './rules.js';
import { writeFile, unlink, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('DEFAULT_CONFIG', () => {
  it('has semanticPrefixes defaulting to hgap- and vgap-', () => {
    expect(DEFAULT_CONFIG.semanticPrefixes).toEqual(['hgap-', 'vgap-']);
  });

  it('has classAttributes defaulting to className and class', () => {
    expect(DEFAULT_CONFIG.classAttributes).toEqual(['className', 'class']);
  });

  it('has classFunctions defaulting to cn, clsx, classNames, twMerge', () => {
    expect(DEFAULT_CONFIG.classFunctions).toEqual(['cn', 'clsx', 'classNames', 'twMerge']);
  });
});

describe('compilePattern', () => {
  it('compiles numeric spacing pattern', () => {
    const rule = compilePattern('p-{n}');
    expect(rule.prefix).toBe('p');
    expect(rule.valuePattern.test('4')).toBe(true);
    expect(rule.valuePattern.test('0.5')).toBe(true);
    expect(rule.valuePattern.test('hgap-sm')).toBe(false);
  });

  it('compiles color-shade pattern', () => {
    const rule = compilePattern('bg-{color}-{shade}');
    expect(rule.prefix).toBe('bg');
    expect(rule.valuePattern.test('gray-500')).toBe(true);
    expect(rule.valuePattern.test('blue-600')).toBe(true);
    expect(rule.valuePattern.test('zd-black')).toBe(false);
  });

  it('compiles multi-segment prefix patterns', () => {
    const rule = compilePattern('gap-x-{n}');
    expect(rule.prefix).toBe('gap-x');
    expect(rule.valuePattern.test('4')).toBe(true);
  });

  it('uses generic default message for spacing rules', () => {
    const rule = compilePattern('p-{n}');
    expect(rule.reasonTemplate).toContain('use a semantic spacing token or arbitrary value');
    expect(rule.reasonTemplate).not.toContain('hgap-*/vgap-*');
  });

  it('uses generic default message for color rules', () => {
    const rule = compilePattern('bg-{color}-{shade}');
    expect(rule.reasonTemplate).toContain('use a design system color token');
  });

  it('uses custom suggestionSuffix for spacing rules', () => {
    const rule = compilePattern('p-{n}', 'use hgap-*/vgap-* tokens');
    expect(rule.reasonTemplate).toContain('use hgap-*/vgap-* tokens');
    expect(rule.reasonTemplate).toContain('Numeric spacing');
  });

  it('uses custom suggestionSuffix for color rules', () => {
    const rule = compilePattern('bg-{color}-{shade}', 'use zd-* color tokens');
    expect(rule.reasonTemplate).toContain('use zd-* color tokens');
    expect(rule.reasonTemplate).toContain('Default Tailwind color');
  });

  it('escapes regex metacharacters in literal segments of a generic pattern', () => {
    const rule = compilePattern('aspect-{n}.5');
    expect(rule.valuePattern.test('4.5')).toBe(true);
    // A literal "." must not act as a wildcard.
    expect(rule.valuePattern.test('4X5')).toBe(false);
  });
});

describe('compilePattern — options bag (issue #128)', () => {
  it('accepts an options object with a custom reason, overriding the shape-inferred default', () => {
    const rule = compilePattern('w-{n}', { reason: 'Numeric width "{CLASS}" — use a token' });
    expect(rule.reasonTemplate).toBe('Numeric width "{CLASS}" — use a token');
    expect(rule.isSpacingRule).toBe(true);
  });

  it('accepts an options object with a category, surfaced on the compiled rule', () => {
    const rule = compilePattern('z-{n}', { category: 'z-index' });
    expect(rule.category).toBe('z-index');
  });

  it('has no category when none is given (flat shape preserved)', () => {
    const rule = compilePattern('p-{n}');
    expect(rule.category).toBeUndefined();
  });

  it('a custom reason wins over suggestionSuffix when both are given', () => {
    const rule = compilePattern('w-{n}', {
      suggestionSuffix: 'use hsp-* tokens',
      reason: 'Numeric width "{CLASS}" — use a sizing token',
    });
    expect(rule.reasonTemplate).toBe('Numeric width "{CLASS}" — use a sizing token');
    expect(rule.reasonTemplate).not.toContain('hsp-');
  });

  it('still accepts a bare string as suggestionSuffix (legacy call shape, regression)', () => {
    const rule = compilePattern('p-{n}', 'use hgap-*/vgap-* tokens');
    expect(rule.reasonTemplate).toContain('use hgap-*/vgap-* tokens');
    expect(rule.category).toBeUndefined();
  });

  it('applies a custom reason to the exact-match (no-placeholder) pattern shape too', () => {
    const rule = compilePattern('hidden', { reason: 'Do not hide "{CLASS}"', category: 'layout' });
    expect(rule.reasonTemplate).toBe('Do not hide "{CLASS}"');
    expect(rule.category).toBe('layout');
    expect(rule.valuePattern.source).toBe('^$');
  });
});

describe('compilePattern — exact patterns with variant/negative/important shapes', () => {
  it('does not throw for an exact pattern with a leading "-"', () => {
    const rule = compilePattern('-mt-px');
    expect(rule.prefix).toBe('-mt-px');
    expect(rule.valuePattern.source).toBe('^$');
  });

  it('does not throw for an exact pattern containing a variant prefix ":"', () => {
    const rule = compilePattern('hover:p-2');
    expect(rule.prefix).toBe('hover:p-2');
    expect(rule.valuePattern.source).toBe('^$');
  });

  it('does not throw for an exact pattern with a trailing "!" important modifier', () => {
    const rule = compilePattern('p-4!');
    expect(rule.prefix).toBe('p-4!');
    expect(rule.valuePattern.source).toBe('^$');
  });
});

describe('compilePattern — malformed patterns', () => {
  it('throws a clear error when a placeholder has no preceding "-"', () => {
    expect(() => compilePattern('{n}')).toThrow(/placeholder/i);
    expect(() => compilePattern('gap{n}')).toThrow(/placeholder/i);
  });

  it('throws a clear error when a placeholder is unclosed', () => {
    expect(() => compilePattern('p-{n')).toThrow(/unclosed/i);
  });

  it('throws a clear error on an unrecognized placeholder instead of silently matching nothing', () => {
    // A typo like "{number}" must not be silently escaped to dead literal text.
    expect(() => compilePattern('p-{number}')).toThrow(/unknown placeholder/i);
    expect(() => compilePattern('p-{}')).toThrow(/unknown placeholder/i);
  });

  it('throws a clear error on a stray closing brace', () => {
    expect(() => compilePattern('p-{n}}')).toThrow(/unmatched/i);
  });
});

describe('checkClassWithConfig', () => {
  const config = compileConfig(DEFAULT_CONFIG);

  it('flags numeric spacing', () => {
    const result = checkClassWithConfig('p-4', config);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('Numeric spacing');
  });

  it('flags default Tailwind colors', () => {
    const result = checkClassWithConfig('bg-gray-500', config);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('Default Tailwind color');
  });

  it('allows semantic tokens', () => {
    expect(checkClassWithConfig('p-hgap-sm', config)).toBeNull();
    expect(checkClassWithConfig('gap-vgap-xs', config)).toBeNull();
  });

  it('allows explicitly allowed classes', () => {
    expect(checkClassWithConfig('p-0', config)).toBeNull();
    expect(checkClassWithConfig('m-0', config)).toBeNull();
  });

  it('allows arbitrary values', () => {
    expect(checkClassWithConfig('w-[28px]', config)).toBeNull();
  });

  it('handles responsive prefixes', () => {
    const result = checkClassWithConfig('sm:p-4', config);
    expect(result).not.toBeNull();
  });

  it('handles negative prefixes', () => {
    const result = checkClassWithConfig('-m-4', config);
    expect(result).not.toBeNull();
  });

  it('works with exact-match patterns (no placeholders)', () => {
    const custom: LintConfig = {
      prohibited: ['hidden'],
      allowed: [],
      ignore: [],
    };
    const compiled = compileConfig(custom);
    expect(checkClassWithConfig('hidden', compiled)).not.toBeNull();
    expect(checkClassWithConfig('hidden-foo', compiled)).toBeNull();
    expect(checkClassWithConfig('flex', compiled)).toBeNull();
  });

  it('works with custom config', () => {
    const custom: LintConfig = {
      prohibited: ['p-{n}'],
      allowed: ['p-2'],
      ignore: [],
    };
    const compiled = compileConfig(custom);

    // p-2 is allowed by the custom config
    expect(checkClassWithConfig('p-2', compiled)).toBeNull();
    // p-4 is still prohibited
    expect(checkClassWithConfig('p-4', compiled)).not.toBeNull();
    // bg-gray-500 is NOT in the custom prohibited list, so allowed
    expect(checkClassWithConfig('bg-gray-500', compiled)).toBeNull();
  });

  it('uses custom semanticPrefixes from config', () => {
    const custom: LintConfig = {
      prohibited: ['p-{n}'],
      allowed: [],
      ignore: [],
      semanticPrefixes: ['hsp-', 'vsp-'],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.semanticPrefixes).toEqual(['hsp-', 'vsp-']);
  });

  it('falls back to default semanticPrefixes when not specified', () => {
    const custom: LintConfig = {
      prohibited: ['p-{n}'],
      allowed: [],
      ignore: [],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.semanticPrefixes).toEqual(['hgap-', 'vgap-']);
  });

  it('allows empty semanticPrefixes array', () => {
    const custom: LintConfig = {
      prohibited: ['p-{n}'],
      allowed: [],
      ignore: [],
      semanticPrefixes: [],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.semanticPrefixes).toEqual([]);
  });

  it('uses custom suggestionSuffix in violation reason', () => {
    const custom: LintConfig = {
      prohibited: ['p-{n}', 'bg-{color}-{shade}'],
      allowed: [],
      ignore: [],
      suggestionSuffix: 'use hgap-*/vgap-* or zd-* tokens',
    };
    const compiled = compileConfig(custom);

    const spacingViolation = checkClassWithConfig('p-4', compiled);
    expect(spacingViolation).not.toBeNull();
    expect(spacingViolation!.reason).toContain('use hgap-*/vgap-* or zd-* tokens');
    expect(spacingViolation!.reason).toContain('Numeric spacing');

    const colorViolation = checkClassWithConfig('bg-gray-500', compiled);
    expect(colorViolation).not.toBeNull();
    expect(colorViolation!.reason).toContain('use hgap-*/vgap-* or zd-* tokens');
    expect(colorViolation!.reason).toContain('Default Tailwind color');
  });
});

describe('structured prohibited entries — object {pattern, reason?, category?} (issue #128)', () => {
  it('a plain string entry compiles unchanged alongside an object entry', () => {
    const custom: LintConfig = {
      prohibited: ['p-{n}', { pattern: 'w-{n}', reason: 'Numeric width "{CLASS}"' }],
      allowed: [],
      ignore: [],
    };
    const compiled = compileConfig(custom);
    expect(compiled.rules).toHaveLength(2);

    const spacing = checkClassWithConfig('p-4', compiled);
    expect(spacing).not.toBeNull();
    expect(spacing!.reason).toContain('Numeric spacing');
    expect(spacing!.category).toBeUndefined();
  });

  it('an object entry with a custom reason and category is surfaced on the violation', () => {
    const custom: LintConfig = {
      prohibited: [{ pattern: 'w-{n}', reason: 'Numeric width "{CLASS}"', category: 'sizing' }],
      allowed: [],
      ignore: [],
    };
    const compiled = compileConfig(custom);
    const result = checkClassWithConfig('w-4', compiled);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('Numeric width "w-4"');
    expect(result!.category).toBe('sizing');
  });

  it('an object entry without reason/category falls back to shape-inferred defaults, no category', () => {
    const custom: LintConfig = {
      prohibited: [{ pattern: 'w-{n}' }],
      allowed: [],
      ignore: [],
    };
    const compiled = compileConfig(custom);
    const result = checkClassWithConfig('w-4', compiled);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('Numeric spacing');
    expect(result!.category).toBeUndefined();
  });

  it('loadConfig accepts an object-shaped prohibited entry from a JSON config file', async () => {
    const dir = join(tmpdir(), `dtl-test-prohibited-obj-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(
      configPath,
      JSON.stringify({
        prohibited: [{ pattern: 'w-{n}', reason: 'Numeric width "{CLASS}"', category: 'sizing' }],
        allowed: [],
        ignore: [],
      }),
    );
    try {
      const config = await loadConfig(dir);
      const compiled = compileConfig(config);
      const result = checkClassWithConfig('w-8', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('Numeric width "w-8"');
      expect(result!.category).toBe('sizing');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loadConfig rejects a prohibited object entry missing "pattern"', async () => {
    const dir = join(tmpdir(), `dtl-test-prohibited-bad-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(
      configPath,
      JSON.stringify({ prohibited: [{ reason: 'missing pattern' }], ignore: [] }),
    );
    try {
      await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
      await expect(loadConfig(dir)).rejects.toThrow(
        /"prohibited" must be an array of strings or \{pattern, reason\?, category\?\} objects/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loadConfig rejects a prohibited object entry with a non-string "reason"', async () => {
    const dir = join(tmpdir(), `dtl-test-prohibited-bad-reason-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(
      configPath,
      JSON.stringify({ prohibited: [{ pattern: 'w-{n}', reason: 123 }], ignore: [] }),
    );
    try {
      await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loadConfig accepts an object-shaped prohibitedAdd entry from a JSON config file', async () => {
    const dir = join(tmpdir(), `dtl-test-prohibitedadd-obj-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(
      configPath,
      JSON.stringify({
        extends: ['default'],
        prohibitedAdd: [
          { pattern: 'z-{n}', reason: 'Numeric z-index "{CLASS}"', category: 'z-index' },
        ],
        ignore: [],
      }),
    );
    try {
      const config = await loadConfig(dir);
      const compiled = compileConfig(config);
      const result = checkClassWithConfig('z-10', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('Numeric z-index "z-10"');
      expect(result!.category).toBe('z-index');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('compileConfig — classAttributes and classFunctions', () => {
  it('includes classAttributes from config when specified', () => {
    const custom: LintConfig = {
      prohibited: [],
      allowed: [],
      ignore: [],
      classAttributes: ['inputClassName'],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.classAttributes).toEqual(['inputClassName']);
  });

  it('falls back to default classAttributes when not specified', () => {
    const custom: LintConfig = {
      prohibited: [],
      allowed: [],
      ignore: [],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.classAttributes).toEqual(['className', 'class']);
  });

  it('includes classFunctions from config when specified', () => {
    const custom: LintConfig = {
      prohibited: [],
      allowed: [],
      ignore: [],
      classFunctions: ['cva', 'tv'],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.classFunctions).toEqual(['cva', 'tv']);
  });

  it('falls back to default classFunctions when not specified', () => {
    const custom: LintConfig = {
      prohibited: [],
      allowed: [],
      ignore: [],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.classFunctions).toEqual(['cn', 'clsx', 'classNames', 'twMerge']);
  });

  it('allows empty classAttributes array', () => {
    const custom: LintConfig = {
      prohibited: [],
      allowed: [],
      ignore: [],
      classAttributes: [],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.classAttributes).toEqual([]);
  });

  it('allows empty classFunctions array', () => {
    const custom: LintConfig = {
      prohibited: [],
      allowed: [],
      ignore: [],
      classFunctions: [],
    };
    const compiled: CompiledConfig = compileConfig(custom);
    expect(compiled.classFunctions).toEqual([]);
  });
});

describe('loadConfig — classAttributes and classFunctions', () => {
  it('loads classAttributes from config file', async () => {
    const dir = join(tmpdir(), `dtl-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(
      configPath,
      JSON.stringify({
        prohibited: [],
        allowed: [],
        ignore: [],
        classAttributes: ['inputClassName', 'wrapperClass'],
      }),
    );
    try {
      const config = await loadConfig(dir);
      expect(config.classAttributes).toEqual(['inputClassName', 'wrapperClass']);
    } finally {
      await unlink(configPath);
    }
  });

  it('loads classFunctions from config file', async () => {
    const dir = join(tmpdir(), `dtl-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(
      configPath,
      JSON.stringify({
        prohibited: [],
        allowed: [],
        ignore: [],
        classFunctions: ['cva', 'tv'],
      }),
    );
    try {
      const config = await loadConfig(dir);
      expect(config.classFunctions).toEqual(['cva', 'tv']);
    } finally {
      await unlink(configPath);
    }
  });

  it('returns undefined classAttributes when not in config file (falls back in compileConfig)', async () => {
    const dir = join(tmpdir(), `dtl-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(configPath, JSON.stringify({ prohibited: [], allowed: [], ignore: [] }));
    try {
      const config = await loadConfig(dir);
      expect(config.classAttributes).toBeUndefined();
      // compileConfig should fill in the default
      const compiled = compileConfig(config);
      expect(compiled.classAttributes).toEqual(['className', 'class']);
    } finally {
      await unlink(configPath);
    }
  });
});

describe('loadConfig — error handling', () => {
  async function withTempConfigFile(
    content: string,
    fn: (dir: string) => Promise<void>,
  ): Promise<void> {
    const dir = join(tmpdir(), `dtl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(configPath, content);
    try {
      await fn(dir);
    } finally {
      await unlink(configPath);
    }
  }

  it('falls through to defaults when no config file exists (ENOENT unchanged)', async () => {
    const dir = join(tmpdir(), `dtl-test-enoent-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const config = await loadConfig(dir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('throws ConfigError naming the file on malformed JSON', async () => {
    await withTempConfigFile('{ not valid json', async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
      await expect(loadConfig(dir)).rejects.toThrow(/Failed to parse \.design-token-lint\.json/);
    });
  });

  it('throws ConfigError naming the field when "prohibited" has the wrong type', async () => {
    await withTempConfigFile(JSON.stringify({ prohibited: 'p-{n}' }), async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
      await expect(loadConfig(dir)).rejects.toThrow(/"prohibited" must be an array of strings/);
    });
  });

  it('throws ConfigError when a string-array field contains a non-string element', () => {
    return withTempConfigFile(JSON.stringify({ allowed: ['p-0', 42] }), async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/"allowed" must be an array of strings/);
    });
  });

  it('throws ConfigError naming the field when "suggestionSuffix" has the wrong type', async () => {
    await withTempConfigFile(JSON.stringify({ suggestionSuffix: 123 }), async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/"suggestionSuffix" must be a string/);
    });
  });

  it('accepts a fully valid config file without throwing', async () => {
    await withTempConfigFile(
      JSON.stringify({
        prohibited: ['p-{n}'],
        allowed: ['p-0'],
        ignore: [],
        suggestionSuffix: 'use a token',
      }),
      async (dir) => {
        const config = await loadConfig(dir);
        expect(config.prohibited).toEqual(['p-{n}']);
      },
    );
  });
});

describe('loadConfig — config file discovery', () => {
  async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = join(
      tmpdir(),
      `dtl-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(dir, { recursive: true });
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('falls back to DEFAULT_CONFIG when neither config filename is present', async () => {
    await withTempDir(async (dir) => {
      const config = await loadConfig(dir);
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  it('picks up the second filename (design-token-lint.config.json) when the dotfile is absent', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'design-token-lint.config.json'),
        JSON.stringify({ prohibited: ['m-{n}'], allowed: [], ignore: [] }),
      );
      const config = await loadConfig(dir);
      expect(config.prohibited).toEqual(['m-{n}']);
    });
  });

  it('prefers the dotfile (.design-token-lint.json) when both config files exist', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, '.design-token-lint.json'),
        JSON.stringify({ prohibited: ['p-{n}'], allowed: [], ignore: [] }),
      );
      await writeFile(
        join(dir, 'design-token-lint.config.json'),
        JSON.stringify({ prohibited: ['m-{n}'], allowed: [], ignore: [] }),
      );
      const config = await loadConfig(dir);
      // The dotfile's content wins — the second filename is never even read.
      expect(config.prohibited).toEqual(['p-{n}']);
    });
  });
});

describe('extends / presets', () => {
  it('registers "default" in CONFIG_PRESETS wrapping DEFAULT_CONFIG prohibited/allowed', () => {
    expect(DEFAULT_PRESET_NAME).toBe('default');
    expect(CONFIG_PRESETS[DEFAULT_PRESET_NAME]).toEqual({
      prohibited: DEFAULT_CONFIG.prohibited,
      allowed: DEFAULT_CONFIG.allowed,
    });
  });

  it('extends: ["default"] compiles identically to a fully-duplicated legacy config', () => {
    // Mirrors the pre-#127 dogfood config, which duplicated every
    // DEFAULT_CONFIG prohibited/allowed entry verbatim just to set `patterns`.
    const legacy: LintConfig = {
      prohibited: DEFAULT_CONFIG.prohibited,
      allowed: DEFAULT_CONFIG.allowed,
      ignore: DEFAULT_CONFIG.ignore,
      patterns: ['src/**/*.{tsx,jsx,astro}'],
    };
    const extended: LintConfig = {
      ignore: DEFAULT_CONFIG.ignore,
      extends: ['default'],
      patterns: ['src/**/*.{tsx,jsx,astro}'],
    };
    expect(compileConfig(extended)).toEqual(compileConfig(legacy));
  });

  it('extends: ["default"] alone reproduces DEFAULT_CONFIG rules/allowed exactly', () => {
    const compiled = compileConfig({ ignore: DEFAULT_CONFIG.ignore, extends: ['default'] });
    expect(compiled).toEqual(compileConfig(DEFAULT_CONFIG));
  });

  it('accepts a bare string for extends, not just an array', () => {
    const viaString = compileConfig({ ignore: [], extends: 'default' });
    const viaArray = compileConfig({ ignore: [], extends: ['default'] });
    expect(viaString).toEqual(viaArray);
  });

  it('prohibitedAdd appends to the extends-inherited prohibited list', () => {
    const compiled = compileConfig({
      ignore: [],
      extends: ['default'],
      prohibitedAdd: ['z-{n}'],
    });
    expect(compiled.rules).toHaveLength(DEFAULT_CONFIG.prohibited.length + 1);
    expect(checkClassWithConfig('z-10', compiled)).not.toBeNull();
    expect(checkClassWithConfig('p-4', compiled)).not.toBeNull();
  });

  it('allowedAdd appends to the extends-inherited allowed list', () => {
    const compiled = compileConfig({
      ignore: [],
      extends: ['default'],
      allowedAdd: ['p-7'],
    });
    expect(compiled.allowed).toEqual(new Set([...DEFAULT_CONFIG.allowed, 'p-7']));
  });

  it('prohibitedAdd appends to the DEFAULT_CONFIG fallback when extends is absent', () => {
    const compiled = compileConfig({ ignore: [], prohibitedAdd: ['z-{n}'] });
    expect(compiled.rules).toHaveLength(DEFAULT_CONFIG.prohibited.length + 1);
    expect(checkClassWithConfig('z-10', compiled)).not.toBeNull();
  });

  it('an explicit prohibited list replaces extends entirely (replace semantics)', () => {
    const compiled = compileConfig({
      ignore: [],
      extends: ['default'],
      prohibited: ['hidden'],
    });
    expect(compiled.rules).toHaveLength(1);
    expect(checkClassWithConfig('hidden', compiled)).not.toBeNull();
    expect(checkClassWithConfig('p-4', compiled)).toBeNull();
  });

  it('prohibitedAdd still applies on top of an explicit replace list (no extends involved)', () => {
    const compiled = compileConfig({
      ignore: [],
      prohibited: ['hidden'],
      prohibitedAdd: ['block'],
    });
    expect(compiled.rules).toHaveLength(2);
    expect(checkClassWithConfig('hidden', compiled)).not.toBeNull();
    expect(checkClassWithConfig('block', compiled)).not.toBeNull();
  });

  it('multiple extends layers merge prohibited/allowed in array order', () => {
    CONFIG_PRESETS['test-extra'] = { prohibited: ['z-{n}'], allowed: ['z-0'] };
    try {
      const compiled = compileConfig({ ignore: [], extends: ['default', 'test-extra'] });
      expect(compiled.rules).toHaveLength(DEFAULT_CONFIG.prohibited.length + 1);
      expect(compiled.allowed.has('z-0')).toBe(true);
      expect(checkClassWithConfig('z-4', compiled)).not.toBeNull();
      expect(checkClassWithConfig('p-4', compiled)).not.toBeNull();
    } finally {
      delete CONFIG_PRESETS['test-extra'];
    }
  });

  it('presets never auto-compose with default — extending a non-default preset alone excludes default rules', () => {
    CONFIG_PRESETS['test-solo'] = { prohibited: ['z-{n}'] };
    try {
      const compiled = compileConfig({ ignore: [], extends: ['test-solo'] });
      expect(compiled.rules).toHaveLength(1);
      expect(checkClassWithConfig('p-4', compiled)).toBeNull();
      expect(checkClassWithConfig('z-4', compiled)).not.toBeNull();
    } finally {
      delete CONFIG_PRESETS['test-solo'];
    }
  });

  it('an unknown preset name throws ConfigError with a clear message', () => {
    expect(() => compileConfig({ ignore: [], extends: ['not-a-real-preset'] })).toThrow(
      ConfigError,
    );
    expect(() => compileConfig({ ignore: [], extends: ['not-a-real-preset'] })).toThrow(
      /Unknown preset "not-a-real-preset"/,
    );
  });

  it('loadConfig passes extends/prohibitedAdd/allowedAdd through untouched; compileConfig resolves and surfaces the unknown-preset ConfigError', async () => {
    const dir = join(tmpdir(), `dtl-test-extends-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(configPath, JSON.stringify({ extends: ['nope'], ignore: [] }));
    try {
      const config = await loadConfig(dir);
      expect(config.extends).toEqual(['nope']);
      // loadConfig itself doesn't resolve presets — compileConfig does — so
      // the ConfigError only surfaces once the config is compiled, exactly
      // like the CLI's loadConfig+compileConfig pipeline (both wrapped in the
      // same try/catch that maps to exit code 2).
      expect(() => compileConfig(config)).toThrow(ConfigError);
      expect(() => compileConfig(config)).toThrow(/Unknown preset "nope"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a non-string, non-string-array "extends" value at load time', async () => {
    const dir = join(tmpdir(), `dtl-test-extends-bad-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(configPath, JSON.stringify({ extends: 42, ignore: [] }));
    try {
      await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
      await expect(loadConfig(dir)).rejects.toThrow(
        /"extends" must be a string or an array of strings/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a non-string-array "prohibitedAdd"/"allowedAdd" value at load time', async () => {
    const dir = join(tmpdir(), `dtl-test-add-bad-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(configPath, JSON.stringify({ prohibitedAdd: 'p-{n}', ignore: [] }));
    try {
      await expect(loadConfig(dir)).rejects.toThrow(/"prohibitedAdd" must be an array of strings/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('regression: a config without extends behaves exactly as before', () => {
    const custom: LintConfig = { prohibited: ['p-{n}'], allowed: ['p-2'], ignore: [] };
    const compiled = compileConfig(custom);
    expect(checkClassWithConfig('p-2', compiled)).toBeNull();
    expect(checkClassWithConfig('p-4', compiled)).not.toBeNull();
    expect(checkClassWithConfig('bg-gray-500', compiled)).toBeNull();
  });

  it('regression: loadConfig + compileConfig on a config with neither extends nor prohibited/allowed still yields DEFAULT_CONFIG rules', async () => {
    const dir = join(tmpdir(), `dtl-test-noext-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, '.design-token-lint.json');
    await writeFile(configPath, JSON.stringify({ patterns: ['src/**/*.tsx'] }));
    try {
      const config = await loadConfig(dir);
      const compiled = compileConfig(config);
      expect(compiled).toEqual(compileConfig(DEFAULT_CONFIG));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('"z-index" preset (decision D3, issue #128)', () => {
  it('is registered in CONFIG_PRESETS with a z-{n} rule and z-0 allowed', () => {
    expect(CONFIG_PRESETS['z-index']).toEqual({
      prohibited: [
        {
          pattern: 'z-{n}',
          reason: 'Numeric z-index "{CLASS}" — use a semantic z tier token',
          category: 'z-index',
        },
      ],
      allowed: ['z-0'],
    });
  });

  it('is NOT part of DEFAULT_CONFIG — z-10 passes without extends', () => {
    expect(checkClassWithConfig('z-10', compileConfig(DEFAULT_CONFIG))).toBeNull();
  });

  it('extends: ["default", "z-index"] flags z-10 with the z-specific message, and still flags default rules', () => {
    const compiled = compileConfig({ ignore: [], extends: ['default', 'z-index'] });
    const result = checkClassWithConfig('z-10', compiled);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('Numeric z-index "z-10" — use a semantic z tier token');
    expect(result!.category).toBe('z-index');
    // Default rules are still layered in.
    expect(checkClassWithConfig('p-4', compiled)).not.toBeNull();
    expect(checkClassWithConfig('bg-gray-500', compiled)).not.toBeNull();
  });

  it('extends: ["default", "z-index"] does not flag z-0 (explicit allowed entry)', () => {
    const compiled = compileConfig({ ignore: [], extends: ['default', 'z-index'] });
    expect(checkClassWithConfig('z-0', compiled)).toBeNull();
  });

  it('extends: ["z-index"] alone flags ONLY z classes — no default rules apply', () => {
    const compiled = compileConfig({ ignore: [], extends: ['z-index'] });
    expect(compiled.rules).toHaveLength(1);
    expect(checkClassWithConfig('z-10', compiled)).not.toBeNull();
    // Default-only violations must NOT be flagged when "default" isn't listed.
    expect(checkClassWithConfig('p-4', compiled)).toBeNull();
    expect(checkClassWithConfig('bg-gray-500', compiled)).toBeNull();
  });
});
