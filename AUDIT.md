# Epidle audit

Date: 2026-10-23. Scope: the whole repository at `b526858` (security, functionality, configuration, ops).
Mode: read-only. Nothing in the repository was changed except this file. Every probe ran locally: in-memory app with the fake Microsoft provider from `test-utils.ts`, the built server on `127.0.0.1`, a fresh clone in a temp directory. No request was sent to Microsoft or any other external service (the only network use was `pnpm install` and `pnpm audit` against the npm registry).

Legend: **verified** = reproduced locally or proven by reading a short, closed code path. **unverified** = depends on something I could not run here (Entra tenant, Docker daemon, campus network), stated as such.

## Summary

The codebase is in good shape for a side project. No Critical or High finding. The core things are right and were verified: the server is authoritative, intents run in one synchronous SQLite transaction (no double spend under 25 parallel purchases), every query is parameterized, schema validation rejects extra fields, prototype pollution, non-integers and `1e400`, there is no dev backdoor or test login route, no secret in the git history, no secret in the web or CLI bundle, sessions are random 256-bit tokens stored hashed, OIDC uses state + nonce + PKCE with a login-CSRF cookie, ID tokens are verified (signature RS256, issuer, audience, expiry, `tid`, nonce).

What needs work before launch is operational robustness rather than security: one corrupted row takes the whole game down, the score refresh blocks the event loop at scale, login rate limits may lock out a campus behind one NAT, pseudos can be renamed without limit and are not moderated, and a new contributor cannot play locally without a real Entra tenant.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 8 |
| Low | 17 |

## Checks run

| Check | Result |
|---|---|
| `pnpm lint` (Biome) | pass, 138 files |
| `pnpm typecheck` (7 packages) | pass |
| `pnpm test` (Vitest) | 34 files, 227 tests, all pass |
| `pnpm sim` | balance targets hold, see section 5 |
| `pnpm audit` | no known vulnerabilities |
| `pnpm -r outdated` | only `@types/node` 22 vs 26, intentional (pinned to the Node 22 runtime) |
| Builds: server, web, CLI | pass. `grep` of the bundles for `secret`, `ENTRA`, `client_secret`: nothing |
| Fresh clone + `pnpm install` + `pnpm dev` (README steps) | works: web 200, `/api/health` through the Vite proxy 200 |
| Backup + restore | `admin backup` then copy to a new path, new server on it: the player and their session are back (verified) |
| Docker images, compose, Caddy | **unverified**: no Docker daemon in this environment, reviewed by reading only |
| Real Entra login (web and device code) | **unverified**: needs the tenant, covered by the provider unit tests with a local JWKS |
| Interactive CLI against a live server | partially verified: args, token store and screens are unit tested, the full TUI could not be driven without a TTY |

---

## 1. Configuration and secrets

### Config inventory

| Name | Read in | Required | Default | Safe default? |
|---|---|---|---|---|
| `PORT` | `apps/server/src/config.ts:59` | no | `3000` | yes, but not validated (see L1) |
| `HOST` | `config.ts:60` | no | `127.0.0.1` | yes (loopback) |
| `DATABASE_PATH` | `config.ts:55` | no | `apps/server/data/epidle.db` | yes, gitignored by `*.db` |
| `PUBLIC_URL` | `config.ts:62` | in prod | `http://localhost:5173` | dev only. Drives the redirect URI and the cookie `Secure` flag, not validated (see M7) |
| `ENTRA_TENANT_ID` | `config.ts:46` | for login | none | yes: GUID enforced, `common`/`organizations` rejected (verified) |
| `ENTRA_CLIENT_ID` | `config.ts:47` | for login | none | yes: GUID enforced |
| `ENTRA_CLIENT_SECRET` | `config.ts:53` | only for a "Web" redirect URI | none | yes, server only, never logged, never in a bundle |
| `TRUST_PROXY` | `config.ts:64` | behind a proxy | off | yes (off). Docker sets it to `1` (see L9) |
| `MODIFIERS_PATH` | `config.ts:65` | no | `apps/server/modifiers.json` | yes, validated at start, bad file = refuse to start |
| `BACKUP_DIR` | `config.ts:57` | no | `<db dir>/backups`, empty string disables | yes |
| `BACKUP_INTERVAL_HOURS` | `config.ts:69` | no | `6` | yes, must be > 0 |
| `BACKUP_KEEP` | `config.ts:70` | no | `28` | `0.2` rounds to 0 and then nothing is ever deleted (L1) |
| `NODE_ENV` | `Dockerfile:26` | no | unset | not read by the code |
| `EPIDLE_SITE` | `docker-compose.yml`, `deploy/Caddyfile` | in prod | `localhost` | yes (local cert) |
| `EPIDLE_SERVER_URL` | `apps/cli/src/args.ts` | no | `DEFAULT_SERVER_URL` | yes: https required except localhost (verified) |
| `EPIDLE_CONFIG`, `XDG_CONFIG_HOME`, `APPDATA` | `apps/cli/src/store.ts` | no | `~/.config/epidle/config.json` | yes, file written 0600 |
| `NO_COLOR`, color env | `apps/cli/src/theme.ts` | no | auto | cosmetic |

