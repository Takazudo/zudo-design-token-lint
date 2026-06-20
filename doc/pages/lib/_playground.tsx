/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// SSR fallback + island wiring for the interactive <Playground>.
//
// The Playground is the design-token-lint browser demo: the UI lives in
// src/components/playground.tsx and its browser-safe linter core in
// src/lib/lint-browser.ts (no dependency on the npm package build). It is a
// fully client-only island — it relies on useState/useEffect/useRef and runs
// the linter live as the user types — so it is wrapped in `<Island>` with a
// static SSR fallback rather than rendered server-side.
//
// This file is imported transitively from page modules
// (pages/docs/[...slug].tsx → _mdx-components.ts → here), so zfb's island
// scanner walks the static import chain page → helper → real component and
// registers Playground in the island manifest. Without that import chain the
// scanner never finds the component and client-side hydration never fires
// (orphan-component problem). Mirrors pages/lib/_preset-generator.tsx and the
// body-end islands in _body-end-islands.tsx.
//
// Replaces the static placeholder the core migration (#85) shipped: the real
// component is now imported and mounted via the canonical `<Island ssrFallback>`
// API (zfb). The `react` imports inside playground.tsx resolve to preact/compat
// through the tsconfig `paths` alias.

import type { VNode } from "preact";
import { Island } from "@takazudo/zfb";
import Playground from "@/components/playground";

// Pin displayName so zfb's captureComponentName produces a stable marker name
// even after the SSR pipeline runs the component through a function-name
// rewriting layer. Must match the data-zfb-island-skip-ssr attribute value the
// hydration runtime queries. Mirrors the pattern in _preset-generator.tsx and
// _body-end-islands.tsx.
(Playground as { displayName?: string }).displayName = "Playground";

/**
 * SSR fallback for the interactive Playground island.
 *
 * The real Playground is client-only (live linting via useState/useEffect),
 * so the server emits a lightweight placeholder notice inside the skip-ssr
 * div. The Island `ssrFallback` API connects this import to the manifest:
 *
 * - SSR emits the placeholder notice as static HTML inside the skip-ssr div.
 * - The scanner reads children.type = Playground → registers it in the
 *   manifest under "Playground".
 * - The hydration runtime mounts the real interactive component into the
 *   skip-ssr placeholder on the client after load (when="load", matching the
 *   original Astro `client:load` directive).
 */
export function PlaygroundIsland(): VNode {
  const fallback = (
    <div class="zd-playground-placeholder" data-playground-placeholder>
      <p>Loading the interactive playground…</p>
    </div>
  );

  return Island({
    when: "load",
    ssrFallback: fallback,
    children: <Playground />,
  }) as unknown as VNode;
}
