import { readFileSync } from "node:fs";
import { type Modifier, modifierError, type SeasonWeeks, weeksPerSeason } from "@epidle/core";

// Weekly modifiers come from a JSON file written by hand (apps/server/modifiers.json):
// a catalogue and a rotation. A season copies its weeks when it opens, so editing the file
// never changes the rules of a season in progress.

/** The modifier of each week of the server, cycling. Empty: no modifier at all. */
export type Rotation = readonly (Modifier | null)[];

export const NO_MODIFIERS: Rotation = [];

/** Parses and validates the file content. Throws with a readable message on any mistake. */
export function parseRotation(text: string): Rotation {
  const file = JSON.parse(text) as { modifiers?: unknown; rotation?: unknown };
  if (!Array.isArray(file.modifiers)) throw new Error("modifiers must be an array");
  if (!Array.isArray(file.rotation)) throw new Error("rotation must be an array");
  const byId = new Map<string, Modifier>();
  for (const m of file.modifiers) {
    const error = modifierError(m);
    if (error) throw new Error(`modifier ${error}`);
    const modifier = m as Modifier;
    if (byId.has(modifier.id)) throw new Error(`modifier ${modifier.id} defined twice`);
    byId.set(modifier.id, {
      id: modifier.id,
      name: modifier.name,
      description: modifier.description,
      effects: { ...modifier.effects },
    });
  }
  return file.rotation.map((id) => {
    if (id === null) return null;
    const modifier = typeof id === "string" ? byId.get(id) : undefined;
    if (!modifier) throw new Error(`rotation: unknown modifier ${JSON.stringify(id)}`);
    return modifier;
  });
}

export function loadRotation(path: string): Rotation {
  try {
    return parseRotation(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
}

/** The weeks of season `seasonId` (1-based): they follow each other across seasons. */
export function seasonWeeks(rotation: Rotation, seasonId: number): SeasonWeeks {
  const count = weeksPerSeason();
  return Array.from({ length: count }, (_, w) =>
    rotation.length ? (rotation[((seasonId - 1) * count + w) % rotation.length] ?? null) : null,
  );
}