There is **no session secret and no admin token**, by design: sessions are random tokens stored as SHA-256 in SQLite (nothing to sign), and admin commands are a local CLI on the database file, there is no admin HTTP route. That removes two classic secrets entirely. Good call.

### .env.example

Both exist: `.env.example` (compose) and `apps/server/.env.example` (bare server). The compose one is complete. The server one is missing `MODIFIERS_PATH`, `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` (L2). Proposed `apps/server/.env.example`:

```sh
# Copy to apps/server/.env, the server loads it on start if present. Never commit .env.
PORT=3000
HOST=127.0.0.1
# Origin players open. https in production: it sets the Secure flag of the session cookie.
PUBLIC_URL=http://localhost:5173
# DATABASE_PATH=apps/server/data/epidle.db
# Ask for the real values, they are not in the repo.
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
# Only if the redirect URI is on the "Web" platform.
ENTRA_CLIENT_SECRET=
# 1 only behind a reverse proxy (Caddy), never when the port is reachable directly.
# TRUST_PROXY=1
# MODIFIERS_PATH=apps/server/modifiers.json
# Empty string disables automatic backups.
# BACKUP_DIR=apps/server/data/backups
# BACKUP_INTERVAL_HOURS=6
# BACKUP_KEEP=28
```

### .gitignore and history

- `.env`, `.env.*` (with `!.env.example`), `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm` are ignored. `.dockerignore` also excludes `.env*`, `*.db*`, `backups`, `apps/server/data`. Verified. (Cosmetic: `!.env.example` is listed twice.)
- Full history scan (`git log --all`, 49 commits): no `.env`, no `.db`, no key or cert file was ever committed. Content scan for secret assignments, Entra secret format (`...8Q~...`), AWS keys, GitHub tokens, PEM blocks: nothing. The only GUIDs are the test placeholders `11111111-1111-4111-...`. Verified.

### Startup validation

Partial. Entra ids and the modifiers file fail fast with a clear message (verified). `PORT`, `PUBLIC_URL`, `BACKUP_KEEP` are not validated, and missing Entra in production only logs a warning (M7, L1). No insecure fallback exists: no default secret, no auth bypass.

### Secrets reaching clients, logs, errors

- Browser bundle and CLI bundle: no secret, no env read in the web code (no `import.meta.env`). Verified.
- Error responses: the error handler maps everything to `{ error, message }` with a French message, stack traces only go to the server log (`app.ts:76`). Verified on bad JSON, 4xx and a thrown provider error.
- Logs: Fastify's default serializer does not log headers, so bearer tokens and cookies are not logged. The OAuth `code` is logged as part of the callback URL (L10).

---

## Findings

### Medium

#### M1. One corrupted `games.state` row takes the whole game down
- **Where:** `apps/server/src/games.ts:121` (`refreshScores`, `JSON.parse` per row), called from `apps/server/src/seasons.ts:45` (season close) and `:70` (maintenance), `apps/server/src/api.ts:93` (leaderboard, feed).
- **What:** states are parsed without any guard. One unreadable row throws inside the loop that refreshes every company.
- **Scenario (verified):** set one player's state to `{"time":`. Other players: `/api/state` 200, but `/api/leaderboard` 500, `/api/feed` 500, maintenance throws every minute. After the season end date, `currentSeason` calls `closeSeason` on every request and throws, so **`/api/state` returns 500 for everyone**: the game is down until someone edits the database by hand. A disk hiccup, a bad manual edit or a future migration bug is enough.
- **Fix:** in `refreshScores`, wrap each row: on parse failure, log `error` with user id, skip the row (or freeze it), and continue. Same guard in `loadGame` for that player only (answer 500 to them, not to everyone). Optionally validate the parsed shape (finite numbers, arrays) with a small `isGameState` in core. Regression test: corrupt one row, assert leaderboard 200 and season rollover still works.

