/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Placeholder SSR binding for the <Playground> island.
//
// The interactive Playground (the Astro island in
// src/components/playground.tsx + src/lib/lint-browser.ts) is ported to zfb in
// a SEPARATE sub-issue (#86). For the core framework migration (#85) this
// binding only has to make the Playground page BUILD green under zfb — so it
// renders a static placeholder notice and does NOT import the real component.
//
// Intentionally does NOT import src/components/playground.tsx: pulling it into
// the page graph here would pre-empt #86's island wiring (manifest
// registration, hydration, react→preact/compat handling). #86 replaces this
// file's body with an <Island> wrapping the real component.

import type { VNode } from "preact";

/**
 * Static placeholder shown where the interactive Playground will render.
 *
 * Keeps the page route building and gives readers a clear note that the live
 * playground is being ported. Replaced with the real island in #86.
 */
export function PlaygroundPlaceholder(): VNode {
  return (
    <div class="zd-playground-placeholder" data-playground-placeholder>
      <p>
        The interactive playground is being ported to the new build system and
        will be available again shortly.
      </p>
    </div>
  );
}
