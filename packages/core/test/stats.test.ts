import { describe, expect, it } from "vitest";
import { computeStats, QUALIFYING_MS } from "../src/index.js";
import type { Session } from "../src/index.js";

const MIN = 60_000;

let seq = 0;
function session(localDate: string, over: Partial<Session> = {}): Session {
  seq += 1;
  return {
    id: `s${seq}`,
    localDate,
    startedAt: `${localDate}T10:00:00.000Z`,
    endedAt: `${localDate}T11:00:00.000Z`,
    plannedMin: 60,
    focusedMs: 60 * MIN,
    outcome: "completed",
    pauses: [],
    blocks: [],
    ...over,
  };
}

// 2026-09-14 is a Monday.
const MON = "2026-09-14";
const TUE = "2026-09-15";
const WED = "2026-09-16";
const THU = "2026-09-17";
const FRI = "2026-09-18";
const SAT = "2026-09-19";
const SUN = "2026-09-20";
const NEXT_MON = "2026-09-21";
const PREV_FRI = "2026-09-11";

describe("points", () => {
  it("awards one point per whole focused minute on completed sessions", () => {
    const stats = computeStats([session(MON, { focusedMs: 61.9 * MIN })], MON);
    expect(stats.points).toBe(61);
  });

  it("awards nothing for abandoned sessions", () => {
    const stats = computeStats(
      [session(MON, { outcome: "abandoned", reason: "gaming", focusedMs: 40 * MIN })],
      MON,
    );
    expect(stats.points).toBe(0);
  });

  it("awards points for weekend sessions", () => {
    expect(computeStats([session(SAT)], SAT).points).toBe(60);
  });
});

describe("time totals", () => {
  it("counts abandoned time toward today, week, and total", () => {
    const stats = computeStats(
      [
        session(MON, { focusedMs: 30 * MIN }),
        session(MON, { outcome: "abandoned", reason: "x", focusedMs: 10 * MIN }),
      ],
      MON,
    );
    expect(stats.todayFocusedMs).toBe(40 * MIN);
    expect(stats.weekFocusedMs).toBe(40 * MIN);
    expect(stats.totalFocusedMs).toBe(40 * MIN);
  });

  it("scopes the week to Monday through Sunday containing today", () => {
    const stats = computeStats(
      [session(PREV_FRI), session(MON), session(SUN)],
      SUN,
    );
    expect(stats.weekFocusedMs).toBe(120 * MIN);
    expect(stats.totalFocusedMs).toBe(180 * MIN);
    expect(stats.todayFocusedMs).toBe(60 * MIN);
  });
});

describe("streaks", () => {
  it("counts consecutive qualifying weekdays", () => {
    const stats = computeStats([session(MON), session(TUE), session(WED)], WED);
    expect(stats.currentStreak).toBe(3);
  });

  it("skips weekends without breaking the streak", () => {
    const stats = computeStats([session(THU), session(FRI), session(NEXT_MON)], NEXT_MON);
    expect(stats.currentStreak).toBe(3);
  });

  it("does not let weekend sessions extend a streak", () => {
    const stats = computeStats([session(FRI), session(SAT), session(SUN)], SUN);
    expect(stats.currentStreak).toBe(1);
  });

  it("breaks on a missed weekday", () => {
    const stats = computeStats([session(MON), session(WED)], WED);
    expect(stats.currentStreak).toBe(1);
  });

  it("keeps the streak alive on a weekday with no session yet", () => {
    const stats = computeStats([session(MON), session(TUE)], WED);
    expect(stats.currentStreak).toBe(2);
  });

  it("is zero once a full weekday has been missed", () => {
    const stats = computeStats([session(MON)], WED);
    expect(stats.currentStreak).toBe(0);
  });

  it("counts through Friday when today is the weekend", () => {
    const stats = computeStats([session(THU), session(FRI)], SAT);
    expect(stats.currentStreak).toBe(2);
  });

  it("requires a completed session of at least 25 focused minutes", () => {
    const short = session(TUE, { focusedMs: QUALIFYING_MS - 1 });
    const abandoned = session(WED, { outcome: "abandoned", reason: "x" });
    expect(computeStats([session(MON), short], TUE).currentStreak).toBe(1);
    expect(computeStats([session(MON), session(TUE), abandoned], WED).currentStreak).toBe(2);
    expect(computeStats([session(MON, { focusedMs: QUALIFYING_MS })], MON).currentStreak).toBe(1);
  });

  it("assigns a midnight-crossing session to its start localDate", () => {
    const late = session(MON, {
      startedAt: "2026-09-14T23:30:00.000-07:00",
      endedAt: "2026-09-15T00:30:00.000-07:00",
    });
    expect(computeStats([late], TUE).currentStreak).toBe(1);
  });

  it("tracks the best streak across history", () => {
    const stats = computeStats(
      [session("2026-09-01"), session("2026-09-02"), session("2026-09-03"), session(MON)],
      MON,
    );
    expect(stats.bestStreak).toBe(3);
    expect(stats.currentStreak).toBe(1);
  });

  it("links the best streak across a weekend", () => {
    const stats = computeStats([session(FRI), session(NEXT_MON)], "2026-09-23");
    expect(stats.bestStreak).toBe(2);
    expect(stats.currentStreak).toBe(0);
  });

  it("returns zeros with no sessions", () => {
    const stats = computeStats([], MON);
    expect(stats).toMatchObject({ points: 0, currentStreak: 0, bestStreak: 0, totalFocusedMs: 0 });
  });
});

describe("recent and blocks", () => {
  it("lists the 10 most recent sessions, newest first", () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session(MON, { startedAt: `2026-09-14T${String(i).padStart(2, "0")}:00:00.000Z` }),
    );
    const stats = computeStats(sessions, MON);
    expect(stats.recent).toHaveLength(10);
    expect(stats.recent[0]?.startedAt).toBe("2026-09-14T11:00:00.000Z");
  });

  it("tallies blocks by app, most frequent first, including failed kills", () => {
    const at = "2026-09-14T10:05:00.000Z";
    const stats = computeStats(
      [
        session(MON, {
          blocks: [
            { app: "Steam", at, killed: true },
            { app: "Discord", at, killed: true },
            { app: "Discord", at, killed: false },
          ],
        }),
      ],
      MON,
    );
    expect(stats.blocksByApp).toEqual([
      { app: "Discord", count: 2 },
      { app: "Steam", count: 1 },
    ]);
  });
});
