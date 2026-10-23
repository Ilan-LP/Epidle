# Epidle

Idle management game about running a dev company, for Epitech Lyon students. See [CLAUDE.md](CLAUDE.md) for the product and game design, [DECISIONS.md](DECISIONS.md) for technical choices.

## Requirements

- Node.js 22 (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the version pinned in `package.json`)

## Setup

```sh
pnpm install
```

## Run

```sh
pnpm dev   # server on http://localhost:3000 + web client on http://localhost:5173
pnpm cli   # terminal client, needs the server running
```

The web client proxies `/api` to the server, so open http://localhost:5173. Logging in needs the Entra settings below; without them the login page shows but the Microsoft redirect fails.

Run a single app:

```sh
pnpm --filter @epidle/server dev     # server with reload on change
pnpm --filter @epidle/web dev        # web client only
pnpm --filter @epidle/web build      # production build in apps/web/dist
```

### Configuration (environment variables)

| Variable | App | Default |
|---|---|---|
| `PORT` | server | `3000` |
| `HOST` | server | `127.0.0.1` |
| `DATABASE_PATH` | server | `apps/server/data/epidle.db` (created and migrated on start) |
| `PUBLIC_URL` | server | `http://localhost:5173`, the origin players open; the login callback is `${PUBLIC_URL}/api/auth/callback` |
| `ENTRA_TENANT_ID` | server | none, Epitech directory (tenant) id. Login is disabled until set |
| `ENTRA_CLIENT_ID` | server | none, application (client) id of the Epidle app registration |
| `ENTRA_CLIENT_SECRET` | server | none, only if the redirect URI is registered on the "Web" platform |
| `TRUST_PROXY` | server | unset, `1` behind a reverse proxy so rate limits see real IPs |
| `EPIDLE_SERVER_URL` | cli | `http://localhost:3000` |

Server variables can go in `apps/server/.env` (loaded if present, see `apps/server/.env.example`).

### Microsoft login (Entra ID)

The server does the whole OIDC exchange: the web client gets an httpOnly session cookie, the CLI a bearer token. Microsoft tokens never reach the clients.

App registration (Entra admin center > App registrations):

1. Supported account types: this organizational directory only if registered in the Epitech tenant. A multi-tenant app registered elsewhere also works: the server only accepts tokens issued by `ENTRA_TENANT_ID`.
2. Redirect URI: `${PUBLIC_URL}/api/auth/callback`, e.g. `http://localhost:5173/api/auth/callback` in dev.
   - On the "Web" platform: create a client secret and set `ENTRA_CLIENT_SECRET`.
   - On the "Mobile and desktop applications" platform: no secret.
3. Authentication > Allow public client flows: **Yes** (needed by the device code flow of the CLI).
4. API permissions: `openid` and `profile` only. We keep the `oid` claim, nothing else.

### API

All routes are under `/api`, JSON in and out, errors are `{ error, message }` with a French `message`.

| Route | Auth | What |
|---|---|---|
| `GET /auth/login`, `GET /auth/callback` | none | Web login, authorization code + PKCE |
| `POST /auth/device`, `POST /auth/device/token` | none | CLI login, device code; poll `token` with the returned `handle` until `status: "ok"` |
| `POST /auth/logout` | session | Revokes the session |
| `GET /me`, `PUT /me/pseudo` | session | Pseudo, 3-16 chars `[A-Za-z0-9_-]`, unique ignoring case, required to play |
| `GET /state` | player | Company caught up to server time, season, rates |
| `POST /intent` | player | `{ type, requestId, ... }`: `hire`, `train`, `buyRoom`, `buyMouli`, `upgradeMouli`, `setStrictness`. `count` (1-100) on repeatable ones. 422 when the game refuses, 409 on a reused `requestId` |
| `GET /leaderboard?scope=season\|alltime` | player | Top 50 and my rank |
| `GET /players/:pseudo/build` | player | Public build: team by kind and level, rooms, mouli stages and strictness. No money |

Seasons roll over on the first request after the end and in a job that runs every minute.

### Web client

