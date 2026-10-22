import { BALANCE, HOUR } from "@epidle/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSeason, runMaintenance } from "./seasons";
import { MS, T0, testApp } from "./test-utils";

const SEASON_MS = BALANCE.seasonSeconds * MS;
let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.app.close());

describe("season rollover", () => {
  it("freezes final scores at the season end and starts everyone fresh", async () => {
    const token = await t.login("oid-a", "Alice");
    await t.get(token, "/api/state");
    t.clock.t += SEASON_MS + 5 * 60_000; // the job ran a bit late
    runMaintenance(t.db, t.clock.t);

    const closed = getSeason(t.db, 1);
    expect(closed?.closedAt).toBe(t.clock.t);
    const final = JSON.parse(
      (t.db.prepare("SELECT state FROM games WHERE season_id = 1").get() as { state: string })
        .state,
    );
    expect(final.time).toBe(BALANCE.seasonSeconds);

    const next = (await t.get(token, "/api/state")).json();
    expect(next.season).toMatchObject({ id: 2, startsAt: T0 + SEASON_MS });
    expect(next.state.revenue).toBeLessThan(final.revenue);
    expect(next.state.time).toBeCloseTo(5 * 60);
  });

  it("happens on the first request even if the job never ran", async () => {
    const token = await t.login("oid-a", "Alice");
    await t.get(token, "/api/state");
    t.clock.t += SEASON_MS;
    expect((await t.get(token, "/api/state")).json().season.id).toBe(2);
    expect(getSeason(t.db, 1)?.closedAt).not.toBeNull();
  });

  it("starts the next season now after a long downtime instead of creating empty ones", () => {
    runMaintenance(t.db, T0);
    t.clock.t = T0 + 3 * SEASON_MS + HOUR * MS;
    runMaintenance(t.db, t.clock.t);
    expect(getSeason(t.db, 2)?.startsAt).toBe(t.clock.t);
    expect(getSeason(t.db, 3)).toBeNull();
  });

  it("late joiners start at the current season time", async () => {
    runMaintenance(t.db, T0);
    t.clock.t += 3 * HOUR * MS;
    const token = await t.login("oid-late", "Late");
    expect((await t.get(token, "/api/state")).json().state.time).toBe(3 * HOUR);
  });

  it("cleans up expired sessions and old request ids", async () => {
    const token = await t.login("oid-a", "Alice");
    await t.intent(token, { type: "setStrictness", stage: "loc", level: 0 });
    t.clock.t += 31 * 24 * 3600 * 1000;
    runMaintenance(t.db, t.clock.t);
    expect(t.db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT count(*) AS n FROM intent_requests").get()).toEqual({ n: 0 });
  });
});
