import { describe, expect, it } from "vitest";
import {
  IDLE_MS,
  abandon,
  finish,
  recordBlocks,
  recoverStale,
  startSession,
  tick,
  toSession,
} from "../src/session.js";

const MIN = 60_000;
const T0 = Date.parse("2026-09-14T10:00:00.000Z");

function fresh(plannedMin = 60) {
  return startSession({ id: "abc", localDate: "2026-09-14", plannedMin, now: T0 });
}

describe("running", () => {
  it("accumulates focused time while input keeps coming", () => {
    const s = tick(fresh(), T0 + 10 * MIN, T0 + 10 * MIN - 1000);
    expect(s.status).toBe("running");
    expect(s.focusedMs).toBe(10 * MIN);
  });

  it("completes when focused time reaches the target", () => {
    let s = fresh(30);
    s = tick(s, T0 + 30 * MIN, T0 + 30 * MIN);
    expect(s.status).toBe("completed");
    expect(s.focusedMs).toBe(30 * MIN);
  });

  it("does not credit focused time beyond the target", () => {
    const s = tick(fresh(30), T0 + 31 * MIN, T0 + 31 * MIN);
    expect(s.focusedMs).toBe(30 * MIN);
    expect(s.endedAt).toBe(T0 + 30 * MIN);
  });
});

describe("idle pause", () => {
  it("stays running just under the idle threshold", () => {
    const lastInput = T0 + 2 * MIN;
    const s = tick(fresh(), lastInput + IDLE_MS - 1, lastInput);
    expect(s.status).toBe("running");
  });

  it("pauses at the threshold, backdated to the last input", () => {
    const lastInput = T0 + 2 * MIN;
    const s = tick(fresh(), lastInput + IDLE_MS, lastInput);
    expect(s.status).toBe("paused");
    expect(s.pauses).toEqual([{ from: lastInput }]);
    expect(s.focusedMs).toBe(2 * MIN);
  });

  it("never backdates a pause to before the session started", () => {
    const s = tick(fresh(), T0 + IDLE_MS, T0 - 30 * MIN);
    expect(s.pauses).toEqual([{ from: T0 }]);
    expect(s.focusedMs).toBe(0);
  });

  it("stays paused with no new input", () => {
    const lastInput = T0 + 2 * MIN;
    let s = tick(fresh(), lastInput + IDLE_MS, lastInput);
    s = tick(s, T0 + 40 * MIN, lastInput);
    expect(s.status).toBe("paused");
    expect(s.focusedMs).toBe(2 * MIN);
  });

  it("resumes on new input, excluding the whole idle gap", () => {
    const lastInput = T0 + 2 * MIN;
    let s = tick(fresh(), lastInput + IDLE_MS, lastInput);
    const back = T0 + 20 * MIN;
    s = tick(s, back + 4 * MIN, back);
    expect(s.status).toBe("running");
    expect(s.pauses).toEqual([{ from: lastInput, to: back }]);
    expect(s.focusedMs).toBe(2 * MIN + 4 * MIN);
  });

  it("handles a sleep gap like any other idle gap", () => {
    const lastInput = T0 + 10 * MIN;
    const wake = T0 + 120 * MIN;
    const s = tick(fresh(), wake, lastInput);
    expect(s.status).toBe("paused");
    expect(s.focusedMs).toBe(10 * MIN);
  });

  it("does not backdate a second pause into the first pause", () => {
    let s = tick(fresh(), T0 + 2 * MIN + IDLE_MS, T0 + 2 * MIN);
    const back = T0 + 20 * MIN;
    s = tick(s, back, back);
    s = tick(s, back + IDLE_MS, T0 + 2 * MIN);
    expect(s.pauses[1]).toEqual({ from: back });
  });
});

