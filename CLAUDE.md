# Epidle

Idle management game about running a dev company, built for students of Epitech Lyon (mostly first years, "Tek 1").
Goal: make people talk to each other (leaderboard, strategies), like Tekmeme did. 3 weeks of activity would already be a success.
It is a fun side project: keep it simple and shippable.

## Product (decided)
- Web client and terminal client, both using the same server. The server is required to play.
- Login with Microsoft SSO (Epitech accounts only). Public identity is a pseudo, never the real name.
- Made for Epitech Lyon, open to any Epitech account. One leaderboard for everyone who plays.
- Programming language choice (C, TypeScript, Python...) is purely cosmetic: code snippets, prompt, colors. Never balance around it.
- UI text in French. Code, comments and docs in English.

## Game design (initial, to be tuned by simulation)
- Loop: devs write LoC/s -> LoC go through a pipeline of "mouli" stages (LoC, files, projects, later products) -> shipped work earns EUR, multiplied by quality.
- Unchecked work ships with bugs, which lowers quality.
- Each mouli stage has a capacity (instances x throughput) and a strictness level. Stricter catches more bugs but is slower.
  Higher stages are slower per LoC, so they need more instances, which cost money and upkeep. The bottleneck must shift as the company grows.
- Training: juniors can go to "Piscine" for 10 min for x2 perf, then each next level takes 2x longer for another x2.
  About 11 levels (Piscine, Tek 1 ... Tek 5, Lead, Staff, Principal, Fellow, Légende) so reaching the max takes roughly one season.
  Training rooms have limited capacity. "Confirmé" and "Senior" are pre-trained but expensive. Recruiting costs grow with headcount.
- [DEFAULT] Every dev has a salary in EUR/s.
- [DEFAULT] Seasons of 14 days, full reset, score = cumulative revenue. Only badges and titles persist.
- Clicking is worth almost nothing: the game is about decisions, not spamming.

## Working agreements
- Server authoritative: clients send intents (hire, train, buy mouli, set strictness), the server computes state from elapsed time using the same pure core package.
- packages/core is pure and deterministic: no IO, no Date.now (time is passed in).
- Small commits. After each task, explain in plain language what you changed and why. Append non-obvious choices to DECISIONS.md.
- Never add a dependency without a one-line justification.
- Ask me before changing anything marked "decided" above.

## Client versions and analytics
- Every API call carries `X-Epidle-Client: cli|web/<package.json version>` (set in `createApi`). The server refuses older than `MIN_CLI_VERSION` / `MIN_WEB_VERSION` with 426 `client_outdated` and a French message (`npx epidle@latest` for the CLI, reload for the web). No header = CLI 0.1.0, accepted by default: never break it without raising the minimum on purpose.
- Bump `apps/cli/package.json` on every CLI publish. When a server change breaks old clients, raise `DEFAULT_MIN_VERSIONS` in `apps/server/src/client-version.ts` in the same commit.
- Analytics live in our own database only (`apps/server/src/analytics.ts`): first/last seen, active days (Europe/Paris), tier milestones per season. No IP, no user agent, cascades on player removal. `pnpm admin analytics` prints counts only, never a pseudo or an id.
- Migrations are append only, idempotent (`IF NOT EXISTS`, `INSERT OR IGNORE`) and never drop or rewrite data. A step can be `{ sql, data }` when a backfill needs code.
