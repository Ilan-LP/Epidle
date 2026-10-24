import { describe, expect, it } from "vitest";
import { awardText } from "./awards";

describe("awardText", () => {
  it("names every badge with its season", () => {
    expect(awardText({ seasonId: 1, kind: "rank", value: 1 })).toBe("Champion S1");
    expect(awardText({ seasonId: 2, kind: "rank", value: 2 })).toBe("Vice-champion S2");
    expect(awardText({ seasonId: 2, kind: "rank", value: 3 })).toBe("Podium S2");
    expect(awardText({ seasonId: 3, kind: "rank", value: 7 })).toBe("Top 10 S3");
    expect(awardText({ seasonId: 4, kind: "legende", value: 0 })).toBe("Légende S4");
    expect(awardText({ seasonId: 4, kind: "licorne", value: 0 })).toBe("Licorne S4");
  });
});
