// Host-callables channel for this doc site — the sanctioned
// `chromeBindingsModule` seam (zudo-doc 4.x+). Wired via
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
// `ssrFallback` switches the Island into SSR-skip mode (the Astro
// `client:only` equivalent): SSR emits only the lightweight placeholder inside
// `data-zfb-island-skip-ssr="Playground"`, and the runtime mounts the real
// component on the client. The playground's initial lint run and its
// textareas only matter once hydrated, so there is nothing to gain from
// server-rendering the full UI.
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

import { Island } from '@takazudo/zfb';
import type { Child } from '@takazudo/zfb/zudo-react';
import { defineChromeBindings } from '@takazudo/zudo-doc/chrome-bindings';
import Playground, { type PlaygroundLang } from './components/playground';

/**
 * MDX binding for `<Playground />` — a server boundary that owns the Island
 * mount (zudo-doc 6+ shape). SSR emits the placeholder notice as static HTML
 * inside the skip-ssr div; the hydration runtime mounts the real interactive
 * component into it after load. The optional `lang` MDX attribute
 * (`<Playground lang="ja" />` on the JA page) localizes the island's UI chrome;
 * only that plain string crosses the island prop boundary, and it is omitted
 * entirely when absent (Island props must not carry `undefined` values).
 */
export function PlaygroundIsland({ lang }: { lang?: PlaygroundLang } = {}): Child {
  const fallback = (
    <div
      class="zd-playground-placeholder rounded-lg border border-muted/30 bg-surface/50 p-hsp-md"
      data-playground-placeholder
    >
      <p class="text-caption text-muted">
        {lang === 'ja'
          ? 'インタラクティブな Playground を読み込み中…'
          : 'Loading the interactive playground…'}
      </p>
    </div>
  );
  const islandProps = lang !== undefined ? { lang } : {};

  return (
    <>
      <Island when="load" ssrFallback={fallback}>
        <Playground {...islandProps} />
      </Island>
    </>
  );
}

export const chromeBindings = defineChromeBindings({
  mdxExtras: { Playground: PlaygroundIsland },
});
