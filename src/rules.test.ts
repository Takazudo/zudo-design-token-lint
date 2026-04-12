import { describe, it, expect } from 'vitest';
import { checkClass, checkClassWithConfig } from './rules.js';
import { compileConfig, DEFAULT_CONFIG, type LintConfig } from './config.js';

describe('checkClass', () => {
  describe('numeric spacing — prohibited', () => {
    it.each([
      'p-2',
      'p-4',
      'm-8',
      'gap-4',
      'px-6',
      'py-3',
      'pt-1',
      'pb-12',
      'space-x-4',
      'space-y-2',
      'mt-16',
      'mr-0.5',
      'inset-4',
      'top-2',
      'right-8',
      'bottom-4',
      'left-6',
    ])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Numeric spacing');
    });
  });

  describe('numeric spacing with prefixes — prohibited', () => {
    it.each(['sm:p-4', 'md:gap-8', 'hover:m-2', 'lg:px-6', 'dark:py-3', 'md:hover:p-4'])(
      'flags %s',
      (cls) => {
        const result = checkClass(cls);
        expect(result).not.toBeNull();
        expect(result!.reason).toContain('Numeric spacing');
      },
    );
  });

  describe('negative spacing — prohibited', () => {
    it.each(['-m-4', '-mt-2', '-top-8', '-left-4'])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Numeric spacing');
    });
  });

  describe('important modifier — prohibited', () => {
    it.each(['!p-4', '!m-8', '!bg-gray-500', 'sm:!p-4'])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
    });
  });

  describe('hyphenated modifiers — prohibited', () => {
    it.each([
      'group-hover:p-4',
      'peer-focus:m-8',
      'aria-selected:bg-gray-500',
      'data-[state=open]:p-4',
    ])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
    });
  });

  describe('opacity modifier — prohibited', () => {
    it.each(['bg-gray-500/50', 'text-blue-600/75', 'bg-red-300/[.5]'])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
    });
  });

  describe('default Tailwind colors — prohibited', () => {
    it.each([
      'bg-gray-500',
      'text-blue-600',
      'border-red-300',
      'from-green-400',
      'text-slate-700',
      'bg-zinc-800',
      'ring-indigo-500',
      'divide-purple-200',
      'via-cyan-300',
      'to-amber-600',
    ])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Default Tailwind color');
    });
  });

  describe('default Tailwind colors with prefixes — prohibited', () => {
    it.each(['hover:bg-gray-500', 'sm:text-blue-600', 'dark:border-red-300'])('flags %s', (cls) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Default Tailwind color');
    });
  });

  describe('semantic tokens — allowed', () => {
    it.each([
      'p-hgap-sm',
      'gap-vgap-xs',
      'bg-zd-black',
      'text-zd-white',
      'border-zd-gray',
      'm-hgap-md',
      'py-vgap-lg',
      'px-hgap-xs',
      'gap-x-hgap-sm',
      'mt-vgap-2xs',
      'space-x-hgap-2xs',
    ])('allows %s', (cls) => {
      expect(checkClass(cls)).toBeNull();
    });
  });

  describe('zero and 1px — allowed', () => {
    it.each(['p-0', 'm-0', 'gap-0', 'p-1px', 'border-1px', 'mt-0', 'pb-0', 'sm:p-0'])(
      'allows %s',
      (cls) => {
        expect(checkClass(cls)).toBeNull();
      },
    );
  });

  describe('arbitrary values — allowed', () => {
    it.each([
      'w-[28px]',
      'gap-[4px]',
      'bg-[#123]',
      'text-[14px]',
      'p-[10px]',
      'm-[2rem]',
      'top-[50%]',
    ])('allows %s', (cls) => {
      expect(checkClass(cls)).toBeNull();
    });
  });

  describe('non-spacing/non-color utilities — allowed', () => {
    it.each([
      'flex',
      'grid',
      'hidden',
      'block',
      'relative',
      'absolute',
      'overflow-hidden',
      'cursor-pointer',
      'w-full',
      'h-full',
      'min-w-0',
      'text-center',
      'font-bold',
      'rounded-lg',
      'opacity-50',
      'z-10',
      'transition',
      'duration-300',
    ])('allows %s', (cls) => {
      expect(checkClass(cls)).toBeNull();
    });
  });

  describe('semanticPrefixes — configurable allowlist', () => {
    it('default prefixes still allow hgap-* and vgap-* (regression)', () => {
      expect(checkClass('p-hgap-sm')).toBeNull();
      expect(checkClass('gap-vgap-xs')).toBeNull();
      expect(checkClass('m-hgap-md')).toBeNull();
    });

    it('custom prefixes allow matching tokens', () => {
      const custom: LintConfig = {
        prohibited: DEFAULT_CONFIG.prohibited,
        allowed: DEFAULT_CONFIG.allowed,
        ignore: DEFAULT_CONFIG.ignore,
        semanticPrefixes: ['hsp-', 'vsp-'],
      };
      const compiled = compileConfig(custom);
      expect(checkClassWithConfig('p-hsp-sm', compiled)).toBeNull();
      expect(checkClassWithConfig('gap-vsp-xs', compiled)).toBeNull();
    });

    it('custom prefixes do not interfere with unrelated violations', () => {
      const custom: LintConfig = {
        prohibited: DEFAULT_CONFIG.prohibited,
        allowed: DEFAULT_CONFIG.allowed,
        ignore: DEFAULT_CONFIG.ignore,
        semanticPrefixes: ['hsp-', 'vsp-'],
      };
      const compiled = compileConfig(custom);
      const result = checkClassWithConfig('p-4', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Numeric spacing');
    });

    it('empty semanticPrefixes preserves normal behavior', () => {
      const custom: LintConfig = {
        prohibited: DEFAULT_CONFIG.prohibited,
        allowed: DEFAULT_CONFIG.allowed,
        ignore: DEFAULT_CONFIG.ignore,
        semanticPrefixes: [],
      };
      const compiled = compileConfig(custom);
      // numeric spacing still flagged
      expect(checkClassWithConfig('p-4', compiled)).not.toBeNull();
      // colors still flagged
      expect(checkClassWithConfig('bg-gray-500', compiled)).not.toBeNull();
    });
  });

  describe('suggestionSuffix — configurable violation message', () => {
    it('default spacing message is generic (no hgap/vgap mention)', () => {
      const result = checkClass('p-4');
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('use a semantic spacing token or arbitrary value');
      expect(result!.reason).not.toContain('hgap-');
      expect(result!.reason).not.toContain('vgap-');
    });

    it('default color message is generic', () => {
      const result = checkClass('bg-gray-500');
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('use a design system color token');
    });

    it('custom suggestionSuffix appears in spacing violation', () => {
      const custom: LintConfig = {
        prohibited: ['p-{n}'],
        allowed: [],
        ignore: [],
        suggestionSuffix: 'use hsp-*/vsp-* tokens',
      };
      const compiled = compileConfig(custom);
      const result = checkClassWithConfig('p-4', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('use hsp-*/vsp-* tokens');
      expect(result!.reason).toContain('Numeric spacing');
    });

    it('custom suggestionSuffix appears in color violation', () => {
      const custom: LintConfig = {
        prohibited: ['bg-{color}-{shade}'],
        allowed: [],
        ignore: [],
        suggestionSuffix: 'use zd-* color tokens',
      };
      const compiled = compileConfig(custom);
      const result = checkClassWithConfig('bg-gray-500', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('use zd-* color tokens');
      expect(result!.reason).toContain('Default Tailwind color');
    });
  });

  describe('design system color tokens — allowed', () => {
    it.each([
      'bg-bg',
      'text-fg',
      'bg-surface',
      'text-muted',
      'bg-accent',
      'text-accent-hover',
      'bg-success',
      'bg-danger',
      'bg-warning',
      'bg-info',
      'text-price',
      'text-sold',
      'text-link',
      'bg-code-bg',
      'text-code-fg',
      'bg-p0',
      'text-p5',
      'bg-p15',
      'bg-black',
      'text-white',
      'bg-transparent',
      'bg-status-pending',
      'bg-status-notified',
      'bg-btn-success',
      'bg-btn-danger',
      'bg-alert-error-bg',
      'border-alert-error-border',
      'bg-debug',
    ])('allows %s', (cls) => {
      expect(checkClass(cls)).toBeNull();
    });
  });
});
