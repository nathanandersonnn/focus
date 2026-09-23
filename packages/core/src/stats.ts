import { dayNumber, isWeekday, mondayOf, toLocalDate } from "./dates";
import type { Session, Stats } from "./types";

const MINUTE_MS = 60_000;
const RECENT_LIMIT = 10;

export const QUALIFYING_MS = 15 * MINUTE_MS;
// Deep sessions cannot be ended early, so finishing one earns double.
export const DEEP_MULTIPLIER = 2;

export function computeStats(sessions: Session[], today: string): Stats {
  const todayDay = dayNumber(today);
  const weekStart = mondayOf(todayDay);

  let todayFocusedMs = 0;
  let weekFocusedMs = 0;
  let totalFocusedMs = 0;
  let points = 0;
  const qualifyingDays = new Set<number>();
  const dayMs = new Map<number, number>();
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

    const deepBonus = s.mode === "deep" && s.outcome === "completed";
    points += Math.floor(s.focusedMs / MINUTE_MS) * (deepBonus ? DEEP_MULTIPLIER : 1);
    dayMs.set(day, (dayMs.get(day) ?? 0) + s.focusedMs);
    if (dayMs.get(day)! >= QUALIFYING_MS) qualifyingDays.add(day);

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
    ...computeStreaks(qualifyingDays, todayDay),
    recent: [...sessions]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, RECENT_LIMIT),
    blocksByApp: [...blockCounts]
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app)),
  };
}

function computeStreaks(days: Set<number>, today: number): { currentStreak: number; bestStreak: number } {
  const first = [...days].filter((day) => day <= today).sort((a, b) => a - b)[0];
  let currentStreak = 0;
  let bestStreak = 0;
  let weekendCredits = 0;

  for (let day = first ?? today; day <= today; day += 1) {
    const weekday = isWeekday(day);
    // A new Saturday starts a fresh weekend; credits never accumulate across weeks.
    if (!weekday && isWeekday(day - 1)) weekendCredits = 0;

    if (days.has(day)) {
      currentStreak += 1;
      if (!weekday) weekendCredits += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else if (weekday && day < today) {
      // Today is still in progress. Only completed, missed weekdays need cover.
      if (weekendCredits > 0) weekendCredits -= 1;
      else currentStreak = 0;
    }
  }
  return { currentStreak, bestStreak };
}
