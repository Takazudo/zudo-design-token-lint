import { describe, it, expect } from 'vitest';
import { checkClass, checkClassWithConfig } from './rules.js';
import { compileConfig, DEFAULT_CONFIG, CONFIG_PRESETS, type LintConfig } from './config.js';
import semanticPrefixesMatrix from './__fixtures__/semantic-prefixes-matrix.json';

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

  describe('fractional spacing and custom color edge cases', () => {
    it('flags fractional spacing values', () => {
      expect(checkClass('p-4.5')).not.toBeNull();
    });

    it('allows custom color names', () => {
      expect(checkClass('bg-custom-color')).toBeNull();
    });

    it('allows shade with non-numeric suffix', () => {
      expect(checkClass('bg-gray-500a')).toBeNull();
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

  describe('numeric sizing scale — prohibited by default (issue #128, decision D1)', () => {
    it.each([
      ['w-4', 'Numeric width'],
      ['h-8', 'Numeric height'],
      ['size-6', 'Numeric size'],
      ['min-w-4', 'Numeric min-width'],
      ['max-w-8', 'Numeric max-width'],
      ['min-h-2', 'Numeric min-height'],
      ['max-h-12', 'Numeric max-height'],
      ['basis-4', 'Numeric flex-basis'],
    ])('flags %s with a sizing-specific reason and category', (cls, reasonPrefix) => {
      const result = checkClass(cls);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain(reasonPrefix);
      expect(result!.reason).toContain(cls);
      expect(result!.category).toBe('sizing');
    });

    it.each(['sm:w-4', 'hover:h-8', '-min-w-4', 'w-4!'])(
      'flags %s (variant/negative/important forms)',
      (cls) => {
        const result = checkClass(cls);
        expect(result).not.toBeNull();
        expect(result!.category).toBe('sizing');
      },
    );
  });

  describe('numeric sizing scale — allowed exceptions (issue #128)', () => {
    it.each([
      'w-1/2',
      'h-1/3',
      'size-1/2',
      'min-w-1/2',
      'max-w-2/3',
      'w-icon-md',
      'h-icon-md',
      'w-[32px]',
      'h-[10rem]',
      'size-[24px]',
      'w-0',
      'h-0',
      'size-0',
      'min-w-0',
      'max-w-0',
      'min-h-0',
      'max-h-0',
      'basis-0',
      'w-full',
      'h-full',
      'w-auto',
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

    it('custom prefixes only allow their own tokens, not old defaults (issue #158 §8.8)', () => {
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
      // "hgap-" isn't in this config's semanticPrefixes at all, so p-hgap-*
      // is judged on its raw value like any other class: p-hgap-sm passes
      // because "hgap-sm" isn't numeric, but p-hgap-2 is judged on "hgap-2"
      // which is also not numeric as a whole string, so it passes too — it's
      // the presence of a *matching* semanticPrefixes entry (§8.1/§8.4) that
      // triggers the namespace-strip-and-re-test behavior, not its absence.
      expect(checkClassWithConfig('p-hgap-sm', compiled)).toBeNull();
      expect(checkClassWithConfig('p-hgap-2', compiled)).toBeNull();
      // "hsp-" IS in this config's semanticPrefixes, so p-hsp-2 strips to
      // tail "2", which is numeric — flagged.
      expect(checkClassWithConfig('p-hsp-2', compiled)).not.toBeNull();
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

  describe('suggestions map — did-you-mean hints (issue #130)', () => {
    it('resolves a no-placeholder exact-match entry to its suggestion via the normalized (variant-stripped) path', () => {
      const custom: LintConfig = {
        prohibited: ['hidden'],
        allowed: [],
        ignore: [],
        suggestions: { hidden: 'sr-only' },
      };
      const compiled = compileConfig(custom);
      const result = checkClassWithConfig('sm:hidden', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('did you mean "sr-only"?');
    });

    it('looks up the suggestion via the normalized form even when the rule itself only matches verbatim (variant-qualified pattern)', () => {
      // "hover:p-2" is an exact-match prohibited entry that only fires via the
      // verbatim comparison (originalClassName === rule.prefix) — see
      // matchRule's "exact-match rule" branch. The suggestion map is still
      // keyed by the normalized base class ("p-2"), same as `allowed`.
      const custom: LintConfig = {
        prohibited: ['hover:p-2'],
        allowed: [],
        ignore: [],
        suggestions: { 'p-2': 'p-hsp-sm' },
      };
      const compiled = compileConfig(custom);
      const result = checkClassWithConfig('hover:p-2', compiled);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('did you mean "p-hsp-sm"?');
    });
  });

  // Locked v2 contract — issue #158. The matrix fixture (shared with the
  // Playground mirror parity test, #160) covers §8.1, §8.2, §8.3, and §8.4;
  // the describe blocks below cover the remaining rows (§8.5-§8.7) plus the
  // exact reason-string and category assertions the fixture's pass/flag
  // shape can't express on its own.
  describe('semanticPrefixes v2 — namespace strip (issue #158)', () => {
    it.each(
      semanticPrefixesMatrix as {
        prohibited: LintConfig['prohibited'];
        allowed: string[];
        semanticPrefixes: string[];
        className: string;
        expect: 'pass' | 'flag';
      }[],
    )(
      '$expect: $className with semanticPrefixes=$semanticPrefixes',
      ({ prohibited, allowed, semanticPrefixes, className, expect: expected }) => {
        const compiled = compileConfig({ prohibited, allowed, ignore: [], semanticPrefixes });
        const result = checkClassWithConfig(className, compiled);
        if (expected === 'pass') {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
        }
      },
    );

    describe('§8.1 — the named observability pair, full reason string', () => {
      it('p-hgap-2 flags with the exact §4 reason string', () => {
        const compiled = compileConfig({
          prohibited: ['p-{n}'],
          allowed: [],
          ignore: [],
          semanticPrefixes: ['hgap-'],
        });
        const result = checkClassWithConfig('p-hgap-2', compiled);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe(
          'Numeric spacing "p-hgap-2" — use a semantic spacing token or arbitrary value' +
            ' (numeric tail after the "hgap-" semantic prefix)',
        );
      });

      it('appends the did-you-mean hint after the parenthetical when a suggestion is configured', () => {
        const compiled = compileConfig({
          prohibited: ['p-{n}'],
          allowed: [],
          ignore: [],
          semanticPrefixes: ['hgap-'],
          suggestions: { 'p-hgap-2': 'p-hgap-sm' },
        });
        const result = checkClassWithConfig('p-hgap-2', compiled);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe(
          'Numeric spacing "p-hgap-2" — use a semantic spacing token or arbitrary value' +
            ' (numeric tail after the "hgap-" semantic prefix)' +
            ' — did you mean "p-hgap-sm"?',
        );
      });

      it('the parenthetical names the entry verbatim as authored — no dash added', () => {
        const compiled = compileConfig({
          prohibited: ['p-{n}'],
          allowed: [],
          ignore: [],
          semanticPrefixes: ['hgap'],
        });
        const result = checkClassWithConfig('p-hgap-2', compiled);
        expect(result).not.toBeNull();
        expect(result!.reason).toContain('(numeric tail after the "hgap" semantic prefix)');
      });
    });

    describe('§8.4 — category is carried through the strip for sizing rules', () => {
      it.each([
        ['w-hsp-3', 'sizing'],
        ['h-vsp-2', 'sizing'],
        ['size-hgap-2', 'sizing'],
        ['min-w-hgap-1', 'sizing'],
        ['basis-hgap-2', 'sizing'],
      ] as const)('%s carries category %s', (cls, category) => {
        const result = checkClassWithConfig(cls, compileConfig(DEFAULT_CONFIG));
        expect(result).not.toBeNull();
        expect(result!.category).toBe(category);
      });

      it('bare p-hgap-2 (from an unstructured pattern) carries no category', () => {
        const result = checkClassWithConfig('p-hgap-2', compileConfig(DEFAULT_CONFIG));
        expect(result).not.toBeNull();
        expect(result!.category).toBeUndefined();
      });

      it.each(['-m-hgap-2', 'sm:p-hgap-2', 'p-hgap-2!', '!p-hgap-2'])(
        '%s: variant/negative/important normalization runs before the strip, and className echoes the original',
        (cls) => {
          const result = checkClassWithConfig(cls, compileConfig(DEFAULT_CONFIG));
          expect(result).not.toBeNull();
          expect(result!.className).toBe(cls);
        },
      );
    });

    describe('§8.5 — still flagged, unchanged (DEFAULT_CONFIG + z-index preset)', () => {
      const compiled = compileConfig({
        ignore: [],
        extends: ['default', 'z-index'],
      });

      it.each(['p-4', 'w-64', 'z-10', 'bg-gray-500', 'sm:p-4', '-mt-4', 'p-4!'])(
        'flags %s',
        (cls) => {
          expect(checkClassWithConfig(cls, compiled)).not.toBeNull();
        },
      );
    });

    describe('§8.6 — z-{n} family', () => {
      const compiled = compileConfig({
        prohibited: [CONFIG_PRESETS['z-index'].prohibited[0]],
        allowed: ['z-0'],
        ignore: [],
        semanticPrefixes: ['ztier-'],
      });

      it('z-auto passes (not numeric)', () => {
        expect(checkClassWithConfig('z-auto', compiled)).toBeNull();
      });

      it('z-0 passes (allowed)', () => {
        expect(checkClassWithConfig('z-0', compiled)).toBeNull();
      });

      it('z-10 flags with category z-index', () => {
        const result = checkClassWithConfig('z-10', compiled);
        expect(result).not.toBeNull();
        expect(result!.category).toBe('z-index');
      });

      it('z-ztier-modal passes (non-numeric tail)', () => {
        expect(checkClassWithConfig('z-ztier-modal', compiled)).toBeNull();
      });

      it('z-ztier-2 flags with category z-index (NEW)', () => {
        const result = checkClassWithConfig('z-ztier-2', compiled);
        expect(result).not.toBeNull();
        expect(result!.category).toBe('z-index');
      });
    });

    describe('§8.7 — escape hatches and message composition', () => {
      it('allowed wins over a semanticPrefixes-triggered flag', () => {
        const compiled = compileConfig({
          prohibited: ['p-{n}'],
          allowed: ['p-hgap-2'],
          ignore: [],
          semanticPrefixes: ['hgap-'],
        });
        expect(checkClassWithConfig('p-hgap-2', compiled)).toBeNull();
      });

      it('a custom reason on a structured entry keeps the §4 parenthetical appended', () => {
        const compiled = compileConfig({
          prohibited: [{ pattern: 'p-{n}', reason: 'Custom message for "{CLASS}"' }],
          allowed: [],
          ignore: [],
          semanticPrefixes: ['hgap-'],
        });
        const result = checkClassWithConfig('p-hgap-2', compiled);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe(
          'Custom message for "p-hgap-2" (numeric tail after the "hgap-" semantic prefix)',
        );
      });

      it('semanticPrefixes has REPLACE semantics under extends, not merge', () => {
        const compiled = compileConfig({
          ignore: [],
          extends: ['default'],
          semanticPrefixes: ['hsp-'],
        });
        expect(compiled.semanticPrefixes).toEqual(['hsp-']);
      });

      it('empty-string semanticPrefixes entries are filtered', () => {
        const compiled = compileConfig({
          prohibited: DEFAULT_CONFIG.prohibited,
          allowed: DEFAULT_CONFIG.allowed,
          ignore: [],
          semanticPrefixes: ['', 'hgap-'],
        });
        expect(compiled.semanticPrefixes).toEqual(['hgap-']);
      });
    });
  });
});
