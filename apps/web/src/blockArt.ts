// Turns the Mouli Check's block characters into rectangles. Drawn as SVG, the challenge no longer
// depends on the font: Consolas has no quadrant characters (▗▖▐▌), and the fallback font has
// another width, which breaks the columns apart.

/** Quadrant bits: 1 top left, 2 top right, 4 bottom left, 8 bottom right. */
const QUADRANTS: Record<string, number> = {
  " ": 0,
  "▘": 1,
  "▝": 2,
  "▀": 3,
  "▖": 4,
  "▌": 5,
  "▞": 6,
  "▛": 7,
  "▗": 8,
  "▚": 9,
  "▐": 10,
  "▜": 11,
  "▄": 12,
  "▙": 13,
  "▟": 14,
  "█": 15,
};

export interface BlockArt {
  /** One SVG path, a unit square per filled quadrant. */
  path: string;
  /** Size in quadrants. */
  width: number;
  height: number;
}

/** Any other visible character is drawn as a full block. */
export function blockArt(rows: readonly string[]): BlockArt {
  let path = "";
  let width = 0;
  rows.forEach((row, y) => {
    const cells = [...row];
    width = Math.max(width, cells.length * 2);
    cells.forEach((ch, x) => {
      const bits = QUADRANTS[ch] ?? (ch.trim() ? 15 : 0);
      for (let q = 0; q < 4; q++) {
        if (bits & (1 << q)) path += `M${x * 2 + (q & 1)} ${y * 2 + (q >> 1)}h1v1h-1z`;
      }
    });
  });
  return { path, width, height: rows.length * 2 };
}
