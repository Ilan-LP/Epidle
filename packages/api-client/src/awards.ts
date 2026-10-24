// Badges kept across seasons, as the server sends them, and their French names.

export interface Award {
  seasonId: number;
  kind: "rank" | "legende" | "licorne";
  /** Final rank for "rank" (1-10), 0 otherwise. */
  value: number;
}

/** "Champion S1", "Top 10 S3", "Légende S2"... */
export function awardText(a: Award): string {
  const season = `S${a.seasonId}`;
  if (a.kind === "legende") return `Légende ${season}`;
  if (a.kind === "licorne") return `Licorne ${season}`;
  if (a.value === 1) return `Champion ${season}`;
  if (a.value === 2) return `Vice-champion ${season}`;
  if (a.value === 3) return `Podium ${season}`;
  return `Top 10 ${season}`;
}
