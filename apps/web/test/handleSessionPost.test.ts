import { describe, expect, it } from "vitest";
import type { Session } from "@focus/core";
import { handleSessionPost } from "../src/lib/handleSessionPost";

const KEY = "device-key-123";

const valid: Session = {
  id: "0b6c6f1e-3a1f-4a53-9d0e-2f0f6f1f7b11",
  localDate: "2026-09-14",
  startedAt: "2026-09-14T17:00:00.000Z",
  endedAt: "2026-09-14T18:00:00.000Z",
  plannedMin: 60,
  focusedMs: 3_600_000,
  outcome: "completed",
  pauses: [{ from: "2026-09-14T17:10:00.000Z", to: "2026-09-14T17:12:00.000Z" }],
  blocks: [{ app: "Steam", at: "2026-09-14T17:05:00.000Z", killed: true }],
};

function memoryDb() {
  const rows = new Map<string, Session>();
  return {
    rows,
    insert: async (s: Session) => {
      if (!rows.has(s.id)) rows.set(s.id, s);
    },
  };
}

function post(body: unknown, auth: string | null = `Bearer ${KEY}`) {
  return new Request("https://focus.test/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth && { authorization: auth }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/sessions", () => {
  it("stores a valid session", async () => {
    const db = memoryDb();
    const res = await handleSessionPost(post(valid), { deviceKey: KEY, insert: db.insert });
    expect(res.status).toBe(200);
    expect(db.rows.get(valid.id)).toEqual(valid);
  });

  it("stores a session once when it is posted twice", async () => {
    const db = memoryDb();
    const deps = { deviceKey: KEY, insert: db.insert };
    expect((await handleSessionPost(post(valid), deps)).status).toBe(200);
    expect((await handleSessionPost(post(valid), deps)).status).toBe(200);
    expect(db.rows.size).toBe(1);
  });

  it("rejects a wrong or missing device key with 401 and stores nothing", async () => {
    const db = memoryDb();
    const deps = { deviceKey: KEY, insert: db.insert };
    expect((await handleSessionPost(post(valid, "Bearer nope"), deps)).status).toBe(401);
    expect((await handleSessionPost(post(valid, null), deps)).status).toBe(401);
    expect(db.rows.size).toBe(0);
  });

  it("rejects malformed bodies with 400 and stores nothing", async () => {
    const db = memoryDb();
    const deps = { deviceKey: KEY, insert: db.insert };
    expect((await handleSessionPost(post("{not json"), deps)).status).toBe(400);
    expect((await handleSessionPost(post({ ...valid, focusedMs: -5 }), deps)).status).toBe(400);
    expect((await handleSessionPost(post({ ...valid, id: "not-a-uuid" }), deps)).status).toBe(400);
    expect((await handleSessionPost(post({ ...valid, localDate: "09/14/2026" }), deps)).status).toBe(400);
    expect(db.rows.size).toBe(0);
  });

  it("requires a reason for abandoned sessions", async () => {
    const db = memoryDb();
    const deps = { deviceKey: KEY, insert: db.insert };
    expect((await handleSessionPost(post({ ...valid, outcome: "abandoned" }), deps)).status).toBe(400);
    const ok = { ...valid, outcome: "abandoned", reason: "friends online" };
    expect((await handleSessionPost(post(ok), deps)).status).toBe(200);
  });

  it("fails loudly when the server has no device key configured", async () => {
    const res = await handleSessionPost(post(valid), { deviceKey: undefined, insert: memoryDb().insert });
    expect(res.status).toBe(500);
  });
});
