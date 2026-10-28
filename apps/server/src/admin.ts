import { parseArgs } from "node:util";
import { BALANCE } from "@epidle/core";
import { ANALYTICS_TIME_ZONE, analyticsReport, type Rate } from "./analytics";
import { backupRotate, backupTo } from "./backup";
import type { Db } from "./db";
import { type Rotation, seasonWeeks } from "./modifiers";
import { flagMouliCheck } from "./mouli-check";
import { PSEUDO_PATTERN, pseudoRefusal, setPseudo } from "./pseudo";
import { currentSeason } from "./seasons";

// Admin commands, run next to the server on the same database file (SQLite handles the
// concurrency): pnpm admin <command>. Changes apply at once, the server keeps no cache of users.

export const ADMIN_HELP = `Usage: pnpm admin <command>

  players [text]                     players whose pseudo contains text, with their season score
  remove <pseudo> [--ban] [--reason <text>] [--yes]
                                     delete a player and all their data (company, sessions, feed).
                                     --ban also refuses their Microsoft account at login.
                                     Without --yes, only shows what would be deleted.
  rename <pseudo> <new>              change a player's pseudo (offensive name): no cooldown, no
                                     blocklist; the old one stays reserved for them for 14 days
  bans                               banned accounts
  unban <id>                         lift a ban (id from "bans")
  suspicious [--hours <n>]           signs of scripting in the last n hours (default 24)
  mouli-check <pseudo>               flag a player for an anti-bot Mouli Check on next intent
  backup [file]                      online backup to file, or to BACKUP_DIR with rotation
  weeks                              weekly modifiers of the current and next season
  analytics [--days <n>]             active players per day, D+1 / D+3 retention, tier funnel,
                                     client versions (last n days, default 14). Counts only
`;

export interface AdminContext {
  db: Db;
  now: number;
  rotation: Rotation;
  seasonAnchor?: number | null;
  backup: { dir: string; keep: number } | null;
  out: (line: string) => void;
}

const date = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function table(out: (line: string) => void, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return out("(none)");
  const keys = Object.keys(rows[0] ?? {});
  const cell = (v: unknown) => (v === null || v === undefined ? "-" : String(v));
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => cell(r[k]).length)));
  const line = (values: string[]) =>
    values
      .map((v, i) => v.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  out(line(keys));
  for (const r of rows) out(line(keys.map((k) => cell(r[k]))));
}

export interface RemoveResult {
  pseudo: string;
  games: number;
  sessions: number;
  banned: boolean;
}

