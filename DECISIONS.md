# Decisions

Non-obvious technical choices, newest at the bottom. One entry per decision: what, why, trade-off.

## 2026-10-22 Monorepo scaffold

- **pnpm workspaces, no build step.** `@epidle/core` exports `src/index.ts` directly. Server and CLI run with `tsx`, web with Vite, `tsc` only type-checks (`noEmit`). No "forgot to rebuild core" bugs. Trade-off: production server also runs through `tsx`; add a bundle step if startup time or deploy ever needs it.
- **Biome instead of ESLint + Prettier.** One dependency, one config, lint and format, fast. Markdown and the lockfile are excluded from formatting. Trade-off: fewer plugins than ESLint, nothing we need is missing.
- **Core purity enforced by tooling.** `packages/core/tsconfig.json` has `"types": []` (no Node globals). A Biome override bans `Date`, `performance`, `setTimeout`, `setInterval`, `fetch`, `process`, `console` in `packages/core/**`. Not covered: `Math.random`. Plan: a seeded RNG passed in when game logic needs randomness.
- **better-sqlite3 rather than `node:sqlite`.** `node:sqlite` is still experimental on Node 22. better-sqlite3 is synchronous (simple code, fast for a single-process server) and ships prebuilt binaries. pnpm 10 blocks install scripts, so it is allow-listed in `pnpm-workspace.yaml`. DB opened in WAL mode with foreign keys on.
- **`@types/node` pinned to 22** to match the runtime in `.nvmrc`, so we can't use APIs that don't exist at runtime.
- **API under `/api`**, Vite proxies it in dev: no CORS config needed for the web client.
- **One root Vitest config** with `projects`, so `pnpm test` covers every package. Web and CLI have no tests yet; adding jsdom or ink-testing-library is deferred until there is UI logic worth testing.
- **No dotenv.** Config comes from env vars; Node 22 `--env-file` covers local `.env` if needed.
- **Server binds to `127.0.0.1` by default.** Set `HOST=0.0.0.0` behind a reverse proxy or in a container.
- **TypeScript 7** (native compiler) was the latest at scaffold time. Options used are the standard strict set, nothing TS 7 specific.
