import type { Db } from "./db";

// Append only: never edit a migration that has shipped, add a new one.
// The index + 1 is stored in PRAGMA user_version.
export const MIGRATIONS: readonly string[] = [
  `
  -- Only the Microsoft object id and the pseudo: no name, no email.
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    ms_oid TEXT NOT NULL UNIQUE,
    pseudo TEXT UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
  );

  -- token_hash is the sha256 of the bearer token / cookie value.
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- Pending logins: PKCE verifier + nonce for the web, device code for the CLI.
  CREATE TABLE auth_requests (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('web', 'device')),
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    closed_at INTEGER,
    scores_refreshed_at INTEGER NOT NULL DEFAULT 0
  );

  -- One company per player and season. score mirrors state.revenue for leaderboard queries.
  CREATE TABLE games (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    state TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, season_id)
  );
  CREATE INDEX games_season_score ON games(season_id, score DESC);

  -- Client request ids already processed, to reject replayed intents.
  CREATE TABLE intent_requests (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, request_id)
  );
  CREATE INDEX intent_requests_created ON intent_requests(created_at);
  `,
];

export function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database is at version ${current}, this server only knows ${MIGRATIONS.length}`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v] ?? "");
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