#### M2. Score refresh blocks the event loop and grows linearly with players
- **Where:** `apps/server/src/games.ts:113-127`, triggered by `api.ts:93` (leaderboard and feed when scores are older than 30 s) and by maintenance every 60 s (`app.ts`, `seasons.ts:70`).
- **What:** every refresh parses, advances, re-serializes and rewrites every company of the season, synchronously.
- **Scenario (verified, local bench with mid-season states of 174 devs):** 1,000 players: 224 ms per refresh. 3,000 players: 1.4 s. Refreshes happen up to about 3 times a minute, so at 3,000 players the server is frozen several seconds per minute and every intent stalls. Lyon alone is fine, "open to any Epitech account" may not be.
- **Fix:** keep it simple: (1) refresh only rows whose score can still change materially, or (2) compute leaderboard scores without rewriting rows: store `revenue` and `revenuePerSecond` at last save plus next event time, and rank by `score + rate * (now - saved_at)` for rows with no event in between, or (3) at minimum, refresh only from the 60 s maintenance job and never from a request. Option 3 is a one-line change and halves the load. Add a bench test with N players and a time budget.

#### M3. Login rate limits are per IP and may lock out a campus behind one NAT
- **Where:** `apps/server/src/auth.ts:25` (`AUTH_RATE_LIMIT` 120/min) with the global key `ip:` for anonymous requests (`apps/server/src/app.ts:58`).
- **What:** a web login costs 2 requests (`/login`, `/callback`), so one public IP allows about 60 logins a minute. Anonymous `/api/me` before login also shares the 300/min IP bucket.
- **Scenario (unverified, depends on the campus network):** launch announcement on Discord, 150 students on the campus Wi-Fi click within 2 minutes. Many get a raw JSON 429 page on `/api/auth/login` (a browser navigation, so not even the styled error). First impression of the game is "broken". This also flags all of them as `rate_limited` in the suspicious table.
- **Fix:** raise the IP limit on `/api/auth/login` and `/callback` to something like 600/min, keep the Microsoft-calling `/api/auth/device` lower, and redirect to `/?login=error` instead of JSON on 429 for the two browser routes. Ask Epitech IT whether the campus egress is one IP.

#### M4. Pseudo rules: unlimited renames, reuse of freed pseudos, no moderation
- **Where:** `apps/server/src/api.ts:100-122` (`PUT /api/me/pseudo`), `PSEUDO_PATTERN` at `api.ts:12`.
- **What:** good: ASCII-only `[A-Za-z0-9_-]{3,16}`, unique case-insensitively (`COLLATE NOCASE`), so no XSS, no terminal escapes, no Unicode lookalikes (verified). Missing: renames are unlimited and instant, a released pseudo can be taken by anyone, there is no reserved or offensive list, ASCII lookalikes (`I`/`l`/`1`, `O`/`0`) are allowed.
- **Scenario (verified):** 50 renames in a row are all accepted. Player A renames from `Alice` to `Alice2`, player B immediately takes `alice` and inherits the shared build links (`#/joueur/alice`) and the feed history reads the pseudo at display time, so past "first to reach Licorne" events of A now show A's new name, while links people pasted on Discord point to B. A troll can also pick an insult and rotate it faster than an admin can remove it. For a game tied to real student accounts and promoted by the school, offensive names on the public leaderboard are a reputation risk.
- **Fix:** allow one rename per season (or a 24 h cooldown), keep released pseudos reserved for 14 days, add a small blocklist file (insults FR/EN, `admin`, `epitech`, staff names) checked on a normalized form (lowercase, `0->o`, `1->l`, `_`/`-` removed), and a `pnpm admin rename <pseudo> <new>` command. Regression tests for each rule.

