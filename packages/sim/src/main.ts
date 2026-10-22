import { BALANCE, type Balance, computeRates, DAY, HOUR, MINUTE } from "@epidle/core";
import { type SimResult, simulate } from "./simulate";

// Usage: pnpm sim ['<json patch>']
// The optional patch is deep-merged into BALANCE to try a variant without editing the config,
// e.g. pnpm sim '{"rooms":{"costGrowth":2}}'. Arrays merge by index: '{"tiers":[{},{"revenue":1e4}]}'.

function merge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (typeof base !== "object" || base === null || typeof patch !== "object" || patch === null) {
    return patch as T;
  }
  if (Array.isArray(base)) {
    return base.map((item, i) => merge(item, (patch as Record<number, unknown>)[i])) as T;
  }
  const record = base as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(patch)) out[key] = merge(record[key], value);
  return out as T;
}

const cfg: Balance = merge(BALANCE, process.argv[2] ? JSON.parse(process.argv[2]) : undefined);

const BOTS = [
  { name: "hardcore (2 min)", interval: 2 * MINUTE },
  { name: "active (30 min)", interval: 30 * MINUTE },
  { name: "casual (8 h)", interval: 8 * HOUR },
];

const fmt = (n: number) =>
  Math.abs(n) >= 1e4 ? n.toExponential(2) : n.toFixed(Math.abs(n) < 10 ? 2 : 0);
const day = (t: number | null | undefined) => (t == null ? "-" : (t / DAY).toFixed(2));

const results: [string, SimResult][] = BOTS.map((b) => [b.name, simulate(b.interval, cfg)]);
const best = results[0]?.[1].final.revenue ?? 1;

console.log("\n## Season summary\n");
console.log(
  "| bot | score (EUR) | vs hardcore | saturated (day) | money idle from day | min money | max number | devs | max level | avg level | rooms | moulis | actions |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [name, r] of results) {
  const f = r.final;
  const levels = f.devs.map((d) => d.level);
  console.log(
    `| ${name} | ${fmt(f.revenue)} | ${((f.revenue / best) * 100).toFixed(0)}% | ${r.saturatedAt === null ? "never" : day(r.saturatedAt)} | ${r.moneyIdleDay ?? "never"} | ${fmt(r.minMoney)} | ${fmt(r.maxMagnitude)}${r.allFinite ? "" : " NaN!"} | ${f.devs.length} | ${Math.max(...levels)} | ${(levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1)} | ${f.rooms} | ${f.stages.map((s) => s.instances).join("/")} | ${r.actions} |`,
  );
}

console.log("\n## Tier unlocks (day)\n");
console.log(`| bot | ${cfg.tiers.map((t) => t.name).join(" | ")} |`);
console.log(`|---|${cfg.tiers.map(() => "---").join("|")}|`);
for (const [name, r] of results) {
  console.log(
    `| ${name} | ${cfg.tiers.map((_, i) => day(r.final.tierUnlockedAt[i])).join(" | ")} |`,
  );
}

console.log(
  "\n## End of each day: cumulative revenue / net income (EUR/s) / avg level, headcount\n",
);
console.log(`| day | ${results.map(([n]) => n).join(" | ")} |`);
console.log(`|---|${results.map(() => "---").join("|")}|`);
const days = results[0]?.[1].daily.length ?? 0;
for (let d = 0; d < days; d++) {
  const cells = results.map(([, r]) => {
    const snap = r.daily[d];
    return snap
      ? `${fmt(snap.revenue)} / ${fmt(snap.netPerSecond)} / L${snap.avgLevel.toFixed(1)}, ${snap.devs}p`
      : "-";
  });
  console.log(`| ${d + 1} | ${cells.join(" | ")} |`);
}

const hc = results[0]?.[1].final;
if (hc) {
  const r = computeRates(hc, cfg);
  console.log(
    `\nhardcore final: quality ${(r.quality * 100).toFixed(0)}%, stages ${r.stages.map((s) => `${fmt(s.processed)}/${fmt(s.capacity)}`).join(" -> ")} LoC/s, strictness ${hc.stages.map((s) => s.strictness).join("/")}`,
  );
}
