/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Page module for the locale-prefixed site index route.
//
// Non-default-locale site index. paths() emits one route per locale defined
// in settings.locales (never the default locale — that is handled by
// pages/index.tsx since prefixDefaultLocale is false).
//
// paths() contract (zfb ADR-004 — synchronous):
//   params: { locale: string }   — e.g. "ja"
//   props:  { locale }           — resolved locale passed to component
//
// Data flow (inside component — sync per ADR-004):
//   routeContext              host RouteContext (settings + i18n + nav helpers)
//   → prepareHomeData()       nav tree, category order, tag count
//   → HomePageView            renders hero + SiteTreeNav grid + tag section
//
// Thin consumer of `HomePageView` (S3 #2502) and `prepareHomeData` (#2519):
// this file's only job is `paths()` (a locale-routing concern) — mirroring
// the package route's shape (`packages/zudo-doc/src/routes/locale-index.tsx`).
// The locale-specific data prep — `resolveNavSource` with the locale-home
// filter options, `loadCategoryMeta`, and the locale-config guard — now lives
// in `prepareHomeData`. No `extras` here — the showcase's `@Takazudo` brand
// link (#1453) is project-specific and is not part of the generated
// project's hero.

import { settings } from "@/config/settings";
import { routeContext } from "../lib/_route-context";
import { prepareHomeData } from "@takazudo/zudo-doc/home-page";
import type { JSX } from "preact";
import { HomePageView } from "../lib/_chrome";

export const frontmatter = { title: "Home" };

// ---------------------------------------------------------------------------
// paths() — synchronous (ADR-004)
// ---------------------------------------------------------------------------

/** Emit one route per non-default locale. */
export function paths(): Array<{
  params: { locale: string };
  props: { locale: string };
}> {
  return Object.keys(settings.locales).map((locale) => ({
    params: { locale },
    props: { locale },
  }));
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface PageArgs {
  params: { locale: string };
  props: { locale: string };
}

export default function LocaleIndexPage({ params }: PageArgs): JSX.Element {
  const locale = params.locale;

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
