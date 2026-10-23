import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "./router";

describe("router", () => {
  it("round-trips every route", () => {
    const routes: Route[] = [
      { name: "dashboard" },
      { name: "shop" },
      { name: "leaderboard" },
      { name: "player", pseudo: "Mini_lan-42" },
      { name: "pseudo" },
      { name: "help" },
    ];
    for (const r of routes) expect(parseHash(href(r))).toEqual(r);
  });

  it("defaults to the dashboard", () => {
    expect(parseHash("")).toEqual({ name: "dashboard" });
    expect(parseHash("#/nope")).toEqual({ name: "dashboard" });
    expect(parseHash("#/joueur/")).toEqual({ name: "leaderboard" });
  });
});
