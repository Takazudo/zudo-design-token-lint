import { describe, it, expect } from 'vitest';
import { compilePattern, compileConfig, DEFAULT_CONFIG, type LintConfig } from './config.js';
import { checkClassWithConfig } from './rules.js';

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