#### M5. "Epitech accounts only" may include guest accounts of the tenant (unverified)
- **Where:** `apps/server/src/entra.ts` `verify()`, check at line 83 (`payload.tid !== tenantId`).
- **What:** issuer and `tid` pin the tenant, which is correct. But B2B guest users invited into the Epitech tenant (partners, companies, external speakers) receive tokens with the Epitech `tid` too.
- **Scenario (unverified, depends on the tenant):** an external guest of the Epitech directory logs in and plays. Low impact on the game, but it breaks a "decided" product rule.
- **Fix:** either set "Assignment required" on the enterprise app and assign the student groups (no code), or request the optional `acct` claim in the app manifest and reject `acct == 1` (guest). Test: a token with `acct: 1` is rejected.

#### M6. A new contributor cannot play locally without a real Entra tenant
- **Where:** `apps/server/src/index.ts:26`, README "Run" section.
- **What:** the README setup works (verified in a fresh clone), but every game route needs a session and the only way to get one is a real Microsoft login. There is no backdoor, which is correct, but there is also no safe dev path. Also the README says "the Microsoft redirect fails" while `/api/auth/login` actually returns a raw JSON 503.
- **Scenario (verified):** fresh clone, `pnpm dev`, open the site: login page, click, raw JSON `auth_unavailable`. The group member cannot test anything but the login page.
- **Fix:** add `pnpm admin dev-session <pseudo>` that creates (or reuses) a user and prints a session token. The CLI can use it through its config file; for the web, the developer sets the `epidle_session` cookie on localhost from the browser dev tools. It needs write access to the database file, so it gives nothing an attacker does not already have. No new HTTP route. Fix the README sentence.

#### M7. Production config is not validated: missing Entra or http `PUBLIC_URL` start silently
- **Where:** `apps/server/src/config.ts:59-64`, `apps/server/src/index.ts:26`, `auth.ts:99` (`secure = publicUrl.startsWith("https://")`).
- **What:** `PUBLIC_URL` is not checked (no scheme check, any string accepted, verified with `epidle.example.org` and `http://prod.example.org`). The `Secure` cookie flag silently follows it. Missing Entra ids only log a warning and the server serves a game nobody can log into.
- **Scenario:** a deploy without Docker (or a typo in compose) with `PUBLIC_URL=http://...`: session cookies are sent without `Secure`, and a network attacker on the campus Wi-Fi can read them on any plain http request. With a missing `ENTRA_CLIENT_ID`, the site is up and healthy but nobody can log in, health check is green.
- **Fix:** validate with `new URL()`, require `https:` unless the host is localhost, and when `NODE_ENV=production` (already set in the image) require Entra ids and https, fail fast with a clear message. Unit tests in `config.test`.

#### M8. Badges and titles (decided persistent progression) do not exist
- **Where:** product rule in `CLAUDE.md` ("Only badges and titles persist"), nothing in `apps/server` or the clients.
- **What:** seasons reset correctly and an all-time leaderboard exists, but there is no badge or title. After season 1 the only thing that carries over is the all-time sum.
- **Scenario:** at the end of season 1 (day 14), players have nothing to show for it, which is exactly when retention drops. The goal is 3 weeks of activity.
- **Fix:** small table `awards (user_id, season_id, kind, value)` written in `closeSeason` (top 1/3/10, first to each tier, Légende reached), shown next to the pseudo. Can ship after launch, must ship before day 14.

### Low

#### L1. `PORT` and `BACKUP_KEEP` are not validated
- `config.ts:59`: `PORT=abc` gives `NaN`, the server opens the DB, logs, then crashes with `ERR_SOCKET_BAD_PORT` (verified). `config.ts:70`: `BACKUP_KEEP=0.2` rounds to 0 and `slice(0, -0)` deletes nothing, backups grow forever. Fix: integer checks in `loadConfig`, before opening the DB.

#### L2. `apps/server/.env.example` is incomplete
- Missing `MODIFIERS_PATH`, `BACKUP_*`. Proposed file above.

