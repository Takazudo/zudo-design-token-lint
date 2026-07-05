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

  describe('trailing important modifier (Tailwind v4) — prohibited', () => {
    it.each(['p-4!', '-mt-4!', 'bg-red-500!', 'sm:p-4!', 'bg-red-500/50!'])('flags %s', (cls) => {
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

  describe('fraction utilities — allowed (not false-positived as numeric spacing)', () => {
    it.each([
      'w-1/2',
      'w-1/3',
      'w-2/3',
      'w-3/4',
      'size-1/2',
      'top-1/2',
      'min-w-1/2',
      'inset-1/2',
      'inset-x-1/2',
    ])('allows %s', (cls) => {
      expect(checkClass(cls)).toBeNull();
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

  describe('logical and v4 color utilities — prohibited', () => {
    it.each([
      'border-s-red-500',
      'border-e-red-500',
      'ring-offset-blue-600',
      'inset-ring-gray-400',
      'inset-shadow-gray-900',
      'text-shadow-gray-900',
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

    it('custom prefixes only allow their own tokens, not old defaults', () => {
      const custom: LintConfig = {
        prohibited: DEFAULT_CONFIG.prohibited,
        allowed: DEFAULT_CONFIG.allowed,
        ignore: DEFAULT_CONFIG.ignore,
        semanticPrefixes: ['hsp-', 'vsp-'],
      };
      const compiled = compileConfig(custom);
      // New custom prefixes are allowed
      expect(checkClassWithConfig('p-hsp-sm', compiled)).toBeNull();
      expect(checkClassWithConfig('gap-vsp-xs', compiled)).toBeNull();
      // Old defaults pass through (no violation because hgap-sm is non-numeric anyway)
      expect(checkClassWithConfig('p-hgap-sm', compiled)).toBeNull();
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

  describe('allowed list — matches original className verbatim', () => {
    const custom: LintConfig = {
      prohibited: DEFAULT_CONFIG.prohibited,
      allowed: ['-mt-4', 'hover:p-2', 'bg-red-500/50'],
      ignore: DEFAULT_CONFIG.ignore,
    };
    const compiled = compileConfig(custom);

    it.each(['-mt-4', 'hover:p-2', 'bg-red-500/50'])(
      'allows %s when listed verbatim in allowed',
      (cls) => {
        expect(checkClassWithConfig(cls, compiled)).toBeNull();
      },
    );

    it('bare normalized entries still cover variant/negative forms (regression)', () => {
      const bareAllowed: LintConfig = {
        prohibited: DEFAULT_CONFIG.prohibited,
        allowed: ['p-4'],
        ignore: DEFAULT_CONFIG.ignore,
      };
      const compiledBare = compileConfig(bareAllowed);
      expect(checkClassWithConfig('p-4', compiledBare)).toBeNull();
      expect(checkClassWithConfig('sm:p-4', compiledBare)).toBeNull();
      expect(checkClassWithConfig('hover:p-4', compiledBare)).toBeNull();
    });

    it('does not allow unrelated classes matching the same rule', () => {
      // "-mt-4" is allowed verbatim, but its normalized form "mt-4" is not,
      // so a different negative value must still be flagged.
      expect(checkClassWithConfig('-mt-8', compiled)).not.toBeNull();
    });
  });

  describe('exact prohibited patterns — verbatim + normalized matching', () => {
    it('a leading-dash exact entry matches its literal verbatim form', () => {
      const custom: LintConfig = {
        prohibited: ['-mt-px'],
        allowed: [],
        ignore: [],
      };
      const compiled = compileConfig(custom);
      const result = checkClassWithConfig('-mt-px', compiled);
      expect(result).not.toBeNull();
      expect(result!.className).toBe('-mt-px');
    });

    it('a variant-prefixed exact entry matches only its literal verbatim form, not the bare normalized token', () => {
      const custom: LintConfig = {
        prohibited: ['hover:p-2'],
        allowed: [],
        ignore: [],
      };
      const compiled = compileConfig(custom);
      expect(checkClassWithConfig('hover:p-2', compiled)).not.toBeNull();
      // The normalized form of "hover:p-2" is "p-2", a different string from
      // the entry "hover:p-2" — a bare "p-2" must NOT be flagged by this rule.
      expect(checkClassWithConfig('p-2', compiled)).toBeNull();
    });

    it('a trailing-important exact entry matches its literal verbatim form', () => {
      const custom: LintConfig = {
        prohibited: ['p-4!'],
        allowed: [],
        ignore: [],
      };
      const compiled = compileConfig(custom);
      expect(checkClassWithConfig('p-4!', compiled)).not.toBeNull();
    });

    it('a plain exact entry still fires via the normalized path on variant/negative/important forms (regression)', () => {
      const custom: LintConfig = {
        prohibited: ['p-2'],
        allowed: [],
        ignore: [],
      };
      const compiled = compileConfig(custom);
      expect(checkClassWithConfig('p-2', compiled)).not.toBeNull();
      expect(checkClassWithConfig('hover:p-2', compiled)).not.toBeNull();
      expect(checkClassWithConfig('-p-2', compiled)).not.toBeNull();
      expect(checkClassWithConfig('p-2!', compiled)).not.toBeNull();
    });
  });

  describe('semanticPrefixes bypass — priority over the numeric check (characterization)', () => {
    it('a digit-leading semanticPrefixes entry bypasses the numeric spacing rule even when the value would also match the numeric pattern', () => {
      const custom: LintConfig = {
        prohibited: ['p-{n}'],
        allowed: [],
        ignore: [],
        semanticPrefixes: ['1'],
      };
      const compiled = compileConfig(custom);
      // "12" is a purely-numeric value that would normally be flagged, but it
      // also starts with the (unusual, digit-leading) semantic prefix "1", so
      // the semanticPrefixes bypass — which runs before the numeric
      // valuePattern test — takes priority and allows it.
      expect(checkClassWithConfig('p-12', compiled)).toBeNull();
    });
  });

  describe('spacing "1px" values — allowed via the allowed list, not a dedicated bypass (characterization)', () => {
    it('p-1px is allowed by the default allowed list', () => {
      expect(checkClass('p-1px')).toBeNull();
    });

    it('a value of exactly "1px" fails the numeric valuePattern on its own, so a prefix not in the allowed list is still flagged as null-safe without any dedicated "1px" bypass', () => {
      const custom: LintConfig = {
        prohibited: ['mt-{n}'],
        allowed: [], // "mt-1px" is deliberately absent from allowed
        ignore: [],
      };
      const compiled = compileConfig(custom);
      // "1px" contains non-digit characters, so it can never satisfy the
      // ^\d+(\.\d+)?$ numeric spacing pattern regardless of any special-cased
      // "value === '1px'" check — this is why that check was dead code.
      expect(checkClassWithConfig('mt-1px', compiled)).toBeNull();
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
