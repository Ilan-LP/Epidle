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

## 2026-10-22 Game core and balance

- **Flow model, not a tick loop.** `computeRates(state)` gives constant rates (LoC/s, EUR/s, bugs/s) between two events; `advance(state, seconds)` integrates them exactly, segment by segment, the only events being level-ups. Result: `advance(s, a + b)` equals `advance(advance(s, a), b)`, the server can catch up hours of absence in one call, and there is no tick-size drift between server and clients.
- **Pipeline.** LoC go through the stages in order. A stage processes at most `instances x throughput x speed(strictness)`; the overflow ships right away at the value of the last stage it passed, with its bugs. Quality = 1 - bug density, revenue = LoC x value x quality. A stage with no instance ends the pipeline.
- **No debt spiral by construction.** Production never depends on money, and every dev, at every level, earns more shipping raw buggy code than their salary (asserted in `config.test.ts`). Intents refuse to spend money the player doesn't have. Money can still dip below zero if a player sends most devs to training at once (still paid, writing nothing) or buys moulis with nothing to check, but income stays positive as soon as they work again. No bot ever went below 7 EUR.
- **Tiers unlock on cumulative revenue** (the season score), with the exact unlock time recorded in the state for badges and stats.
- **Mechanics added on top of CLAUDE.md** (each one came out of the simulation, see the PR for the numbers):
  - `train(dev, targetLevel)` queues several levels, paid upfront, the dev stays in the room. Without it an 8-minute Piscine leaves the room empty for 8 h for a casual player: the casual bot made 17% of the hardcore score, 65% with the queue.
  - Mouli versions (`upgradeMouli`): x2 throughput per version, x3 cost. Production is multiplied by up to 2048 by training; with instances alone the bots needed 8000+ instances per stage.
  - Training rooms are bought (`buyRoom`), x1.5 cost each, max 50.
- **Piscine is 8 min, not 10.** With 10 min and x2 per level, Légende takes 14.2 days of non-stop training, more than the season. With 8 min it is 11.4 days: reachable only by someone who keeps one dev in a room from day 0, which makes it a real achievement. No bot reaches it (max level 9).
- **What drives growth.** Training time and perf both double per level, so a busy room adds the same income per second whatever level it trains: growth is roughly rooms x time. Rooms are the engine, devs are what you put in them, moulis turn their code into money.
- **Known limit: money stops being the constraint around day 4 for active players.** A room's value is bounded (it can only train for the time left in the season) while money grows with the company, so after day 4 active bots can afford everything worth buying and only wait for trainings to end. Decisions remain (who to train, how far, strictness, pipeline), and nobody is maxed before day 12. Tried and rejected: a multiplicative "equipment" money sink. It keeps money useful until day 6-9, but scores blow up to 1e13-1e14, mouli instances to thousands, and the 30-min bot beats the 2-min one.
- **Bots are a measuring tool, not an AI opponent.** Greedy "best payback first", they price hires and training at the current average value per LoC (otherwise a full pipeline makes training look worthless), price a room by its reuse over the rest of the season, queue trainings until their next visit, and save for a better action if it becomes affordable before their next visit.