#### L3. No Content-Security-Policy, no HSTS, no Permissions-Policy
- `deploy/Caddyfile:22-27` sets `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy`. No CSP: no XSS sink was found (React escaping, no `dangerouslySetInnerHTML`, ASCII pseudos), so it is defense in depth. No HSTS: the first plain http visit on a hostile Wi-Fi can be stripped (cookies are `Secure` behind Caddy, so the session itself is safe). Fix: `Strict-Transport-Security "max-age=31536000"`, `Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"` (`unsafe-inline` for the theme `<style>` injected by Vite, or use a hash), `Permissions-Policy "camera=(), microphone=(), geolocation=()"`. Unverified (no Caddy here).

#### L4. Microsoft or network errors during login answer 500
- `auth.ts:182` and `:232`: a network error or an `AuthError` from `startDeviceCode` / `pollDeviceCode` is not caught, the client gets `500 internal` (verified). `auth.ts:162`: a network error (not an `AuthError`) during code redemption shows raw JSON 500 in the browser. Fix: catch and answer `503 auth_unavailable` (device) or redirect to `/?login=error` (web).

#### L5. Device poll rate limit is keyed by the client-chosen handle
- `auth.ts:28-36`: 400 polls from one IP with 400 random handles all got 410, never 429 (verified). Cheap (one indexed SELECT each), and an unknown handle never reaches Microsoft, so impact is small. Fix: add a per-IP limit on top (e.g. a second key or a route `onRequest` IP limit of 120/min).

#### L6. Device code phishing
- Standard risk of the device flow: an attacker starts `epidle`, sends the user code to a victim ("enter this to get a badge"), the victim signs in, the attacker gets the victim's Epidle session. Only `openid profile` is requested and no Microsoft token is kept, so the attacker gets the game account, nothing else. Fix: in the CLI login screen, say "Ne saisis ce code que si tu viens de lancer epidle toi-même". Consider Entra Conditional Access "Authentication flows" policy only if the school uses it.

#### L7. Sessions: 30-day fixed lifetime, no "log out everywhere", no `__Host-` prefix
- `auth.ts:22`, cookie at `auth.ts:108-115`. Logout revokes the current token (verified by tests), bans delete all sessions. Missing: a way for a player to revoke all their sessions (e.g. a lost laptop with the CLI token), and the cookie name could be `__Host-epidle_session` to forbid subdomain overrides. Fix: `POST /api/auth/logout?all=1`, cookie prefix when `secure`.

#### L8. Logout is CSRF-able (forced logout)
- `POST /api/auth/logout` accepts `text/plain` with no body check (verified: 204). A cross-site form can log a player out (the response clears the cookie). Nuisance only. Fix: require `content-type: application/json` or an `Origin` check on every non-GET route, which also hardens intents against future same-site subdomains.

#### L9. `trustProxy: true` trusts every hop
- `app.ts:38` with `TRUST_PROXY=1` in the Dockerfile. Behind Caddy alone it is correct (Caddy replaces the incoming `X-Forwarded-For` by default when `trusted_proxies` is not set, per Caddy docs, unverified here). If the server port is ever published, or the env var is copied to a bare deploy, any client can spoof `X-Forwarded-For` and bypass every IP rate limit. Fix: `trustProxy: 1` (number of hops) instead of `true`.

#### L10. OAuth authorization code written to the request log
- `index.ts:24` `logger: true`: Fastify logs `req.url`, including `/api/auth/callback?code=...&state=...`. The code is single use and bound to the PKCE verifier held by the server, so it is useless once redeemed. Fix: custom `req` serializer that strips the query string on `/api/auth/callback`.

#### L11. Malformed build link crashes the web client
- `apps/web/src/router.ts:22`: `decodeURIComponent` throws `URIError` on `#/joueur/%E0%A4%A`, inside a `useState` initializer, so the whole app renders blank. Anyone can share such a link on Discord. Fix: try/catch, fall back to the leaderboard. Add the case to `router.test.ts`.

#### L12. Database and backup files are world-readable on a bare deploy
- Created 0644 (verified locally, depends on umask). They contain Microsoft object ids and session token hashes (not tokens). In Docker the volume is only reachable by root and the `node` user. Fix: `chmod 600` after `openDb` and after each backup, document "copy backups off the machine encrypted".

