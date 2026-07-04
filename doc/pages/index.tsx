/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Page module for the site index route.
//
// Default-locale (EN) site index. Static route — no paths() export needed.
// Hands the resolved locale to the shared `prepareHomeData` factory (#2519)
// — which now owns the nav-tree / tag-count data-prep sequence — and passes
// the result to the shared HomePageView body (epic #2499, S4 #2503).
//
// Data flow:
//   routeContext              host RouteContext (settings + i18n + nav helpers)
//   → prepareHomeData()       nav tree, category order, tag count
//   → HomePageView            renders hero + SiteTreeNav grid + tag section
//
// Thin consumer of `HomePageView` (S3 #2502) and `prepareHomeData` (#2519):
// this file's only job is resolving the default locale — mirroring the
// package route's shape (`packages/zudo-doc/src/routes/index.tsx`). No
// `extras` here — the showcase's `@Takazudo` brand link (#1453) is
// project-specific and is not part of the generated project's hero.

import { routeContext } from "./lib/_route-context";
import { prepareHomeData } from "@takazudo/zudo-doc/home-page";
import type { JSX } from "preact";
import { HomePageView } from "./lib/_chrome";

export const frontmatter = { title: "Home" };

export default function IndexPage(): JSX.Element {
  const locale = routeContext.defaultLocale;

  const { tree, categoryOrder, tagCount } = prepareHomeData(routeContext, locale);

  return (
    <HomePageView
      locale={locale}
      tree={tree}
      categoryOrder={categoryOrder}
      tagCount={tagCount}
    />
  );
}
