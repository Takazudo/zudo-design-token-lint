/**
 * Seed data for the live lint Playground (src/components/playground.tsx).
 *
 * Deliberately a plain `.ts` module, not `.tsx`: `DEFAULT_CODE` below is a
 * sample snippet that intentionally CONTAINS design-token-lint violations
 * (p-4, bg-gray-200, ...) so the playground demo has something to flag on
 * first load. The repo's own dogfood lint (.design-token-lint.json patterns)
 * only scans `.tsx`/`.jsx`/`.astro` files, so keeping this string out of a
 * `.tsx` file avoids the linter matching class-shaped text inside a JS string
 * as if it were real applied markup.
 */

export const DEFAULT_CODE = `<div className="p-4 bg-gray-200">
  <h1 className="text-xl mb-vsp-md">Title</h1>
  <p className="mt-2 text-gray-600">
    Some content here
  </p>
</div>`;

export const DEFAULT_CONFIG = JSON.stringify(
  {
    prohibited: [
      "p-{n}",
      "py-{n}",
      "px-{n}",
      "pt-{n}",
      "pb-{n}",
      "pl-{n}",
      "pr-{n}",
      "m-{n}",
      "my-{n}",
      "mx-{n}",
      "mt-{n}",
      "mb-{n}",
      "ml-{n}",
      "mr-{n}",
      "gap-{n}",
      "gap-x-{n}",
      "gap-y-{n}",
      "bg-{color}-{shade}",
      "text-{color}-{shade}",
      "border-{color}-{shade}",
    ],
    allowed: ["p-0", "m-0", "gap-0"],
  },
  null,
  2,
);