#### L13. Season boundaries depend on the first boot time
- `seasons.ts`: the first season starts when the server first starts (e.g. 14:37 UTC on a random day) and every later season follows. A season can end at 3 a.m. Paris time. Fix: anchor the first season to a configured start (`SEASON_START=2026-11-02T18:00:00+01:00`). Clock rewinds are safe (no negative advance, verified by reading `catchUp`), a large forward jump cannot be undone: keep NTP on.

#### L14. CLI renders server strings as-is
- Pseudos are safe (regex). Error messages, modifier names and `verificationUri` come from the server and are printed by Ink without stripping control characters. Only a hostile server (`--server`) could inject terminal escapes, and https is enforced. Fix: strip `\x00-\x1f\x7f-\x9f` in `api-client` for displayed strings.

#### L15. `DEFAULT_SERVER_URL` must be edited by hand before publishing the CLI
- `apps/cli/src/args.ts:4`. Publishing with `http://localhost:3000` would ship a CLI that cannot reach the game. Fix: inject at build time (`--define`) from the CI publish job, and make `prepack` fail if it is still localhost.

#### L16. Supply chain hardening: CI actions and base images by tag
- `.github/workflows/ci.yml:16-18,32` use `@v4` tags, no `permissions:` block (default token scope). `Dockerfile:5,25,44` use `node:22-bookworm-slim` and `caddy:2-alpine` by tag. The Caddy image runs as root (standard for that image). Fix: pin actions to SHAs, add `permissions: contents: read`, pin images by digest (Dependabot can bump them). Dependencies: 148 packages, names checked, no typosquat spotted, install scripts blocked by pnpm 10 (`better-sqlite3` uses its `prebuilds/`, `esbuild` its platform package), `pnpm audit` clean.

#### L17. Docker: no log rotation, no web health check (unverified)
- `docker-compose.yml`: the default `json-file` log driver grows without limit, and the server logs JSON per request. The `web` service has no health check. Fix: `logging: { driver: json-file, options: { max-size: "10m", max-file: "5" } }` on both services.

---

## 2. Authentication and sessions (status)

| Item | Status |
|---|---|
| `state` verified, single use, expires 10 min, bound to the browser by an httpOnly cookie | verified (tests + code) |
| `nonce` verified on the web flow | verified |
| PKCE S256, verifier kept server side | verified |
| Redirect URI | built from `PUBLIC_URL`, exact match is enforced by Entra (unverified, needs tenant). No open redirect: the callback only redirects to `${PUBLIC_URL}/` |
| Tenant restriction | tenant-specific endpoints, issuer pinned, `tid` checked, `common` rejected at config. Guests: M5 |
| ID token validation | `jose.jwtVerify`: signature (tenant JWKS, RS256 only), issuer, audience, `exp`/`nbf`; tests cover wrong tenant, app, issuer, nonce and key |
| Device code: polling limits | local throttle to Microsoft's `interval`, `slow_down` honored, 30 polls/min per handle (L5) |
| Device code: expiry | Microsoft's `expires_in`, handle deleted on use or expiry, cleaned by maintenance |
| CLI token storage | `~/.config/epidle/config.json`, directory 0700, file 0600 even if it existed wider (atomic rename), tested |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https (M7), 30 days |
| Rotation | new token per login, no session fixation. No rotation during a session (acceptable) |
| Logout and revocation | deletes the session row, ban deletes all (cascade). No "all sessions" logout (L7) |
| CSRF | `SameSite=Lax` + JSON-only bodies: `text/plain` intent rejected 400, form 415 (verified). Logout is the exception (L8) |
| Dev backdoor or test login | none. `fakeProvider` lives in `test-utils.ts` and is only imported by tests |

## 3. API security (status)

| Route | Auth | Owner check (IDOR) |
|---|---|---|
| `GET /api/health` | none | n/a |
| `GET /api/me`, `PUT /api/me/pseudo` | session | acts on `request.user.id` only |
| `GET /api/state`, `POST /api/intent` | session + pseudo | user id from the session, never from the request: no IDOR possible |
| `GET /api/leaderboard`, `GET /api/feed` | session + pseudo | public data by design |
| `GET /api/players/:pseudo/build` | session + pseudo | shows team and pipeline, not money (tested) |
| `/api/auth/*` | none | n/a |

