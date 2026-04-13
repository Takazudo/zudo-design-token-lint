import { describe, it, expect } from 'vitest';
import {
  compilePattern,
  compileConfig,
  loadConfig,
  DEFAULT_CONFIG,
  type LintConfig,
  type CompiledConfig,
} from './config.js';
import { checkClassWithConfig } from './rules.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
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
