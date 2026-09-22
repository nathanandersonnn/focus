import { dayNumber, isWeekday, mondayOf, nextWeekday, previousWeekday, toLocalDate } from "./dates";
import type { Session, Stats } from "./types";

const MINUTE_MS = 60_000;
const RECENT_LIMIT = 10;

export const QUALIFYING_MS = 15 * MINUTE_MS;
export const DEEP_MULTIPLIER = 2;

export function computeStats(sessions: Session[], today: string): Stats {
  const todayDay = dayNumber(today);
  const weekStart = mondayOf(todayDay);

  let todayFocusedMs = 0;
  let weekFocusedMs = 0;
  let totalFocusedMs = 0;
  let points = 0;
  const qualifyingDays = new Set<number>();
  const blockCounts = new Map<string, number>();
  const weekMs = [0, 0, 0, 0, 0, 0, 0];

  for (const s of sessions) {
    const day = dayNumber(s.localDate);
    totalFocusedMs += s.focusedMs;
    if (day === todayDay) todayFocusedMs += s.focusedMs;
    if (day >= weekStart && day < weekStart + 7) {
      weekFocusedMs += s.focusedMs;
      weekMs[day - weekStart]! += s.focusedMs;
    }

    if (s.outcome === "completed") {
      points += Math.floor(s.focusedMs / MINUTE_MS) * (s.deep ? DEEP_MULTIPLIER : 1);
      if (s.focusedMs >= QUALIFYING_MS && isWeekday(day)) qualifyingDays.add(day);
    }

    for (const b of s.blocks) blockCounts.set(b.app, (blockCounts.get(b.app) ?? 0) + 1);
  }

  return {
    week: weekMs.map((focusedMs, i) => ({
      localDate: toLocalDate(weekStart + i),
      focusedMs,
      qualified: qualifyingDays.has(weekStart + i),
    })),
    todayFocusedMs,
    weekFocusedMs,
    totalFocusedMs,
    points,
    currentStreak: currentStreak(qualifyingDays, todayDay),
    bestStreak: bestStreak(qualifyingDays),
    recent: [...sessions]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, RECENT_LIMIT),
    blocksByApp: [...blockCounts]
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app)),
  };
}

function currentStreak(days: Set<number>, today: number): number {
  // Today still counts as "not over", so a streak survives until a full weekday is missed.
  let cursor = isWeekday(today) && days.has(today) ? today : previousWeekday(today);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousWeekday(cursor);
  }
  return streak;
}

function bestStreak(days: Set<number>): number {
  let best = 0;
  let run = 0;
  let prev: number | undefined;
  for (const day of [...days].sort((a, b) => a - b)) {
    run = prev !== undefined && nextWeekday(prev) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}
