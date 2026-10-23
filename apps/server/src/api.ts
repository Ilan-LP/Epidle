import { BALANCE, computeRates, type GameState, INTENT_ERROR_MESSAGES } from "@epidle/core";
import type { FastifyInstance } from "fastify";
import { requirePlayer, requireUser } from "./auth";
import type { Db } from "./db";
import { sendError } from "./errors";
import { weekFeed } from "./feed";
import { loadGame, refreshScores, type Season, saveGame, stateBalance } from "./games";
import { applyIntent, INTENT_SCHEMA, type Intent } from "./intents";
import type { Rotation } from "./modifiers";
import { currentSeason } from "./seasons";

export const PSEUDO_PATTERN = "^[A-Za-z0-9_-]{3,16}$";
const LEADERBOARD_SIZE = 50;
/** The leaderboard advances every company of the season, at most this often. */
const SCORES_MAX_AGE_MS = 30_000;
// Per player, on top of the global 300/min. The clients poll the state every 15 s and the
// leaderboard and feed every 30 s: these leave room for several tabs, not for a scraper.
const INTENT_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: 10_000 } };
const STATE_RATE_LIMIT = { rateLimit: { max: 60, timeWindow: 60_000 } };
const READ_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: 60_000 } };

const seasonView = (s: Season) => ({
  id: s.id,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  weeks: s.weeks,
});

function gameView(season: Season, state: GameState, now: number) {
  return {
    serverTime: now,
    season: seasonView(season),
    state,
    rates: computeRates(state, stateBalance(season, state)),
  };
}

interface RankRow {
  id: number;
  pseudo: string;
  score: number;
  rank: number;
}

function leaderboard(db: Db, seasonId: number | null, userId: number) {
  // Same ranking for both scopes: one season, or the sum of every season (all-time).
  const ranked = `
    WITH totals AS (
      SELECT u.id, u.pseudo, SUM(g.score) AS score FROM games g JOIN users u ON u.id = g.user_id
      WHERE u.pseudo IS NOT NULL AND (@season IS NULL OR g.season_id = @season) GROUP BY u.id
    ), ranked AS (SELECT id, pseudo, score, RANK() OVER (ORDER BY score DESC) AS rank FROM totals)
    SELECT id, pseudo, score, rank FROM ranked`;
  const top = db
    .prepare(`${ranked} ORDER BY rank, pseudo LIMIT ${LEADERBOARD_SIZE}`)
    .all({ season: seasonId }) as RankRow[];
  const me = db.prepare(`${ranked} WHERE id = @user`).get({ season: seasonId, user: userId }) as
    | RankRow
    | undefined;
  return {
    entries: top.map(({ rank, pseudo, score }) => ({ rank, pseudo, score })),
    me: me ? { rank: me.rank, score: me.score } : null,
  };
}

/** What other players can see: the strategy, not the bank account. */
function buildView(state: GameState) {
  const team = new Map<string, { kind: string; level: number; count: number; training: number }>();
  for (const dev of state.devs) {
    const key = `${dev.kind}:${dev.level}`;
    const group = team.get(key) ?? { kind: dev.kind, level: dev.level, count: 0, training: 0 };
    group.count++;
    if (dev.training) group.training++;
    team.set(key, group);
  }
  return {
    tier: state.tier,
    score: state.revenue,
    headcount: state.devs.length,
    rooms: state.rooms,
    team: [...team.values()].sort((a, b) => b.level - a.level || a.kind.localeCompare(b.kind)),
    stages: state.stages.map((s, i) => ({
      id: BALANCE.stages[i]?.id,
      instances: s.instances,
      version: s.version,
      strictness: s.strictness,
    })),
  };
}