/** Deletes the player (cascades to their companies, sessions, intents and feed events). */
export function removePlayer(
  db: Db,
  pseudo: string,
  opts: { ban: boolean; reason: string; dryRun: boolean },
  now: number,
): RemoveResult | null {
  return db.transaction(() => {
    const user = db
      .prepare("SELECT id, ms_oid AS oid, pseudo FROM users WHERE pseudo = ?")
      .get(pseudo) as { id: number; oid: string; pseudo: string } | undefined;
    if (!user) return null;
    const count = (table: string) =>
      (
        db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(user.id) as {
          n: number;
        }
      ).n;
    const result = {
      pseudo: user.pseudo,
      games: count("games"),
      sessions: count("sessions"),
      banned: opts.ban,
    };
    if (opts.dryRun) return result;
    if (opts.ban) {
      db.prepare(
        "INSERT INTO bans (ms_oid, pseudo, reason, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      ).run(user.oid, user.pseudo, opts.reason, now);
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    return result;
  })();
}

export async function runAdmin(argv: string[], ctx: AdminContext): Promise<number> {
  const { db, now, out } = ctx;
  // pnpm passes a literal "--" through when the caller writes one.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ban: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      reason: { type: "string", default: "" },
      hours: { type: "string", default: "24" },
      days: { type: "string", default: "14" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, arg, arg2] = positionals;

  switch (values.help ? "help" : command) {
    case "players": {
      const season = currentSeason(db, now, ctx.rotation, ctx.seasonAnchor);
      const rows = db
        .prepare(
          `SELECT u.id, u.pseudo, round(coalesce(g.score, 0)) AS score,
             (SELECT count(*) FROM suspicious s WHERE s.user_id = u.id) AS suspicious, u.created_at AS created
           FROM users u LEFT JOIN games g ON g.user_id = u.id AND g.season_id = ?
           WHERE u.pseudo LIKE ? ESCAPE '\\' ORDER BY score DESC, u.pseudo`,
        )
        .all(season.id, `%${(arg ?? "").replace(/[\\%_]/g, "\\$&")}%`) as Record<string, unknown>[];
      table(
        out,
        rows.map((r) => ({ ...r, created: date(r.created as number) })),
      );
      return 0;
    }
    case "remove": {
      if (!arg) return usage(out, "remove needs a pseudo");
      const result = removePlayer(
        db,
        arg,
        { ban: values.ban, reason: values.reason, dryRun: !values.yes },
        now,
      );
      if (!result) {
        out(`No player with pseudo ${arg}.`);
        return 1;
      }
      const what = `${result.pseudo}: ${result.games} season(s), ${result.sessions} session(s)${result.banned ? ", banned" : ""}`;
      if (!values.yes) {
        out(`Would remove ${what}. Run again with --yes to do it.`);
        return 0;
      }
      out(`Removed ${what}.`);
      return 0;
    }
    case "rename": {
      if (!arg || !arg2) return usage(out, "rename needs a pseudo and the new one");
      if (!new RegExp(PSEUDO_PATTERN).test(arg2)) return usage(out, `invalid pseudo ${arg2}`);
      const user = db.prepare("SELECT id, pseudo FROM users WHERE pseudo = ?").get(arg) as
        | { id: number; pseudo: string }
        | undefined;
      if (!user) {
        out(`No player with pseudo ${arg}.`);
        return 1;
      }
      const refusal = pseudoRefusal(db, user.id, arg2, now, true);
      if (refusal) {
        out(`Cannot rename ${user.pseudo} to ${arg2}: ${refusal}.`);
        return 1;
      }
      setPseudo(db, user.id, arg2, now);
      out(`Renamed ${user.pseudo} to ${arg2}.`);
      return 0;
    }
    case "bans":
      table(
        out,
        (
          db.prepare("SELECT id, pseudo, reason, at FROM bans ORDER BY id").all() as {
            at: number;
          }[]
        ).map((r) => ({ ...r, at: date(r.at) })),
      );
      return 0;
    case "unban": {
      const id = Number(arg);
      if (!Number.isInteger(id)) return usage(out, "unban needs a ban id");
      const { changes } = db.prepare("DELETE FROM bans WHERE id = ?").run(id);
      out(
        changes ? `Ban ${id} lifted: they can log in again, with a new company.` : `No ban ${id}.`,
      );
      return changes ? 0 : 1;
    }
    case "suspicious": {
      const hours = Number(values.hours);
      if (!(hours > 0)) return usage(out, "--hours must be a positive number");
      const rows = db
        .prepare(
          `SELECT coalesce(pseudo, '(removed)') AS pseudo, user_id AS id, kind, count(*) AS times,
             max(at) AS last, (SELECT detail FROM suspicious t WHERE t.kind = s.kind
               AND t.user_id IS s.user_id AND t.ip IS s.ip ORDER BY at DESC LIMIT 1) AS detail,
             ip
           FROM suspicious s WHERE at > ? GROUP BY user_id, ip, kind ORDER BY last DESC`,
        )
        .all(now - hours * 3600_000) as { last: number }[];
      table(
        out,
        rows.map((r) => ({ ...r, last: date(r.last) })),
      );
      return 0;
    }
    case "backup": {
      if (arg) {
        await backupTo(db, arg);
        out(`Backup written to ${arg}.`);
        return 0;
      }
      if (!ctx.backup) return usage(out, "BACKUP_DIR is empty: give a file");
      out(`Backup written to ${await backupRotate(db, ctx.backup.dir, ctx.backup.keep, now)}.`);
      return 0;
    }
    case "weeks": {
      const season = currentSeason(db, now, ctx.rotation, ctx.seasonAnchor);
      const weekMs = BALANCE.weekSeconds * 1000;
      const show = (id: number, weeks: typeof season.weeks, startsAt: number) =>
        weeks.forEach((m, w) => {
          out(
            `season ${id} week ${w + 1} (${date(startsAt + w * weekMs)} UTC): ${m ? `${m.name} [${m.id}]` : "normal"}`,
          );
        });
      show(season.id, season.weeks, season.startsAt);
      out("next season, from the current file:");
      show(season.id + 1, seasonWeeks(ctx.rotation, season.id + 1), season.endsAt);
      return 0;
    }
    case "analytics": {
      const days = Number(values.days);
      if (!Number.isInteger(days) || days < 1 || days > 366)
        return usage(out, "--days must be an integer between 1 and 366");
      printAnalytics(out, analyticsReport(db, now, days));
      return 0;
    }
    case "mouli-check": {
      if (!arg) return usage(out, "mouli-check needs a pseudo");
      const user = db
        .prepare("SELECT id, pseudo FROM users WHERE pseudo = ? COLLATE NOCASE")
        .get(arg) as { id: number; pseudo: string } | undefined;
      if (!user) {
        out(`No player with pseudo ${arg}.`);
        return 1;
      }
      flagMouliCheck(db, user.id);
      out(`Flagged ${user.pseudo} for a Mouli Check on next intent.`);
      return 0;
    }
    case "help":
      out(ADMIN_HELP);
      return 0;
    default:
      return usage(out, command ? `unknown command ${command}` : "no command");
  }
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "-");
const rate = (r: Rate) => `${pct(r.retained, r.eligible)} (${r.retained}/${r.eligible})`;

function printAnalytics(out: (line: string) => void, r: ReturnType<typeof analyticsReport>) {
  out(`Active players per day (${ANALYTICS_TIME_ZONE}, today ${r.today} is not over)`);
  table(out, r.daily);
  out("");
  out("Retention by cohort (first active day). D+k: active on the k-th day after it");
  table(
    out,
    r.cohorts.map((c) => ({
      cohort: c.day,
      players: c.players,
      d1: c.d1 === null ? null : `${c.d1} ${pct(c.d1, c.players)}`,
      d3: c.d3 === null ? null : `${c.d3} ${pct(c.d3, c.players)}`,
    })),
  );
  out(`All cohorts: D+1 ${rate(r.retention.d1)}, D+3 ${rate(r.retention.d3)}`);
  out("");
  if (!r.funnel) out("Funnel: no company yet");
  else {
    const f = r.funnel;
    const all = f.tiers[0]?.players ?? 0;
    out(`Funnel, season ${f.seasonId}: players who reached each tier`);
    table(
      out,
      f.tiers.map((t, i) => ({
        tier: t.tier,
        name: t.name,
        unlocks: t.unlocks,
        players: t.players,
        of_all: pct(t.players, all),
        of_previous: i === 0 ? null : pct(t.players, f.tiers[i - 1]?.players ?? 0),
      })),
    );
  }
  out("");
  out("Clients of the players active in the last 7 days");
  table(out, r.clients);
}

function usage(out: (line: string) => void, message: string): number {
  out(`${message}\n\n${ADMIN_HELP}`);
  return 2;
}
