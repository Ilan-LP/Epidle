import { describe, expect, it } from "vitest";
import { bar, formatDuration, formatMoney, formatNumber, formatRate } from "./format";

describe("formatNumber", () => {
  it("keeps small numbers as is", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(12.345, 2)).toBe("12,35");
  });

  it("uses French suffixes with 3 significant digits", () => {
    expect(formatNumber(1234)).toBe("1,23 k");
    expect(formatNumber(12_345)).toBe("12,3 k");
    expect(formatNumber(999_999)).toBe("1,00 M");
    expect(formatNumber(3_000_000)).toBe("3,00 M");
    expect(formatNumber(80_000_000_000)).toBe("80,0 Md");
    expect(formatNumber(-1500)).toBe("-1,50 k");
  });

  it("falls back to scientific notation", () => {
    expect(formatNumber(1.5e21)).toBe("1,50e+21");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("∞");
  });
});

describe("money and rates", () => {
  it("formats euros", () => {
    expect(formatMoney(20)).toBe("20,00 €");
    expect(formatMoney(2500)).toBe("2,50 k €");
  });

  it("signs rates", () => {
    expect(formatRate(4.2)).toBe("+4,20 €/s");
    expect(formatRate(-0.5)).toBe("-0,50 €/s");
    expect(formatRate(24, "LoC")).toBe("+24,0 LoC/s");
  });
});

describe("formatDuration", () => {
  it("picks the two largest units", () => {
    expect(formatDuration(0.2)).toBe("1 s");
    expect(formatDuration(485)).toBe("8 min 05 s");
    expect(formatDuration(7500)).toBe("2 h 05 min");
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe("3 j 04 h");
  });
});

describe("bar", () => {
  it("always has the requested width", () => {
    for (const r of [-1, 0, 0.01, 0.33, 0.5, 0.999, 1, 2, Number.NaN]) {
      expect([...bar(r, 10)]).toHaveLength(10);
    }
  });

  it("fills proportionally", () => {
    expect(bar(0, 4)).toBe("░░░░");
    expect(bar(0.5, 4)).toBe("██░░");
    expect(bar(1, 4)).toBe("████");
    expect(bar(0.5625, 4)).toBe("██▎░");
  });
});
