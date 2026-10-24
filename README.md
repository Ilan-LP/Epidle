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
pnpm cli   # terminal client from source, needs the server running
```

The web client proxies `/api` to the server, so open http://localhost:5173. Logging in needs the Entra settings below; without them the login page shows but the Microsoft redirect fails.

Run a single app:

```sh
pnpm --filter @epidle/server dev     # server with reload on change
pnpm --filter @epidle/web dev        # web client only
pnpm --filter @epidle/web build      # production build in apps/web/dist
pnpm cli --server http://localhost:3000     # CLI flags pass through
pnpm --filter epidle build           # bundles the CLI into apps/cli/dist/epidle.js
pnpm --filter @epidle/server build   # bundles the server into apps/server/dist (used by Docker)
pnpm admin help                      # admin commands, see the runbook
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
| `MODIFIERS_PATH` | server | `apps/server/modifiers.json`, the weekly modifiers |
| `BACKUP_DIR` | server | `backups/` next to the database. Empty string: no automatic backups |
| `BACKUP_INTERVAL_HOURS` | server | `6`, plus one backup at every start |
| `BACKUP_KEEP` | server | `28` (7 days at the default interval), older backups are deleted |
| `EPIDLE_SERVER_URL` | cli | `http://localhost:3000`, overridden by `--server`. https only, except localhost |
| `EPIDLE_CONFIG` | cli | `~/.config/epidle/config.json` (`%APPDATA%\epidle` on Windows): session tokens and language |

Server variables can go in `apps/server/.env` (loaded if present, see `apps/server/.env.example`). They are checked at start and a wrong value stops the server with a message: `PORT` and `BACKUP_KEEP` are integers, `PUBLIC_URL` is an origin in https (http only for localhost). With `NODE_ENV=production` (set in the Docker image) the server also refuses to start without the Entra ids or with an http `PUBLIC_URL`.

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
| `GET /state` | player | Company caught up to server time, season with its weekly modifiers, rates |
| `POST /intent` | player | `{ type, requestId, ... }`: `hire`, `train`, `buyRoom`, `buyMouli`, `upgradeMouli`, `setStrictness`. `count` (1-100) on repeatable ones. 422 when the game refuses, 409 on a reused `requestId` |
| `GET /leaderboard?scope=season\|alltime` | player | Top 50 and my rank |
| `GET /players/:pseudo/build` | player | Public build: team by kind and level, rooms, mouli stages and strictness. No money |
| `GET /feed` | player | This week: its modifier, events (tiers from PME, first dev from Lead, new leader, top 10 entries), top 5 climbers, players who joined |

Seasons roll over on the first request after the end and in a job that runs every minute.

Rate limits, per player when logged in, per IP otherwise: 300 requests/min overall, 30 intents per 10 s, 60/min on `/state` and builds, 30/min on the leaderboard and the feed, 120 auth requests/min per IP. A banned account gets 403 `banned` at login.

### Weekly modifiers

A season is two weeks; each week can change a few balance numbers for everyone, like "Semaine Rush" (devs 50 % faster, 40 % more bugs). They are defined in [`apps/server/modifiers.json`](apps/server/modifiers.json): a catalogue of modifiers (id, French name and description, effects) and a rotation. Week k of the server (season 1 week 1 is k = 0) gets `rotation[k % length]`, `null` is a normal week.

- **Effects** are multipliers between 0.25 and 4: `devSpeed`, `salary`, `trainingTime`, `trainingCost`, `hireCost`, `roomCost`, `mouliCost`, `mouliSpeed`, `bugs`, `value` (see `Effects` in `packages/core/src/modifiers.ts`). The server refuses to start on an invalid file.
- **A season copies its weeks when it opens.** Editing the file (then restarting) only changes the next seasons, never the rules of a season in progress. `pnpm admin weeks` shows the current and next season.
- **Everything goes through the core:** `advanceSeason` integrates each week with its own balance; rates, prices and intents use the balance of the current week, on the server and in the clients' projection.
- **Announced** under the status bar of both clients: name, exact effects (generated from the numbers, not the description), time left, next week. The full description is in the weekly feed.
- `pnpm test` checks that every shipped modifier keeps every dev profitable (no debt spiral). To measure one, the sim takes weeks: `simulate(interval, BALANCE, [modifier, null])` in `packages/sim`. With the shipped catalogue, no modifier moved the casual/hardcore ratio outside 45-56 % or sent money below 0.

### Weekly feed and build snapshot