describe("ending early", () => {
  it("abandons with a reason at the current focused time", () => {
    let s = tick(fresh(), T0 + 12 * MIN, T0 + 12 * MIN);
    s = abandon(s, T0 + 12 * MIN, "friends online");
    expect(s.status).toBe("abandoned");
    expect(s.reason).toBe("friends online");
    expect(s.focusedMs).toBe(12 * MIN);
  });

  it("closes an open pause when abandoning", () => {
    let s = tick(fresh(), T0 + 2 * MIN + IDLE_MS, T0 + 2 * MIN);
    s = abandon(s, T0 + 30 * MIN, "done");
    expect(s.pauses).toEqual([{ from: T0 + 2 * MIN, to: T0 + 30 * MIN }]);
    expect(s.focusedMs).toBe(2 * MIN);
  });

  it("recovers a stale session as abandoned at its last saved tick", () => {
    let s = tick(fresh(), T0 + 15 * MIN, T0 + 15 * MIN);
    s = recoverStale(s);
    expect(s.status).toBe("abandoned");
    expect(s.reason).toBe("agent closed");
    expect(s.endedAt).toBe(T0 + 15 * MIN);
    expect(s.focusedMs).toBe(15 * MIN);
  });
});

describe("open-ended sessions", () => {
  const open = () => startSession({ id: "abc", localDate: "2026-09-14", plannedMin: null, now: T0 });

  it("keeps running past any length", () => {
    const s = tick(open(), T0 + 900 * MIN, T0 + 900 * MIN);
    expect(s.status).toBe("running");
    expect(s.focusedMs).toBe(900 * MIN);
  });

  it("still pauses on idle", () => {
    const s = tick(open(), T0 + 2 * MIN + IDLE_MS, T0 + 2 * MIN);
    expect(s.status).toBe("paused");
    expect(s.focusedMs).toBe(2 * MIN);
  });

  it("finishes as completed with all focused time", () => {
    let s = tick(open(), T0 + 40 * MIN, T0 + 40 * MIN);
    s = finish(s, T0 + 40 * MIN);
    expect(s.status).toBe("completed");
    expect(s.focusedMs).toBe(40 * MIN);
    expect(s.endedAt).toBe(T0 + 40 * MIN);
    expect(toSession(s)).toMatchObject({ plannedMin: null, outcome: "completed" });
  });

  it("closes an open pause when finishing", () => {
    let s = tick(open(), T0 + 2 * MIN + IDLE_MS, T0 + 2 * MIN);
    s = finish(s, T0 + 30 * MIN);
    expect(s.pauses).toEqual([{ from: T0 + 2 * MIN, to: T0 + 30 * MIN }]);
    expect(s.focusedMs).toBe(2 * MIN);
  });

  it("does not cap abandoned time", () => {
    const s = abandon(tick(open(), T0 + 700 * MIN, T0 + 700 * MIN), T0 + 700 * MIN, "agent closed");
    expect(s.focusedMs).toBe(700 * MIN);
  });
});

describe("blocks and export", () => {
  it("records one block per app per tick", () => {
    const s = recordBlocks(fresh(), T0 + MIN, [
      { app: "Steam", killed: true },
      { app: "Discord", killed: false },
    ]);
    expect(s.blocks).toEqual([
      { app: "Steam", at: T0 + MIN, killed: true },
      { app: "Discord", at: T0 + MIN, killed: false },
    ]);
  });

  it("exports a core Session with ISO timestamps", () => {
    let s = tick(fresh(30), T0 + 30 * MIN, T0 + 30 * MIN);
    s = recordBlocks(s, T0 + MIN, [{ app: "Steam", killed: true }]);
    expect(toSession(s)).toEqual({
      id: "abc",
      localDate: "2026-09-14",
      startedAt: "2026-09-14T10:00:00.000Z",
      endedAt: "2026-09-14T10:30:00.000Z",
      plannedMin: 30,
      focusedMs: 30 * MIN,
      outcome: "completed",
      pauses: [],
      blocks: [{ app: "Steam", at: "2026-09-14T10:01:00.000Z", killed: true }],
    });
  });

  it("refuses to export a session that has not ended", () => {
    expect(() => toSession(fresh())).toThrow();
  });
});
