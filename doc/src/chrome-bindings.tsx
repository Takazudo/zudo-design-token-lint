/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Host-callables channel for this doc site — the sanctioned
// `chromeBindingsModule` seam (zudo-doc 4.x). Wired via
// `chromeBindingsModule: "./src/chrome-bindings.tsx"` in zfb.config.ts, which
// the routes plugin re-exports through `virtual:zudo-doc-chrome-bindings`.
//
// This site binds exactly ONE slot: the `<Playground>` MDX tag used by
// src/content/docs{,-ja}/playground/index.mdx — the design-token-lint live
// browser demo. Everything else the pre-4.x `pages/lib/_chrome.ts` used to
// hand-assemble (search widget, nav sources, doc-route entries, frontmatter
// preview, footer taglist, body-end islands) is package-owned on 4.x and needs
// no host binding.
//
// ## Why `<Island ssrFallback>` and not a server-rendered component
//
// Playground calls preact/compat hooks (useState/useRef/useEffect via the
// `react` alias). Server-rendering it in the zfb SSR pipeline throws
// "Cannot read properties of undefined (reading '__H')" — the compat hooks
// state is not wired into the SSR renderer's preact instance. `ssrFallback`
// switches the Island into SSR-skip mode (the Astro `client:only` equivalent),
// emitting `data-zfb-island-skip-ssr="Playground"` around the placeholder until
// the runtime mounts the real component on the client. Same design as the
// pre-rescaffold `pages/lib/_playground.tsx`.
//
// ## Scanner reachability (load-bearing, do not "simplify")
//
// The `virtual:zudo-doc-chrome-bindings` path is SSR-presentational only — a
// component reached solely through it is NOT scanner-reachable, so it would
// never hydrate. Per zudo-doc's "Interactive islands (experimental)" recipe,
// both doc-route stubs (pages/docs/[[...slug]].tsx and its [locale] variant)
// import THIS module statically instead, so zfb's island scanner can walk
// page -> chrome-bindings -> Playground and register the constructor under the
// SSR marker name.

import type { VNode } from 'preact';
import { Island } from '@takazudo/zfb';
import { defineChromeBindings } from '@takazudo/zudo-doc/chrome-bindings';
import Playground, { type PlaygroundLang } from './components/playground';

// Pin displayName so zfb's captureComponentName produces a stable marker name
// even after the SSR pipeline runs the component through a function-name
// rewriting layer. Must match the `data-zfb-island-skip-ssr="Playground"`
// attribute the hydration runtime queries.
(Playground as { displayName?: string }).displayName = 'Playground';

/**
 * MDX binding for `<Playground />`. SSR emits the placeholder notice as static
 * HTML inside the skip-ssr div; the hydration runtime mounts the real
 * interactive component into it after load. The optional `lang` MDX attribute
 * (`<Playground lang="ja" />` on the JA page) localizes the island's UI chrome;
 * only that plain string crosses the island prop boundary.
 */
export function PlaygroundIsland({ lang }: { lang?: PlaygroundLang } = {}): VNode {
  const fallback = (
    <div
      className="zd-playground-placeholder rounded-lg border border-muted/30 bg-surface/50 p-hsp-md"
      data-playground-placeholder
    >
      <p className="text-caption text-muted">
        {lang === 'ja'
          ? 'インタラクティブな Playground を読み込み中…'
          : 'Loading the interactive playground…'}
      </p>
    </div>
  );

  return Island({
    when: 'load',
    ssrFallback: fallback,
    children: <Playground lang={lang} />,
  }) as unknown as VNode;
}

export const chromeBindings = defineChromeBindings({
  mdxExtras: { Playground: PlaygroundIsland },
});
