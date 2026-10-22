import { DAY, HOUR, MINUTE } from "@epidle/core";
import { describe, expect, it } from "vitest";
import { simulate } from "./simulate";

// Pins the tuning targets: if a config change breaks one of them, this fails.
// Runs three full seasons, so it takes a few seconds.
describe("season balance", () => {
  const [hardcore, active, casual] = [2 * MINUTE, 30 * MINUTE, 8 * HOUR].map((i) => simulate(i));
  const bots = { hardcore, active, casual };
  const score = (r: typeof hardcore) => r?.final.revenue ?? 0;

  it.each(Object.entries(bots))("%s bot is not saturated before day 10", (_, r) => {
    if (r?.saturatedAt != null) expect(r.saturatedAt / DAY).toBeGreaterThanOrEqual(10);
  });

  it("casual reaches at least 40% of hardcore, active play wins", () => {
    expect(score(casual) / score(hardcore)).toBeGreaterThanOrEqual(0.4);
    expect(score(hardcore)).toBeGreaterThan(score(active));
    expect(score(active)).toBeGreaterThan(score(casual));
  });

  it.each(Object.entries(bots))("%s bot unlocks tiers from the first hour to day 8-12", (_, r) => {
    const times = r?.final.tierUnlockedAt ?? [];
    expect(times.length).toBe(6);
    expect((times[1] ?? Number.POSITIVE_INFINITY) / HOUR).toBeLessThanOrEqual(1);
    const last = (times.at(-1) ?? 0) / DAY;
    expect(last).toBeGreaterThanOrEqual(8);
    expect(last).toBeLessThanOrEqual(12);
  });

  it.each(Object.entries(bots))("%s bot never goes into debt nor overflows", (_, r) => {
    expect(r?.minMoney).toBeGreaterThanOrEqual(0);
    expect(r?.allFinite).toBe(true);
    // Well below 2^53: integers stay exact and display stays readable.
    expect(r?.maxMagnitude).toBeLessThan(1e15);
  });
});