export function registerApi(app: FastifyInstance, db: Db, now: () => number, rotation: Rotation) {
  const season = (t: number) => currentSeason(db, t, rotation);
  const freshScores = (s: Season, t: number) => {
    if (t - s.scoresRefreshedAt > SCORES_MAX_AGE_MS) refreshScores(db, s, t);
  };

  app.get("/api/me", { preHandler: requireUser }, async (request) => ({
    pseudo: request.user?.pseudo ?? null,
  }));

  app.put<{ Body: { pseudo: string } }>(
    "/api/me/pseudo",
    {
      preHandler: requireUser,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["pseudo"],
          properties: { pseudo: { type: "string", pattern: PSEUDO_PATTERN } },
        },
      },
    },
    async (request, reply) => {
      const { pseudo } = request.body;
      const taken = db
        .prepare("SELECT 1 FROM users WHERE pseudo = ? AND id != ?")
        .get(pseudo, request.user?.id);
      if (taken) return sendError(reply, 409, "pseudo_taken");
      db.prepare("UPDATE users SET pseudo = ? WHERE id = ?").run(pseudo, request.user?.id);
      return { pseudo };
    },
  );

  app.get(
    "/api/state",
    { preHandler: requirePlayer, config: STATE_RATE_LIMIT },
    async (request) => {
      const t = now();
      const s = season(t);
      const userId = request.user?.id as number;
      const state = loadGame(db, userId, s, t);
      saveGame(db, userId, s, state, t);
      return gameView(s, state, t);
    },
  );

  app.post<{ Body: Intent }>(
    "/api/intent",
    { preHandler: requirePlayer, config: INTENT_RATE_LIMIT, schema: { body: INTENT_SCHEMA } },
    async (request, reply) => {
      const t = now();
      const s = season(t);
      const userId = request.user?.id as number;
      const intent = request.body;
      // Synchronous and in one transaction: no other request can interleave, and a request id
      // is only consumed if the intent was processed.
      const result = db.transaction(() => {
        const fresh = db
          .prepare(
            "INSERT OR IGNORE INTO intent_requests (user_id, request_id, created_at) VALUES (?, ?, ?)",
          )
          .run(userId, intent.requestId, t);
        const before = loadGame(db, userId, s, t);
        if (fresh.changes === 0) return { replay: true as const, state: before };
        const outcome = applyIntent(before, intent, stateBalance(s, before));
        saveGame(db, userId, s, outcome.state, t);
        return { replay: false as const, outcome };
      })();
      if (result.replay) return sendError(reply, 409, "replay", gameView(s, result.state, t));
      const { outcome } = result;
      const view = gameView(s, outcome.state, t);
      if (outcome.applied === 0 && outcome.error) {
        return reply.code(422).send({
          error: outcome.error,
          message: INTENT_ERROR_MESSAGES[outcome.error],
          applied: 0,
          ...view,
        });
      }
      return {
        applied: outcome.applied,
        error: outcome.error,
        message: outcome.error ? INTENT_ERROR_MESSAGES[outcome.error] : null,
        ...view,
      };
    },
  );

  app.get<{ Querystring: { scope?: "season" | "alltime" } }>(
    "/api/leaderboard",
    {
      preHandler: requirePlayer,
      config: READ_RATE_LIMIT,
      schema: {
        querystring: {
          type: "object",
          properties: { scope: { type: "string", enum: ["season", "alltime"] } },
        },
      },
    },
    async (request) => {
      const t = now();
      const s = season(t);
      freshScores(s, t);
      const scope = request.query.scope ?? "season";
      return {
        scope,
        season: seasonView(s),
        ...leaderboard(db, scope === "season" ? s.id : null, request.user?.id as number),
      };
    },
  );

  app.get("/api/feed", { preHandler: requirePlayer, config: READ_RATE_LIMIT }, async () => {
    const t = now();
    const s = season(t);
    freshScores(s, t);
    return { season: seasonView(s), ...weekFeed(db, s, t) };
  });

  app.get<{ Params: { pseudo: string } }>(
    "/api/players/:pseudo/build",
    {
      preHandler: requirePlayer,
      config: STATE_RATE_LIMIT,
      schema: {
        params: {
          type: "object",
          required: ["pseudo"],
          properties: { pseudo: { type: "string", pattern: PSEUDO_PATTERN } },
        },
      },
    },
    async (request, reply) => {
      const t = now();
      const s = season(t);
      const row = db
        .prepare(
          `SELECT u.id, u.pseudo FROM users u JOIN games g ON g.user_id = u.id AND g.season_id = ?
           WHERE u.pseudo = ?`,
        )
        .get(s.id, request.params.pseudo) as { id: number; pseudo: string } | undefined;
      if (!row) return sendError(reply, 404, "not_found");
      return {
        pseudo: row.pseudo,
        season: seasonView(s),
        ...buildView(loadGame(db, row.id, s, t)),
      };
    },
  );
}
