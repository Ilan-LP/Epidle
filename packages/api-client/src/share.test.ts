import { BALANCE, computeRates, createInitialState, type GameState } from "@epidle/core";
import { describe, expect, it } from "vitest";
import type { FeedEvent } from "./api";
import { feedText } from "./feed";
import { effectsText } from "./format";
import { buildLink, shareText } from "./share";

const state = (): GameState => {
  const s = createInitialState();
  s.time = 3.5 * 86400;
  s.revenue = 1.234e9;
  s.tier = 3;
  s.rooms = 6;
  s.devs = [
    { id: 1, kind: "junior", level: 7, training: null },
    { id: 2, kind: "junior", level: 5, training: { targetLevel: 6, levelEndsAt: 1e6 } },
    { id: 3, kind: "junior", level: 5, training: null },
  ];
  s.stages[0] = { instances: 12, version: 2, strictness: 2 };
  return s;
};

describe("shareText", () => {
  it("fits a Discord message: code block, then a clickable link to the build", () => {
    const s = state();
    const text = shareText({
      pseudo: "Minilan",
      p: {
        state: s,
        rates: computeRates(s),
        cfg: BALANCE,
        season: {
          id: 3,
          startsAt: 0,
          endsAt: 0,
          weeks: [{ id: "rush", name: "Semaine Rush", description: "", effects: {} }, null],
        },
        serverNow: 0,
        seasonLeft: 0,
      },
      rank: 4,
      webUrl: "https://epidle.test/",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("```");
    expect(lines[1]).toBe("Epidle · saison 3 · semaine 1/2 (Semaine Rush) · jour 4");
    expect(lines[2]).toBe("Minilan · #4 · Scale-up · 1,23 Md €");
    expect(lines[4]).toBe("Équipe  3 devs : 1 Lead, 2 Tek 4 (1 en formation)");
    expect(lines[5]).toBe("Salles  6 · Moulis LoC x12 v3 Stricte");
    expect(lines.at(-2)).toBe("```");
    expect(lines.at(-1)).toBe("https://epidle.test/#/joueur/Minilan");
    expect(text).not.toMatch(/Argent|money/);
  });

  it("encodes the pseudo in the link", () => {
    expect(buildLink("http://localhost:5173", "a_b-c")).toBe(
      "http://localhost:5173/#/joueur/a_b-c",
    );
  });
});

describe("feed and effects texts", () => {
  const e = (kind: FeedEvent["kind"], value: number, first = false): FeedEvent => ({
    at: 0,
    kind,
    pseudo: "Bob",
    value,
    first,
  });

  it("writes French sentences", () => {
    expect(feedText(e("tier", 5, true))).toBe(
      "Bob ouvre le palier Licorne, une première cette saison",
    );
    expect(feedText(e("tier", 2))).toBe("Bob atteint le palier PME");
    expect(feedText(e("level", 11, true))).toBe("Bob a le premier dev Légende de la saison");
    expect(feedText(e("level", 8))).toBe("Bob a désormais un dev Staff");
    expect(feedText(e("lead", 1))).toBe("Bob prend la tête du classement");
    expect(feedText(e("top10", 7))).toBe("Bob entre dans le top 10, #7");
  });

  it("lists the exact effects of a modifier", () => {
    expect(effectsText({ devSpeed: 1.5, bugs: 1.4, hireCost: 0.6, salary: 1 })).toBe(
      "vitesse des devs +50 %, prix des embauches -40 %, bugs +40 %",
    );
  });
});
