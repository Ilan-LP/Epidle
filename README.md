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

The web client proxies `/api` to the server, so open http://localhost:5173 and it should show "Serveur : en ligne".

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
| `DATABASE_PATH` | server | `apps/server/data/epidle.db` (created on first start) |
| `EPIDLE_SERVER_URL` | cli | `http://localhost:3000` |

## Checks

```sh
pnpm lint        # Biome lint + format check
pnpm format      # Biome format, writes files
pnpm typecheck   # tsc on every package
pnpm test        # Vitest on every package
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
apps/server     @epidle/server  Fastify + SQLite, authoritative game server
apps/web        @epidle/web     React + Vite client
apps/cli        @epidle/cli     Ink terminal client
```

`packages/core` must stay pure: no IO, no clock, no timers. Tooling enforces it: no Node types in its tsconfig, and Biome rejects `Date`, `process`, `fetch`, `setTimeout`, `console`... in that folder.

No package is compiled: server and CLI run through `tsx`, the web client through Vite, and `@epidle/core` is imported as TypeScript source.