- Input validation: Ajv with no coercion, no additional properties, integer bounds, enums, `requestId` pattern, body limit 4 KB. Verified: `__proto__`, `constructor.prototype`, `kind: "__proto__"`, `count: 1e400`, `targetLevel: 1.5` all 400, `Object.prototype` untouched. Core also uses `Object.hasOwn`.
- Race conditions: 25 parallel `buyRoom` with 3,620 EUR: exactly 4 bought (300+450+675+1012), money 1,182.5, the rest 422 (verified). Better-sqlite3 is synchronous and the handler has no `await` inside the transaction, so requests cannot interleave.
- Rate limits: global 300/min, intents 30/10 s per player, state/builds 60/min, leaderboard/feed 30/min, all keyed by player when logged in (tested). Issues: M3, L5.
- CORS: no CORS plugin, preflight from another origin gets 404 with no `Access-Control-Allow-Origin` (verified). Correct for a same-origin app.
- Errors: uniform `{error, message}`, no stack trace. The Fastify default 404 body (`Route GET:/api/nope not found`) leaks nothing useful.
- SQL: every query uses placeholders. The only interpolations are constants (`LEADERBOARD_SIZE`, `FEED_SIZE`, `hourMs`, table names in `admin.ts` count helper). Migrations are append-only, transactional, guarded by `user_version`, and a newer DB refuses to open.

## 4. Game integrity and anti-cheat (status)

- Server authoritative: verified. Clients send `requestId` + intent only. No endpoint accepts state, score or time; extra fields are rejected (tested in `anti-cheat.test.ts`). The clock is server-side, `catchUp` only moves forward, late joiners start at the current season time.
- Unaffordable purchases, locked tiers, training beyond room capacity, double training, invalid strictness, out-of-range levels: all refused by schema or core (tested, and re-checked by reading `intents.ts`).
- Leaderboard manipulation: score is `state.revenue` computed by the server, never written by a client. Multiple accounts: one user per Microsoft `oid` (unique), re-login reuses the player (tested). Replays: request ids kept 24 h per player.
- Numeric safety: `advance` rejects non-finite or negative durations and caps at season end. The sim reports max magnitude 4.8e11 (far below 2^53), all values finite, never negative money for the bots. Very long offline periods are bounded by the 14-day season. Money can go negative if a player sends every dev to training while paying moulis upkeep; it does not break anything (purchases are refused, revenue never decreases).
- Determinism: `packages/core` has purity guards (no IO, no `Date.now`) and `advance(a+b) == advance(advance(a), b)` is tested.
- Downtime: state is derived from elapsed time, so a restart loses nothing; a whole season of downtime opens the next season at restart instead of empty seasons (by reading `currentSeason`). Season rollover is fragile to corrupted rows (M1).

## 5. Functionality (status)

### Balance (`pnpm sim`, rerun today)

| Target (CLAUDE.md / balance.test) | Result | OK |
|---|---|---|
| Casual >= 40% of hardcore, active play wins | casual 49%, active 94%, hardcore 100% | yes |
| Not saturated before day 10 | 12.0 to 12.7 | yes |
| First tier within the first hour, last tier day 8-12 | Startup 0.01-0.03 d, Licorne 8.2-10.8 d | yes |
| No debt, no overflow | min money >= 7.7, max 4.8e11 | yes |
| Max level in about one season | max level 9 for every bot; Légende needs 11.4 days of non-stop training | as documented in DECISIONS.md (Piscine 8 min instead of 10) |

No regression.

### Features vs CLAUDE.md

| Feature | Status |
|---|---|
| Login web (code + PKCE) and CLI (device code) | implemented, unit tested, real Entra unverified |
| Pseudo choice | works, policy gaps (M4) |
| Hire, train (with queued levels), rooms, buy/upgrade mouli, strictness | implemented in core, server and both clients |
| Leaderboard season and all-time | works |
| Public build view | works for logged-in players (needs a session, not public to anonymous visitors) |
| Season rollover, weekly modifiers, weekly feed | works, tested, fragile to bad rows (M1) |
| Badges and titles persisting across seasons | **missing** (M8) |
| Salaries in EUR/s, cumulative revenue score, clicking worth nothing | yes (there is no click action at all) |

### Web vs CLI

