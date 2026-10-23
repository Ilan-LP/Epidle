import { HOUR } from "@epidle/core";
import { describe, expect, it } from "vitest";
import { FLOOD_INTENTS_PER_HOUR, NO_SLEEP_HOURS, scanActivity } from "./suspicious";
import { MS, testApp } from "./test-utils";

const rows = (t: Awaited<ReturnType<typeof testApp>>) =>
  t.db.prepare("SELECT kind, pseudo FROM suspicious ORDER BY id").all();

describe("suspicious activity log", () => {
  it("logs what the official clients never send, once per window", async () => {
    const t = await testApp();
    const token = t.player("oid-a", "Alice");
    await t.intent(token, { type: "hire", kind: "junior", money: 1e9 });
    await t.intent(token, { type: "hire", kind: "junior", money: 1e9 });
    const replay = { type: "setStrictness", stage: "loc", level: 0, requestId: "same-id-123" };
    await t.intent(token, replay);
    await t.intent(token, replay);
    expect(rows(t)).toEqual([
      { kind: "invalid_intent", pseudo: "Alice" },
      { kind: "replay", pseudo: "Alice" },
    ]);
  });

  it("logs rate limit hits", async () => {
    const t = await testApp();
    const token = t.player("oid-a", "Alice");
    for (let i = 0; i < 32; i++)
      await t.intent(token, { type: "setStrictness", stage: "loc", level: 0 });
    expect(rows(t)).toEqual([{ kind: "rate_limited", pseudo: "Alice" }]);
  });

  it("finds floods, sleepless players and timer-like cadence in the intents", async () => {
    const t = await testApp();
    t.player("oid-flood", "Flood");
    t.player("oid-night", "Night");
    t.player("oid-human", "Human");
    const now = t.clock.t;
    const insert = t.db.prepare(
      "INSERT INTO intent_requests (user_id, request_id, created_at) VALUES (?, ?, ?)",
    );
    // Flood: one intent every 3 s for the last hour, like a timer.
    for (let i = 0; i <= FLOOD_INTENTS_PER_HOUR; i++) insert.run(1, `f${i}`, now - i * 3 * MS);
    // Night owl: one intent per hour, every hour.
    for (let h = 0; h < NO_SLEEP_HOURS + 2; h++) insert.run(2, `n${h}`, now - h * HOUR * MS - 1);
    // Human: 80 intents in the hour at irregular intervals.
    let at = now;
    for (let i = 0; i < 80; i++) {
      at -= ((i * 7919) % 60) * MS + 1000;
      insert.run(3, `h${i}`, at);
    }
    const found = scanActivity(t.db, now).map((s) => [s.userId, s.kind]);
    expect(found).toEqual(
      expect.arrayContaining([
        [1, "intent_flood"],
        [1, "robotic_cadence"],
        [2, "no_sleep"],
      ]),
    );
    expect(found).toHaveLength(3);
  });
});
