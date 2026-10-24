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
  `
  -- Weekly modifiers of the season, copied from the config file when it opens.
  ALTER TABLE seasons ADD COLUMN weeks TEXT NOT NULL DEFAULT '[]';
  -- User ids of the top 10 at the last score refresh, to detect rank changes for the feed.
  ALTER TABLE seasons ADD COLUMN top TEXT NOT NULL DEFAULT '[]';

  -- Score at the start of the week the row was last saved in, for the "climbers of the week".
  ALTER TABLE games ADD COLUMN week INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE games ADD COLUMN week_base REAL NOT NULL DEFAULT 0;
  ALTER TABLE games ADD COLUMN joined_at INTEGER;

  -- What happened this season: tiers, levels, rank changes. The pseudo is read at display time.
  CREATE TABLE feed_events (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX feed_events_season ON feed_events(season_id, at);
  CREATE INDEX feed_events_user ON feed_events(user_id, kind, at);

  -- Signs of scripting, for a human to review. Kept when the player is removed.
  CREATE TABLE suspicious (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pseudo TEXT,
    ip TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX suspicious_at ON suspicious(at);

  -- Removed players who may not log in again. Only the Microsoft object id, like users.
  CREATE TABLE bans (
    id INTEGER PRIMARY KEY,
    ms_oid TEXT NOT NULL UNIQUE,
    pseudo TEXT,
    reason TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  );
  `,
  `
  -- Pseudo rules (pseudo.ts). pseudo_key merges case, "_", "-" and lookalikes: same mapping as
  -- pseudoKey(), keep both in sync. Uniqueness on the key is checked by the server.
  ALTER TABLE users ADD COLUMN pseudo_key TEXT;
  ALTER TABLE users ADD COLUMN pseudo_changed_at INTEGER;
  UPDATE users SET pseudo_key = replace(replace(replace(replace(replace(
    lower(pseudo), '_', ''), '-', ''), '0', 'o'), '1', 'l'), 'i', 'l') WHERE pseudo IS NOT NULL;
  CREATE INDEX users_pseudo_key ON users(pseudo_key);

  -- Pseudos given up by a rename, reserved for their old owner for a while.
  CREATE TABLE released_pseudos (
    pseudo_key TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    released_at INTEGER NOT NULL
  );
  `,
  `
  -- Badges kept across seasons (awards.ts), written when a season closes.
  CREATE TABLE awards (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    kind TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, season_id, kind)
  );
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
