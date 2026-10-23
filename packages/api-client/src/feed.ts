import type { FeedEvent } from "./api";
import { levelName, tierName } from "./format";

// French sentences for the weekly feed, shared by both clients.

export function feedText(e: FeedEvent): string {
  switch (e.kind) {
    case "tier":
      return e.first
        ? `${e.pseudo} ouvre le palier ${tierName(e.value)}, une première cette saison`
        : `${e.pseudo} atteint le palier ${tierName(e.value)}`;
    case "level":
      return e.first
        ? `${e.pseudo} a le premier dev ${levelName(e.value)} de la saison`
        : `${e.pseudo} a désormais un dev ${levelName(e.value)}`;
    case "lead":
      return `${e.pseudo} prend la tête du classement`;
    case "top10":
      return `${e.pseudo} entre dans le top 10, #${e.value}`;
  }
}

/** "lun. 14:05" in the player's time zone: the feed only covers one week. */
export function feedTime(at: number): string {
  const d = new Date(at);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short" });
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