- **Feed** (`GET /api/feed`, next to the leaderboard in both clients): what changed since the week started. Events are written when a company is saved (tiers from PME, first dev at Lead or above; "first of the season" is computed at read time) and when scores are refreshed (new leader, entries in the top 10, with a cooldown so two players swapping places don't flood it). Climbers: score gained since the week started, exact even for absent players (their last save before the boundary is advanced to it).
- **Copy my build** (`y` on the dashboard, or the button): a text snapshot in a Discord code block, then the link to the public build. Rank, tier, score, rates, team by level, rooms and moulis, never the money. The web uses the clipboard; the CLI sends it with OSC 52 (most modern terminals) and shows it on screen to copy by hand otherwise.

### Anti-scripting

The server is authoritative: a script can only send the intents a player could send, so the risk is a bot that plays perfectly, 24 hours a day. Rate limits bound it; nothing else is blocked automatically, since a false positive would ban a student for playing a lot. What looks scripted is logged (`suspicious` table and the server log) for a human to review with `pnpm admin suspicious`:

- rate limit hits, intents the schema refuses and replayed `requestId`s (the official clients never cause any of them),
- every hour, from the intents of the last 24 h: more than 1000 intents in an hour, intents in 20 different hours out of 24, intents at a near-constant interval (timer).

### Web client

Terminal look, French UI, works from 360 px wide. Screens: login, pseudo, dashboard (company, team, training rooms, mouli pipeline with flow vs capacity), shop, leaderboard, a player's build next to yours (`#/joueur/<pseudo>`, shareable), help.

- **Live updates:** `GET /state` on load, every 15 s while the tab is visible, when it becomes visible again, and at the end of the season. In between, the last server response is advanced locally with `advanceSeason()` from `@epidle/core` (the balance of each week), 4 times per second. Every intent response replaces it.
- **Nothing is computed for the server:** the client sends intents only. It runs the same core rules locally to show prices (x10 included), "affordable in", and to explain a refused action without sending it.
- **Shortcuts:** `t` dashboard, `b` shop, `c` leaderboard, `?` help, `l` next language, `y` copy my build, `e` hire a junior, `f` start the chosen training, `1-4` stage strictness, shop `1-8` buy and `Shift+5-8` upgrade, `x` quantity, `v` leaderboard scope, `Esc` back. Digits use the physical key, so they work on AZERTY.
- **Language** (C, C++, Haskell, Python, TypeScript, Rust) only changes the scrolling code, its colors and the prompt. Saved in `localStorage`.

### Terminal client

```sh
npx epidle                      # once published on npm
npx epidle --server https://…   # another server
npx epidle --logout             # revoke and forget the session
```

Same screens and rules as the web client, in Ink, fully keyboard driven. Shares `@epidle/api-client` (API calls, projection, shop quotes, formatting, languages, and the polling hooks) with the web client.

- **Login:** device code flow. The CLI shows a Microsoft URL and a code (`o` opens the browser), and polls the server until the player has logged in. The session token is saved per server in `EPIDLE_CONFIG`, readable by its owner only (0600).
- **Shortcuts:** same as the web (`t b c ? l`, `y e f 1-4`, shop `1-8 x`, `v`, `Esc`), plus `q` quit, arrows to pick the dev and the target level of a training, `↑↓ Enter` to buy any shop line or open a player's build, `Tab` to switch between company and pipeline on terminals under 110 columns, `PgUp/PgDn` to scroll small terminals. The AZERTY digit row works without Shift.
- **Publishing:** set `DEFAULT_SERVER_URL` in `apps/cli/src/args.ts` to the production URL, then `npm publish` from `apps/cli` (`prepack` builds the bundle). Only `dist/epidle.js` ships: the workspace packages are bundled in, `ink`, `react` and `chalk` are regular dependencies.

## Theming

Both clients use the Epitech colors from one file: `packages/ui-theme/src/tokens.ts`. Official values come from the epitech.eu palette (blue `#013AFB`, black `#181818`, white `#F2F4F8`, accents `#00FF97` `#FF5A3A` `#FF1EF7`); the others are derived and marked as such.

| Token | Use |
|---|---|
| `background`, `surface` | page and panels |
| `border` | panel borders and separators |
| `text`, `muted` | main and secondary text |
| `brand` | the exact Epitech blue, only as a fill behind `text` (active buttons) |
| `primary` | the Epitech blue lightened for text: headings, links, active items |
| `accent` | shortcut keys, weekly modifier |
| `success`, `warning`, `danger` | money, bottlenecks, bugs (always next to a label or a number) |

- **Web:** `apps/web/vite.config.ts` injects the tokens as CSS variables (`--primary`...) into `index.html`, with `theme-color` and the favicon. `styles.css` only uses `var(--token)`: no color literal anywhere else.
- **Terminal:** `apps/cli/src/theme.ts` turns a token into an Ink color for what the terminal supports: the exact hex in truecolor, the nearest of 256 colors, then a hand-picked ANSI 16 name (`ansi16` in the token). `NO_COLOR` disables colors, `FORCE_COLOR=1|2|3` forces a level. The terminal background is never painted.
- **Language layer:** the cosmetic language only colors keywords and strings of the code snippets (`--code-keyword`, `--code-string` on the web, `Code` in the CLI), on top of the theme.
- **Changing a color:** edit `tokens.ts`, run `pnpm test`. `tokens.test.ts` checks WCAG AA (4.5:1 for every text token on `background` and `surface`, 3:1 for `border`, `text` on `brand`), and `languages.test.ts` checks the language colors on `surface`.
- **Logo:** the login screen shows a text wordmark and the official white Epitech logo (`apps/web/src/assets`, from epitech.eu, never redrawn or recolored).

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

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, the CLI and server bundles, and builds both Docker images on pushes to `main` and on pull requests.

## Deploy with Docker

`docker-compose.yml` runs two containers built from the `Dockerfile`:

- **server**: the bundled server (`dist/server.js`) on Node 22 slim, as the `node` user. Volumes `data` (the SQLite database) and `backups`. Not published, only Caddy reaches it.
- **web**: Caddy with the built web client. It gets and renews the HTTPS certificate for `EPIDLE_SITE`, serves the static files and proxies `/api` to the server (which trusts its `X-Forwarded-For` for per-IP limits).

```sh
cp .env.example .env        # EPIDLE_SITE, ENTRA_TENANT_ID, ENTRA_CLIENT_ID (+ secret if "Web" platform)
docker compose up -d --build
```

Needs a DNS record for `EPIDLE_SITE` pointing to the machine and ports 80 and 443 open. The Entra redirect URI is then `https://<EPIDLE_SITE>/api/auth/callback`. For the CLI, set `DEFAULT_SERVER_URL` to `https://<EPIDLE_SITE>` before publishing.

## Runbook

Commands run from the repository folder on the server machine. Below, `admin` stands for `docker compose exec server node dist/admin.js` (without Docker: `pnpm admin`, which reads `apps/server/.env`).

| Task | How |
|---|---|
| Status, logs | `docker compose ps` (the server shows `healthy`), `docker compose logs -f server` (JSON; grep `suspicious activity` and `database backup written`) |
| Update | `git pull && docker compose up -d --build`. Migrations run on start. A database newer than the code refuses to open: never roll the code back past a migration without restoring a backup |
| Change the weekly modifiers | Edit `apps/server/modifiers.json`, `docker compose restart server`, check `admin weeks`. Applies from the next season. A bad file stops the server at start: read the log, fix, restart |
| Find a player | `admin players [text]`: pseudo, season score, number of suspicious events |
| Review scripting | `admin suspicious [--hours 72]`: grouped by player and kind, with the last detail |
| Remove a player | `admin remove <pseudo>` shows what would go; with `--yes` it deletes the player, their companies, sessions and feed events, at once. They can log in again as a new player |
| Ban a player | `admin remove <pseudo> --ban --reason "<why>" --yes`: same, and their Microsoft account is refused at login. `admin bans`, `admin unban <id>` |
| Backups | Automatic every 6 h and at start, in the `backups` volume, last 28 kept. Manual: `admin backup`. Copy them off the machine regularly: `docker compose cp server:/backups ./backups` |
| Restore | `docker compose stop server`, then `docker compose run --rm --no-deps --entrypoint sh server -c 'cp /backups/<file> /data/epidle.db && rm -f /data/epidle.db-wal /data/epidle.db-shm'`, then `docker compose start server`. Everything after that backup is lost |
| Login broken | Check `ENTRA_*` in `.env` and the redirect URI in Entra, then `docker compose up -d` to apply `.env` changes |

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
| chalk | cli | Ink's own color library, imported to read and set the color level it renders with (NO_COLOR, 16-color fallback). Same version as Ink's, so no extra code. |
| react | cli | Peer dependency of Ink. |
| @types/react | cli dev | React types for the Ink components. |
| esbuild | cli dev, server dev | Bundles the CLI for npm and the server for Docker, with the workspace TS packages. Already installed by Vite and tsx. |
| react, @types/react | api-client peer, dev | The shared hooks run in both React renderers (react-dom and Ink). |

## Layout

```
packages/core        @epidle/core        pure, deterministic game logic shared by everyone
packages/sim         @epidle/sim         headless balance simulation with greedy bots
packages/api-client  @epidle/api-client  what both clients share: API calls, projection, shop quotes, formatting, languages, hooks (./react)
packages/ui-theme    @epidle/ui-theme    Epitech color tokens and the WCAG contrast check, for the web and the terminal
apps/server          @epidle/server      Fastify + SQLite, authoritative game server
apps/web             @epidle/web         React + Vite client
apps/cli             epidle              Ink terminal client, published to npm as `epidle`
deploy/Caddyfile                         HTTPS, static web client, /api proxy (Docker image "web")
Dockerfile                               images "server" and "web", run by docker-compose.yml
```

`packages/core` must stay pure: no IO, no clock, no timers. Tooling enforces it: no Node types in its tsconfig, and Biome rejects `Date`, `process`, `fetch`, `setTimeout`, `console`... in that folder.

No package is compiled for development: server and CLI run through `tsx`, the web client through Vite, and the workspace packages are imported as TypeScript source. The only builds are the web bundle, the CLI bundle for npm and the server bundle for Docker.
