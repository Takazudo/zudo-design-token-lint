# AGENTS.md

Repository instructions for coding agents (Codex, local or Cloud). The project overview, layout,
commands and API-shape rules are in [`CLAUDE.md`](./CLAUDE.md). They apply to every agent.

- Package manager: pnpm (`corepack enable && pnpm install --frozen-lockfile`). Checks:
  `pnpm test`, `pnpm lint`, `bash scripts/check-pack.sh`.
- Releases: follow [`RELEASING.md`](./RELEASING.md) only. The repository skill
  `.agents/skills/make-release/` is its entry point. npm publishing is OIDC-only in
  `.github/workflows/publish.yml`. Never add npm tokens.
- Documentation edits: read `doc/src/content/CLAUDE.md` (bilingual EN/JA rule).
