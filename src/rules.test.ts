import { describe, it, expect } from 'vitest';
import { checkClass } from './rules.js';

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
