import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@focus/core";
import { createStore, type Store } from "../src/store.js";
import { flush } from "../src/sync.js";
import { startSession } from "../src/session.js";

function session(id: string): Session {
  return {
    id,
    localDate: "2026-09-14",
    startedAt: "2026-09-14T10:00:00.000Z",
    endedAt: "2026-09-14T11:00:00.000Z",
    plannedMin: 60,
    focusedMs: 3_600_000,
    outcome: "completed",
    mode: "regular",
    pauses: [],
    blocks: [],
  };
}

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "focus-test-"));
  store = createStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const configured = { blocklist: {}, dashboardUrl: "https://focus.example", deviceKey: "k" };

function fakeFetch(statuses: number[]) {
  const calls: { url: string; auth: string | null; body: Session }[] = [];
  const impl = (async (url: URL, init: RequestInit) => {
    calls.push({
      url: url.toString(),
      auth: new Headers(init.headers).get("authorization"),
      body: JSON.parse(init.body as string),
    });
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("store", () => {
  it("creates a default config with the blocklist on first load", () => {
    const config = store.loadConfig();
    expect(config.blocklist.Steam).toContain("steamwebhelper.exe");
    expect(config.startUrl).toBe("");
    expect(createStore(dir).loadConfig()).toEqual(config);
  });

  it("preserves a malformed config instead of resetting it", () => {
    writeFileSync(store.configPath, "{broken");
    expect(() => store.loadConfig()).toThrow("preserved");
    expect(readFileSync(store.configPath, "utf8")).toBe("{broken");
  });

  it("loads older configs without requiring an automatic start page", () => {
    writeFileSync(store.configPath, JSON.stringify({ blocklist: {} }));
    expect(store.loadConfig().startUrl).toBeUndefined();
  });

  it("accepts a study page and rejects unsupported launch URLs", () => {
    writeFileSync(store.configPath, JSON.stringify({ startUrl: "https://example.com/study?a=1&b=2" }));
    expect(store.loadConfig().startUrl).toBe("https://example.com/study?a=1&b=2");
    writeFileSync(store.configPath, JSON.stringify({ startUrl: "file:///something.exe" }));
    expect(() => store.loadConfig()).toThrow("http(s)");
  });

  it("round-trips the active session and clears it", () => {
    const state = startSession({ id: "a", localDate: "2026-09-14", plannedMin: 30, now: 0 });
    store.saveActive({ pid: 123, state });
    expect(store.loadActive()).toEqual({ pid: 123, state });
    store.clearActive();
    expect(store.loadActive()).toBeNull();
  });

  it("queues and dequeues sessions", () => {
    store.enqueue(session("x"));
    store.enqueue(session("y"));
    expect(store.outbox().map((s) => s.id).sort()).toEqual(["x", "y"]);
    store.dequeue("x");
    expect(store.outbox().map((s) => s.id)).toEqual(["y"]);
  });
});

describe("flush", () => {
  it("does nothing when the dashboard is not configured", async () => {
    store.enqueue(session("x"));
    const { impl, calls } = fakeFetch([]);
    const result = await flush(store, { blocklist: {} }, impl);
    expect(result).toEqual({ kind: "not-configured", queued: 1 });
    expect(calls).toHaveLength(0);
  });

  it("posts each session with the device key and removes it on 200", async () => {
    store.enqueue(session("x"));
    const { impl, calls } = fakeFetch([200]);
    const result = await flush(store, configured, impl);
    expect(calls[0]).toEqual({ url: "https://focus.example/api/sessions", auth: "Bearer k", body: session("x") });
    expect(result).toEqual({ kind: "done", sent: 1, queued: 0, unauthorized: false });
    expect(store.outbox()).toHaveLength(0);
  });

  it("keeps sessions queued on a server error", async () => {
    store.enqueue(session("x"));
    const result = await flush(store, configured, fakeFetch([500]).impl);
    expect(result).toMatchObject({ sent: 0, queued: 1 });
    expect(store.outbox()).toHaveLength(1);
  });

  it("keeps sessions queued when the network fails", async () => {
    store.enqueue(session("x"));
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await flush(store, configured, failing);
    expect(result).toMatchObject({ sent: 0, queued: 1 });
  });

  it("stops and reports a bad device key without retrying", async () => {
    store.enqueue(session("x"));
    store.enqueue(session("y"));
    const { impl, calls } = fakeFetch([401, 200]);
    const result = await flush(store, configured, impl);
    expect(result).toMatchObject({ unauthorized: true, sent: 0, queued: 2 });
    expect(calls).toHaveLength(1);
  });
});
