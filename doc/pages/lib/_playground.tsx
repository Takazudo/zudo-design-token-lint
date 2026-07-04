/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Host-side MDX wrapper for <Playground> — the design-token-lint interactive
// browser demo. Applies the zfb Island around the real "use client" Playground
// component.
//
// The Playground UI lives in src/components/playground.tsx and its browser-safe
// linter core in src/lib/lint-browser.ts (a hand-maintained mirror of the root
// lint engine with no node:* imports). It is a fully client-only island — it
// relies on useState/useEffect/useRef and runs the linter live as the user
// types — so it is wrapped in `<Island when="load">` with a static SSR fallback
// (client:only mode) rather than server-rendered.
//
// ## Why client:only (ssrFallback) and not a server-rendered island
//
// The component calls preact/compat hooks (useState/useRef/useEffect via the
// `react` alias). Server-rendering it in the zfb SSR pipeline throws
// "Cannot read properties of undefined (reading '__H')" — the compat hooks
// state is not wired into the SSR renderer's preact instance. So the heavy
// child MUST be skipped server-side; `ssrFallback` switches the Island into
// SSR-skip mode (Astro `client:only` equivalent), emitting
// `data-zfb-island-skip-ssr="Playground"` and rendering the placeholder until
// the runtime mounts the real component on the client. Mirrors the original
// design on `main` (pages/lib/_playground.tsx).
//
// ## Island wiring (mirrors _preset-generator.tsx — the canonical pattern)
//
// Registered in pages/lib/_chrome.ts as the `Playground` entry of the
// `mdxExtras` bag. The zfb island scanner walks the STATIC import chain
// page → _chrome.ts → here → Playground and registers Playground in the client
// manifest. A dynamic/type-only import would break that walk and hydration
// would silently never fire (orphan-component problem). The `react` imports
// inside playground.tsx resolve to preact/compat via the tsconfig `paths` alias
// (build-time: framework=preact + bundle.mainFields in zfb.config.ts).

import type { VNode } from "preact";
import { Island } from "@takazudo/zfb";
import Playground from "@/components/playground";

// Pin displayName so zfb's captureComponentName produces a stable marker name
// even after the SSR pipeline runs the component through a function-name
// rewriting layer. Must match the data-zfb-island-skip-ssr="Playground"
// attribute the hydration runtime queries. Mirrors _preset-generator.tsx.
(Playground as { displayName?: string }).displayName = "Playground";

/**
 * Public MDX-registered binding (`Playground: PlaygroundIsland`). Wraps the
 * real client-only component in `<Island when="load">` with a static SSR
 * fallback:
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
