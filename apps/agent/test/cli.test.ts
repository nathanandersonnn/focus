import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeStats, type Session } from "@focus/core";
import { PassThrough } from "node:stream";
import { main } from "../src/cli.js";
import type { Active } from "../src/store.js";
import { startSession, tick } from "../src/session.js";

const mocks = vi.hoisted(() => ({
  store: {
    configPath: "test-config",
    loadConfig: vi.fn(() => ({ blocklist: { Steam: ["steam.exe"] }, startUrl: "https://example.com/study" })),
    loadActive: vi.fn((): Active | null => null),
    saveActive: vi.fn(),
    enqueue: vi.fn(),
    clearActive: vi.fn(),
  },
  sound: vi.fn(() => true),
  kill: vi.fn(() => true),
  list: vi.fn(() => [{ pid: 123, name: "steam.exe" }]),
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
  release: vi.fn(),
  lock: vi.fn<() => (() => void) | null>(),
  flush: vi.fn(async () => ({ kind: "done", sent: 1, queued: 0, unauthorized: false })),
}));

vi.mock("../src/store.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/store.js")>(),
  createStore: () => mocks.store,
  defaultDir: () => "unused",
}));
vi.mock("../src/win32.js", () => ({
  acquireSessionLock: mocks.lock,
  listProcesses: mocks.list,
  killProcess: mocks.kill,
  playCompletionSound: mocks.sound,
}));
vi.mock("../src/sync.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/sync.js")>(),
  flush: mocks.flush,
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

let input: PassThrough;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockReturnValue(mocks.release);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00"));
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  input.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CLI", () => {
  it.each(["class", "start", "deep"])("records %s time and applies its sound and browser behavior", async (command) => {
    const running = main([command, ...(command === "class" ? [] : ["15"])]);
    const startedAt = mocks.store.saveActive.mock.calls[0]![0].state.startedAt as number;
    await vi.advanceTimersByTimeAsync(startedAt + 15 * 60_000 - Date.now());
    if (command === "class") {
      expect(mocks.store.enqueue).not.toHaveBeenCalled();
      input.emit("data", "p");
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      input.emit("data", "s");
    }
    expect(await running).toBe(0);

    expect(mocks.store.enqueue).toHaveBeenCalledTimes(1);
    const session = mocks.store.enqueue.mock.calls[0]![0] as Session;
    const mode = command === "start" ? "regular" : command;
    expect(session).toMatchObject({ focusedMs: 15 * 60_000, mode, outcome: "completed" });
    expect(computeStats([session], session.localDate)).toMatchObject({
      todayFocusedMs: 15 * 60_000,
      weekFocusedMs: 15 * 60_000,
      totalFocusedMs: 15 * 60_000,
      points: command === "deep" ? 30 : 15,
      currentStreak: 1,
    });
    if (command === "class") {
      expect(session).toMatchObject({ plannedMin: null, blocks: [] });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.kill).not.toHaveBeenCalled();
    } else {
      expect(mocks.kill).toHaveBeenCalledWith(123);
    }
    expect(mocks.sound).toHaveBeenCalledTimes(command === "class" ? 0 : 1);
    if (command !== "class") {
      expect(mocks.sound.mock.invocationCallOrder[0]).toBeLessThan(mocks.flush.mock.invocationCallOrder[0]!);
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(command === "class" ? 0 : 1);
    expect(process.stdout.write).not.toHaveBeenCalledWith("\u0007");
    expect(mocks.flush).toHaveBeenCalled();
    expect(mocks.store.clearActive).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });

  it.each([["class", "60"], ["deep"], ["start", "0"], ["start", "601"], ["deep", "1.5"], ["start", "oops"]])(
    "rejects invalid arguments %j before locking or starting a session", async (...args) => {
      expect(await main(args)).toBe(1);
      expect(console.error).toHaveBeenCalled();
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(mocks.store.saveActive).not.toHaveBeenCalled();
    },
  );

  it("shows help without touching stored sessions", async () => {
    expect(await main([])).toBe(0);
    expect(await main(["unknown"])).toBe(1);
    expect(mocks.store.loadConfig).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("refuses a second session while the lock is held", async () => {
    mocks.lock.mockReturnValueOnce(null);
    expect(await main(["class"])).toBe(1);
    expect(mocks.store.saveActive).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases the lock when loading the config fails", async () => {
    mocks.store.loadConfig.mockImplementationOnce(() => { throw new Error("Broken config"); });
    expect(await main(["class"])).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Broken config");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("syncs queued sessions without starting a study session", async () => {
    expect(await main(["sync"])).toBe(0);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.store.saveActive).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("recovers recorded study time before syncing", async () => {
    const now = Date.now();
    const initial = startSession({ id: "interrupted", localDate: "2026-09-22", plannedMin: null, now });
    mocks.store.loadActive.mockReturnValueOnce({ pid: process.pid, state: tick(initial, now + 10_000) });
    expect(await main(["sync"])).toBe(0);
    expect(mocks.store.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      id: "interrupted", focusedMs: 10_000, outcome: "abandoned", reason: "agent closed",
    }));
    expect(mocks.store.clearActive).toHaveBeenCalledTimes(1);
    expect(mocks.store.enqueue.mock.invocationCallOrder[0]).toBeLessThan(mocks.flush.mock.invocationCallOrder[0]!);
  });

  it("ignores s and Ctrl+C during a deep session", async () => {
    const running = main(["deep", "15"]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    input.emit("data", "s");
    input.emit("data", "\u0003");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.store.enqueue).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining("can't end early"));

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await running).toBe(0);
    expect(mocks.store.enqueue).toHaveBeenCalledWith(expect.objectContaining({ mode: "deep", outcome: "completed" }));
  });

  it("still allows s to stop a timed regular session early", async () => {
    const running = main(["start", "15"]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    input.emit("data", "s");
    await vi.advanceTimersByTimeAsync(0);
    input.write("had to leave\n");
    expect(await running).toBe(0);
    expect(mocks.store.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      mode: "regular", outcome: "abandoned", reason: "had to leave",
    }));
  });

  it("recovers a crashed session even when Windows reused its process ID", async () => {
    const now = Date.now();
    const initial = startSession({ id: "crashed", localDate: "2026-09-22", plannedMin: 30, now });
    // The parent process is certainly alive, standing in for an unrelated process holding the old pid.
    mocks.store.loadActive.mockReturnValueOnce({ pid: process.ppid, state: tick(initial, now + 10_000) });
    const running = main(["class"]);
    input.emit("data", "s");
    expect(await running).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.store.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "crashed", reason: "agent closed" }));
    expect(mocks.store.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ mode: "class", outcome: "completed" }));
  });

  it("reports missing dashboard configuration without opening a browser", async () => {
    expect(await main(["dashboard"])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Dashboard not set up yet"));
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
});
