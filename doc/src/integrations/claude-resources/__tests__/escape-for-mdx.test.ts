import { describe, it, expect } from "vitest";
import { escapeForMdx } from "../escape-for-mdx";

describe("escapeForMdx", () => {
  // ---------------------------------------------------------------------------
  // Path-like angle bracket sequences (not self-closing JSX)
  // ---------------------------------------------------------------------------

  it("escapes path-like <name>/suffix sequences", () => {
    expect(escapeForMdx("<foo>/bar")).toBe("&lt;foo&gt;/bar");
  });

  it("escapes path-like angle brackets in prose", () => {
    expect(escapeForMdx("binary at <repo>/target/release/zfb")).toBe(
      "binary at &lt;repo&gt;/target/release/zfb",
    );
  });

  // ---------------------------------------------------------------------------
  // Allowlisted HTML tags must pass through unchanged
  // ---------------------------------------------------------------------------

  it("preserves allowlisted HTML tags followed by a path separator", () => {
    expect(escapeForMdx("<div>/path")).toBe("<div>/path");
  });

  // ---------------------------------------------------------------------------
  // Self-closing non-allowlisted tags must still be escaped
  // ---------------------------------------------------------------------------

  it("escapes self-closing non-allowlisted component tags", () => {
    expect(escapeForMdx("<Component />")).toMatch(/&lt;Component\s*\/&gt;/);
  });

  it("escapes the compact self-closing form <Foo/> (no space before slash)", () => {
    // Regression: the opening-tag regex only matches the spaced form <Foo />,
    // so the compact <Foo/> needs the dedicated self-closing branch.
    const out = escapeForMdx("<Foo/>");
    expect(out).toBe("&lt;Foo/&gt;");
    expect(out).not.toContain("<Foo/>");
  });
});