Both clients share `packages/api-client` (API, shop offers, projections, formatting) and the same hooks, so the feature set matches: dashboard, shop with counts, training with target level, strictness, leaderboard with both scopes, feed, build view, share text, pseudo change, logout, language. Differences: the web copies a link to the build, the CLI has a dedicated Share screen; both handle 401/403 by returning to login. No behavior mismatch found by reading. Interactive CLI run unverified (no TTY here).

### Failure modes

| Case | Behavior |
|---|---|
| Server down | web shows "Serveur injoignable." with a retry button, CLI shows the same message (by reading `api-client` and `App.tsx`) |
| Expired session | 401, both clients go back to login, CLI forgets the token (by reading) |
| Network drop in the CLI | request fails with `network`, next poll retries (by reading, unverified live) |
| Microsoft down | 500 instead of a clear message (L4) |
| DB locked (admin CLI writing) | better-sqlite3 waits up to its default 5 s busy timeout, then 500 (by reading, unverified under load) |
| Corrupted state | whole game down (M1, verified) |

### Test coverage gaps

No coverage tool is installed (adding `@vitest/coverage-v8` would be a new dependency, not done). Gaps found by reading:
- no test for a corrupted or invalid stored state (M1), nor for provider network errors (L4);
- no performance budget test for `refreshScores` (M2);
- no test for pseudo rename policy (M4) or config validation of `PORT`/`PUBLIC_URL` (M7, L1);
- web client: only `keys.test.ts` and `router.test.ts`, no malformed hash case (L11), no component test;
- core is well covered (advance, economy, intents, modifiers, config purity); intent handlers are covered by `api.test.ts` and `anti-cheat.test.ts`.

## 6. Ops (status)

- Dockerfile: multi-stage, server runs as `node`, no secret baked (secrets come from compose env at run time), `.dockerignore` excludes `.env` and databases, health check on `/api/health` with a real DB query, volumes for data and backups. Base images by tag (L16). Build unverified (no daemon).
- Compose: server not published, only Caddy on 80/443, `depends_on: service_healthy`. No log rotation (L17).
- Logging: JSON, request logs, `suspicious activity` and `database backup written` lines are greppable, no tokens or cookies logged, the OAuth code is (L10).
- Backups: online backup API (consistent with WAL), at start and every 6 h, 28 kept, manual `admin backup`. **Restore tested locally and works** (player and session back on a new server). The README restore command (copy + delete `-wal`/`-shm`) is correct. Backups stay on the same host by default: the runbook says to copy them off, nothing automates it.
- README: a fresh clone following only the README installs, runs, and serves the web client and API. One inaccurate sentence and no way to play without Entra (M6). Docker steps unverified.

---

## Fix plan

### Before launch
1. M1: guard state parsing, a bad row never stops the leaderboard or the season rollover.
2. M7 + L1: validate config at start (https `PUBLIC_URL`, Entra required in production, integer `PORT`/`BACKUP_KEEP`).
3. M3: higher IP limits on the two browser login routes, redirect instead of JSON on 429. Ask IT about the campus egress IP.
4. M4: rename cooldown, reserved released pseudos, blocklist with normalization, admin rename.
5. M5: "Assignment required" in Entra, or reject `acct == 1` guests.
6. M2 (option 3, one line): refresh scores only from the maintenance job, not from requests.
7. L3: HSTS and CSP in the Caddyfile.
8. L4: clean 503 / redirect when Microsoft is unreachable.
9. L9: `trustProxy: 1`.
10. L15: build-time server URL for the published CLI.

### First week
1. M6: `pnpm admin dev-session` and README fix, so the group can test without the tenant.
2. M2 proper fix if the player count passes about 1,000.
3. L11: safe hash decoding in the web router.
4. L5, L8, L7: per-IP poll limit, Origin/content-type check on non-GET routes, logout everywhere and `__Host-` cookie.
5. L10, L12, L17: log redaction of the callback query, 0600 DB and backups, log rotation.
6. L2: complete `apps/server/.env.example`.

### Later (before day 14 for M8)
1. M8: badges and titles written at season close.
2. L13: configurable season anchor.
3. L6: phishing warning on the CLI login screen.
4. L14: strip control characters in displayed server strings.
5. L16: pin actions and images, `permissions: contents: read`.

After approval: one concern per commit, a regression test for each security fix, DECISIONS.md updated with the non-obvious choices.