Terminal look, French UI, works from 360 px wide. Screens: login, pseudo, dashboard (company, team, training rooms, mouli pipeline with flow vs capacity), shop, leaderboard, a player's build next to yours (`#/joueur/<pseudo>`, shareable), help.

- **Live updates:** `GET /state` on load, every 15 s while the tab is visible, when it becomes visible again, and at the end of the season. In between, the last server response is advanced locally with `advance()` from `@epidle/core`, 4 times per second. Every intent response replaces it.
- **Nothing is computed for the server:** the client sends intents only. It runs the same core rules locally to show prices (x10 included), "affordable in", and to explain a refused action without sending it.
- **Shortcuts:** `t` dashboard, `b` shop, `c` leaderboard, `?` help, `l` next language, `e` hire a junior, `f` start the chosen training, `1-4` stage strictness, shop `1-8` buy and `Shift+5-8` upgrade, `x` quantity, `v` leaderboard scope, `Esc` back. Digits use the physical key, so they work on AZERTY.
- **Language** (C, C++, Haskell, Python, TypeScript, Rust) only changes the scrolling code, the colors and the prompt. Saved in `localStorage`.

## Balance simulation

```sh
pnpm sim                                   # 3 greedy bots play a full season, prints tables
pnpm sim '{"rooms":{"costGrowth":2}}'      # same with a config variant, no file edit
```

Every balance number lives in `packages/core/src/config.ts`. The bots (`packages/sim`) buy the action with the best payback and visit every 2 min, 30 min and 8 h. `packages/sim/src/balance.test.ts` runs the same season in `pnpm test` and fails if a config change breaks a tuning target (saturation, casual/hardcore ratio, tier pacing, no debt, no overflow).

## Checks

```sh
pnpm lint        # Biome lint + format check
pnpm format      # Biome format, writes files
pnpm typecheck   # tsc on every package
pnpm test        # Vitest on every package
pnpm anticheat   # only the server anti-cheat suite (replays, forged values, unaffordable buys, spam)
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests on pushes to `main` and on pull requests.

## Dependencies

Every dependency needs a one-line justification. Add a row here when you add one.

| Package | Where | Why |
|---|---|---|
| typescript | root dev | Type checker for every package. |
| @types/node | root dev | Node types, pinned to 22 to match the runtime, kept out of core. |
| @biomejs/biome | root dev | Linter and formatter in one tool. |
| vitest | root dev | Test runner, native TS and ESM. |
| tsx | root dev | Runs TS directly in Node for the server and CLI, with watch mode. |
| fastify | server | HTTP framework, good TS types, `inject` lets tests run without opening a port. |
| better-sqlite3 | server | Embedded SQLite with a stable synchronous API. |
| @types/better-sqlite3 | server dev | Types for better-sqlite3. |
| jose | server | Verifies Microsoft id_token signatures against the rotating tenant JWKS, zero dependencies. |
| @fastify/cookie | server | Reads and sets the httpOnly session cookie of the web client, official Fastify plugin. |
| @fastify/rate-limit | server | Per-player and per-IP rate limits with standard headers, official Fastify plugin. |
| react, react-dom | web | UI library. |
| vite | web dev | Dev server and bundler. |
| @vitejs/plugin-react | web dev | JSX transform and Fast Refresh. |
| @types/react, @types/react-dom | web dev | React types. |
| ink | cli | React renderer for the terminal. |
| react | cli | Peer dependency of Ink. |
| @types/react | cli dev | React types for the Ink components. |

## Layout

```
packages/core   @epidle/core    pure, deterministic game logic shared by everyone
packages/sim    @epidle/sim     headless balance simulation with greedy bots
apps/server     @epidle/server  Fastify + SQLite, authoritative game server
apps/web        @epidle/web     React + Vite client
apps/cli        @epidle/cli     Ink terminal client
```

`packages/core` must stay pure: no IO, no clock, no timers. Tooling enforces it: no Node types in its tsconfig, and Biome rejects `Date`, `process`, `fetch`, `setTimeout`, `console`... in that folder.

No package is compiled: server and CLI run through `tsx`, the web client through Vite, and `@epidle/core` is imported as TypeScript source.
