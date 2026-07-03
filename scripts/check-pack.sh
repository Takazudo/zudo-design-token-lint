#!/usr/bin/env bash
set -euo pipefail

# check-pack.sh — verify the actual npm ARTIFACT, not just the source tree.
#
# `pnpm test`/`pnpm build` prove the source compiles and behaves correctly,
# but they never exercise `package.json`'s `files`/`bin`/`exports` — a wrong
# entry there (e.g. dist/ omitted from `files`, a stale `bin` path) only
# breaks for a real `npm install` of the published tarball. This script packs
# the current tree, installs the tarball into a scratch project exactly like
# a consumer would, and asserts:
#
#   1. `npx design-token-lint --version` exits 0 and matches package.json's version.
#   2. Linting a one-file violation fixture exits 1 and reports the violation.
#   3. The ESM exports map resolves and exposes `lintContent` as a function.
#
# Run locally from anywhere: `bash scripts/check-pack.sh` (paths below are
# resolved relative to this script's own location, not the caller's cwd).
# Wired into: ci.yml (PRs — cheap, catches files[]/bin regressions early) and
# publish.yml (before both `pnpm publish` invocations — the real release gate).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PKG_NAME=$(node -p "require('./package.json').name")
PKG_VERSION=$(node -p "require('./package.json').version")

WORK_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "==> Building package"
pnpm run build

echo "==> Packing tarball ($PKG_NAME@$PKG_VERSION)"
PACK_JSON=$(pnpm pack --pack-destination "$WORK_DIR" --json 2>/dev/null)
TARBALL=$(node -e "console.log(JSON.parse(process.argv[1]).filename)" "$PACK_JSON")

if [ ! -f "$TARBALL" ]; then
  echo "::error::pnpm pack did not produce a tarball at $TARBALL"
  exit 1
fi
echo "Tarball: $TARBALL"

INSTALL_DIR="$WORK_DIR/install-test"
mkdir -p "$INSTALL_DIR"

echo "==> Installing tarball into a scratch project"
(
  cd "$INSTALL_DIR"
  npm init -y >/dev/null
  npm i "$TARBALL" >/dev/null
)

echo "==> Checking: npx design-token-lint --version"
INSTALLED_VERSION=$(cd "$INSTALL_DIR" && npx --no-install design-token-lint --version)
if [ "$INSTALLED_VERSION" != "$PKG_VERSION" ]; then
  echo "::error::version mismatch: package.json has $PKG_VERSION, installed CLI printed $INSTALLED_VERSION"
  exit 1
fi
echo "OK: --version prints $INSTALLED_VERSION"

echo "==> Checking: violation fixture exits 1"
mkdir -p "$INSTALL_DIR/src"
cat >"$INSTALL_DIR/src/Violation.tsx" <<'EOF'
export function Violation() {
  return <div className="p-4 bg-gray-500">bad</div>;
}
EOF

set +e
VIOLATION_OUTPUT=$(cd "$INSTALL_DIR" && npx --no-install design-token-lint 2>&1)
VIOLATION_EXIT=$?
set -e

if [ "$VIOLATION_EXIT" -ne 1 ]; then
  echo "::error::expected exit code 1 for the violation fixture, got $VIOLATION_EXIT"
  echo "$VIOLATION_OUTPUT"
  exit 1
fi
if ! echo "$VIOLATION_OUTPUT" | grep -q "p-4"; then
  echo "::error::violation output did not mention the offending class (p-4)"
  echo "$VIOLATION_OUTPUT"
  exit 1
fi
echo "OK: violation fixture exits 1 and reports p-4"

echo "==> Checking: exports map resolves (lintContent)"
(
  cd "$INSTALL_DIR"
  node -e "
    const pkgName = process.argv[1];
    import(pkgName).then((m) => {
      if (typeof m.lintContent !== 'function') {
        console.error('::error::lintContent export missing or not a function');
        process.exit(1);
      }
    }).catch((err) => {
      console.error('::error::failed to import', pkgName, err);
      process.exit(1);
    });
  " "$PKG_NAME"
)
echo "OK: exports map resolves, lintContent is exported"

echo ""
echo "check-pack: all checks passed for $PKG_NAME@$PKG_VERSION"
