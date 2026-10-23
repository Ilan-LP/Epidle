import { BALANCE, type Modifier, weekIndex, weeksPerSeason } from "@epidle/core";
import type { Projection } from "./projection";

export interface WeekInfo {
  /** 0-based. */
  index: number;
  count: number;
  modifier: Modifier | null;
  /** Next week of this season (null: a normal week), undefined on the last week. */
  next: Modifier | null | undefined;
  /** Seconds until the week ends. */
  left: number;
}

/** The week the projected state is in, for the announcement. */
export function currentWeek(p: Projection): WeekInfo {
  const index = weekIndex(p.state.time);
  const count = weeksPerSeason();
  const end = Math.min((index + 1) * BALANCE.weekSeconds, BALANCE.seasonSeconds);
  return {
    index,
    count,
    modifier: p.season.weeks[index] ?? null,
    next: index + 1 < count ? (p.season.weeks[index + 1] ?? null) : undefined,
    left: Math.max(0, end - p.state.time),
  };
}
