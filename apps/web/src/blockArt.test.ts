import { describe, expect, it } from "vitest";
import { blockArt } from "./blockArt";

describe("blockArt", () => {
  it("fills one unit square per quadrant", () => {
    expect(blockArt(["▗▖"]).path).toBe("M1 1h1v1h-1zM2 1h1v1h-1z");
    expect(blockArt(["█"]).path.match(/M/g)).toHaveLength(4);
    expect(blockArt(["▚"]).path).toBe("M0 0h1v1h-1zM1 1h1v1h-1z");
  });

  it("sizes the drawing in quadrants, from the longest row", () => {
    expect(blockArt(["▐▌ ", "▐▌"])).toMatchObject({ width: 6, height: 4 });
  });

  it("draws spaces as nothing and unknown characters as full blocks", () => {
    expect(blockArt(["  "]).path).toBe("");
    expect(blockArt(["?"]).path.match(/M/g)).toHaveLength(4);
  });
});
