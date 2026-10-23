import { readFileSync } from "node:fs";
import {
  applyEffects,
  DAY,
  devLocPerSecond,
  devSalaryPerSecond,
  hireCost,
  maxLevel,
  weeksPerSeason,
} from "@epidle/core";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { parseRotation, seasonWeeks } from "./modifiers";
import { currentSeason } from "./seasons";
import { MS, T0, testApp } from "./test-utils";

const shipped = readFileSync(new URL("../modifiers.json", import.meta.url), "utf8");

const file = (modifiers: unknown[], rotation: unknown[]) => JSON.stringify({ modifiers, rotation });
const soldes = {
  id: "soldes",
  name: "Soldes",
  description: "Embauches à moitié prix.",
  effects: { hireCost: 0.5 },
};

describe("modifiers file", () => {
  it("ships a valid rotation", () => {
    const rotation = parseRotation(shipped);
    expect(rotation.length).toBeGreaterThan(0);
    expect(rotation.find((m) => m?.id === "rush")?.name).toBe("Semaine Rush");
  });

  it("keeps every dev profitable under every shipped modifier", () => {
    // Same invariant as the base balance: no negative-money death spiral, even for a week.
    for (const m of parseRotation(shipped)) {
      if (!m) continue;
      const cfg = applyEffects(m.effects);
      const rawValue = cfg.rawValuePerLoc * (1 - cfg.initialBugDensity);
      for (let level = 0; level <= maxLevel(cfg); level++) {
        expect(devLocPerSecond(level, cfg) * rawValue, m.id).toBeGreaterThan(
          devSalaryPerSecond(level, cfg),
        );
      }
    }
  });

  it.each([
    ["not json", "{", "JSON"],
    ["no rotation", JSON.stringify({ modifiers: [] }), "rotation"],
    ["unknown id", file([soldes], ["rush"]), "unknown modifier"],
    ["duplicate", file([soldes, soldes], []), "twice"],
    ["bad effect", file([{ ...soldes, effects: { hireCost: 0 } }], []), "between"],
  ])("refuses a file with %s", (_, text, message) => {
    expect(() => parseRotation(text)).toThrow(message);
  });

  it("cycles the rotation across the weeks of every season", () => {
    const rotation = parseRotation(file([soldes], ["soldes", null, null]));
    expect(weeksPerSeason()).toBe(2);
    expect(seasonWeeks(rotation, 1).map((m) => m?.id ?? null)).toEqual(["soldes", null]);
    expect(seasonWeeks(rotation, 2).map((m) => m?.id ?? null)).toEqual([null, "soldes"]);
    expect(seasonWeeks([], 7)).toEqual([null, null]);
  });
});

describe("modifiers in game", () => {
  it("applies the week's balance to rates and prices, then the normal one", async () => {
    const t = await testApp({ rotation: parseRotation(file([soldes], ["soldes", null])) });
    const token = t.player("oid-a", "Alice");
    const first = (await t.get(token, "/api/state")).json();
    expect(first.season.weeks.map((w: { id: string } | null) => w?.id ?? null)).toEqual([
      "soldes",
      null,
    ]);

    t.clock.t += 1000 * MS;
    const before = (await t.get(token, "/api/state")).json().state;
    const hired = (await t.intent(token, { type: "hire", kind: "junior" })).json();
    const cfg = applyEffects(soldes.effects);
    expect(hired.state.money).toBeCloseTo(before.money - hireCost(before, "junior", cfg));

    t.clock.t += 7 * DAY * MS;
    const later = (await t.get(token, "/api/state")).json();
    const next = (await t.intent(token, { type: "hire", kind: "junior" })).json();
    expect(next.state.money).toBeCloseTo(later.state.money - hireCost(later.state, "junior"));
  });

  it("copies the weeks when a season opens: editing the file only changes later seasons", () => {
    const db = openDb(":memory:");
    const a = parseRotation(file([soldes], ["soldes"]));
    const b = parseRotation(file([soldes], [null]));
    const ids = (season: { weeks: readonly ({ id: string } | null)[] }) =>
      season.weeks.map((w) => w?.id ?? null);
    const first = currentSeason(db, T0, a);
    expect(ids(first)).toEqual(["soldes", "soldes"]);
    // The server restarted with another file: the running season keeps its weeks.
    expect(ids(currentSeason(db, T0 + DAY * MS, b))).toEqual(["soldes", "soldes"]);
    expect(ids(currentSeason(db, first.endsAt, b))).toEqual([null, null]);
  });
});
