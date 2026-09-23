import { describe, expect, it } from "vitest";
import type { Mode } from "@focus/core";
import { abandon, finish, pause, resume, recordBlocks, recoverStale, startSession, tick, toSession, type SessionState } from "../src/session.js";

const MIN = 60_000;
const T0 = Date.parse("2026-09-14T10:00:00.000Z");
const fresh = (plannedMin: number | null = 60, mode: Mode = "regular") =>
  startSession({ id: "abc", localDate: "2026-09-14", plannedMin, mode, now: T0 });

// Simulate timer cadence; a single large jump represents suspension.
function work(state: SessionState, minutes: number): SessionState {
  const until = state.lastTickAt + minutes * MIN;
  for (let now = state.lastTickAt + 1000; now <= until; now += 1000) state = tick(state, now);
  return state;
}

describe("study time", () => {
  it.each<Mode>(["regular", "deep"])("counts uninterrupted reading (%s)", (mode) => {
    const s = work(fresh(60, mode), 8);
    expect(s.status).toBe("running");
    expect(s.focusedMs).toBe(8 * MIN);
    expect(s.pauses).toEqual([]);
  });

  it("caps time at the target when the final tick is late", () => {
    const s = tick(work(fresh(30), 29.9), T0 + 30 * MIN + 1000);
    expect(s.status).toBe("completed");
    expect(s.focusedMs).toBe(30 * MIN);
    expect(s.endedAt).toBe(T0 + 30 * MIN);
    expect(tick(s, T0 + 90 * MIN)).toBe(s);
  });

  it("keeps open-ended sessions running until finished", () => {
    const s = work(fresh(null), 700);
    expect(s.status).toBe("running");
    expect(toSession(finish(s, s.lastTickAt))).toMatchObject({ plannedMin: null, focusedMs: 700 * MIN, outcome: "completed" });
  });

  it("does not move recorded time backwards with the wall clock", () => {
    const s = work(fresh(), 2);
    expect(tick(s, T0 + MIN)).toEqual(s);
  });
});

describe("breaks and interrupted timers", () => {
  it("pauses immediately and resumes explicitly without counting the break", () => {
    const before = work(fresh(), 2);
    let s = pause(before, before.lastTickAt);
    s = tick(s, T0 + 20 * MIN);
    expect(s.focusedMs).toBe(2 * MIN);
    expect(s.status).toBe("paused");
    s = work(resume(s, T0 + 20 * MIN), 3);
    expect(s.focusedMs).toBe(5 * MIN);
    expect(s.pauses).toEqual([{ from: T0 + 2 * MIN, to: T0 + 20 * MIN }]);
    expect(before.pauses).toEqual([]);
  });

  it("excludes sleep even when input arrives before the first resumed tick", () => {
    const before = work(fresh(), 10);
    const wake = T0 + 120 * MIN;
    const s = tick(before, wake);
    expect(s.status).toBe("paused");
    expect(s.focusedMs).toBe(10 * MIN);
    expect(s.pauses).toEqual([{ from: before.lastTickAt }]);
    expect(work(resume(s, wake), 1).focusedMs).toBe(11 * MIN);
  });

  it("excludes sleep when a resume or stop key arrives before the timer", () => {
    const s = work(fresh(), 10);
    const wake = T0 + 120 * MIN;
    expect(resume(s, wake).focusedMs).toBe(10 * MIN);
    expect(abandon(s, wake, "done").focusedMs).toBe(10 * MIN);
    expect(finish(s, wake).focusedMs).toBe(10 * MIN);
  });

  it("does not add overlapping pauses or mutate earlier states", () => {
    const s = pause(work(fresh(), 2), T0 + 2 * MIN);
    const stillPaused = pause(s, T0 + 20 * MIN);
    const running = resume(stillPaused, T0 + 21 * MIN);
    expect(stillPaused.pauses).toEqual([{ from: T0 + 2 * MIN }]);
    expect(running.pauses).toEqual([{ from: T0 + 2 * MIN, to: T0 + 21 * MIN }]);
  });
});

describe("ending and recovery", () => {
  it.each<Mode>(["regular", "deep"])("preserves time and reason when ending early (%s)", (mode) => {
    const s = abandon(work(fresh(60, mode), 12), T0 + 12 * MIN, "appointment");
    expect(toSession(s)).toMatchObject({ focusedMs: 12 * MIN, mode, outcome: "abandoned", reason: "appointment" });
  });

  it("closes an open pause without counting it", () => {
    const s = pause(work(fresh(), 2), T0 + 2 * MIN);
    const ended = abandon(s, T0 + 30 * MIN, "done");
    expect(ended.focusedMs).toBe(2 * MIN);
    expect(ended.pauses).toEqual([{ from: T0 + 2 * MIN, to: T0 + 30 * MIN }]);
  });

  it("records completion if the target is reached as the stop key arrives", () => {
    const s = work(fresh(30), 29.9);
    expect(abandon(s, T0 + 30 * MIN, "done").status).toBe("completed");
  });

  it("recovers only through the saved tick, including paused sessions", () => {
    const s = work(fresh(), 15);
    expect(toSession(recoverStale(s))).toMatchObject({ focusedMs: 15 * MIN, outcome: "abandoned", reason: "agent closed", endedAt: new Date(s.lastTickAt).toISOString() });
    const paused = tick(pause(s, s.lastTickAt), T0 + 30 * MIN);
    expect(recoverStale(paused).focusedMs).toBe(15 * MIN);
  });

  it("preserves a completed snapshot during recovery", () => {
    const s = work(fresh(1), 1);
    expect(recoverStale(s)).toBe(s);
  });

  it("exports timestamps, mode, and block results", () => {
    let s = work(fresh(30, "deep"), 1);
    s = recordBlocks(s, s.lastTickAt, [{ app: "Steam", killed: true }, { app: "Discord", killed: false }]);
    s = work(s, 29);
    expect(toSession(s)).toMatchObject({
      mode: "deep", outcome: "completed", focusedMs: 30 * MIN,
      startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 30 * MIN).toISOString(),
      blocks: [{ app: "Steam", killed: true, at: new Date(T0 + MIN).toISOString() }, { app: "Discord", killed: false, at: new Date(T0 + MIN).toISOString() }],
    });
  });

  it("refuses to export an unfinished session", () => {
    expect(() => toSession(fresh())).toThrow();
  });
});
