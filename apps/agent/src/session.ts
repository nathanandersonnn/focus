import type { Session } from "@focus/core";

export const IDLE_MS = 5 * 60_000;

export type Status = "running" | "paused" | "completed" | "abandoned";

export type SessionState = {
  id: string;
  localDate: string;
  plannedMin: number | null;
  startedAt: number;
  status: Status;
  focusedMs: number;
  pauses: { from: number; to?: number }[];
  blocks: { app: string; at: number; killed: boolean }[];
  lastTickAt: number;
  endedAt?: number;
  reason?: string;
};

export type BlockResult = { app: string; killed: boolean };

export function startSession(opts: {
  id: string;
  localDate: string;
  plannedMin: number | null;
  now: number;
}): SessionState {
  return {
    id: opts.id,
    localDate: opts.localDate,
    plannedMin: opts.plannedMin,
    startedAt: opts.now,
    status: "running",
    focusedMs: 0,
    pauses: [],
    blocks: [],
    lastTickAt: opts.now,
  };
}

export function isEnded(state: SessionState): boolean {
  return state.status === "completed" || state.status === "abandoned";
}

function focusedAt(state: SessionState, t: number): number {
  const paused = state.pauses.reduce((sum, p) => sum + Math.max(0, (p.to ?? t) - p.from), 0);
  return Math.max(0, t - state.startedAt - paused);
}

export function tick(state: SessionState, now: number, lastInputAt: number): SessionState {
  if (isEnded(state)) return state;
  const s: SessionState = { ...state, pauses: state.pauses.map((p) => ({ ...p })) };
  const open = s.pauses.at(-1);

  if (s.status === "paused" && open && lastInputAt > open.from) {
    open.to = lastInputAt;
    s.status = "running";
  }

  if (s.status === "running" && now - lastInputAt >= IDLE_MS) {
    const floor = Math.max(s.startedAt, s.pauses.at(-1)?.to ?? s.startedAt);
    s.pauses.push({ from: Math.max(lastInputAt, floor) });
    s.status = "paused";
  }

  const plannedMs = plannedMsOf(s);
  const focused = focusedAt(s, now);
  if (focused >= plannedMs) {
    s.status = "completed";
    s.focusedMs = plannedMs;
    s.endedAt = now - (focused - plannedMs);
  } else {
    s.focusedMs = focused;
  }
  s.lastTickAt = now;
  return s;
}

function plannedMsOf(state: SessionState): number {
  return state.plannedMin === null ? Infinity : state.plannedMin * 60_000;
}

function endAt(state: SessionState, now: number): SessionState {
  const pauses = state.pauses.map((p) => (p.to === undefined ? { ...p, to: now } : { ...p }));
  const s: SessionState = { ...state, pauses };
  return { ...s, focusedMs: Math.min(focusedAt(s, now), plannedMsOf(s)), endedAt: now, lastTickAt: now };
}

export function abandon(state: SessionState, now: number, reason: string): SessionState {
  if (isEnded(state)) return state;
  return { ...endAt(state, now), status: "abandoned", reason };
}

export function finish(state: SessionState, now: number): SessionState {
  if (isEnded(state)) return state;
  return { ...endAt(state, now), status: "completed" };
}

export function recoverStale(state: SessionState): SessionState {
  return abandon(state, state.lastTickAt, "agent closed");
}

export function recordBlocks(state: SessionState, at: number, results: BlockResult[]): SessionState {
  if (results.length === 0) return state;
  return { ...state, blocks: [...state.blocks, ...results.map((r) => ({ ...r, at }))] };
}

export function toSession(state: SessionState): Session {
  if (!isEnded(state) || state.endedAt === undefined) {
    throw new Error(`Session ${state.id} has not ended`);
  }
  const endedAt = state.endedAt;
  const iso = (t: number) => new Date(t).toISOString();
  return {
    id: state.id,
    localDate: state.localDate,
    startedAt: iso(state.startedAt),
    endedAt: iso(endedAt),
    plannedMin: state.plannedMin,
    focusedMs: state.focusedMs,
    outcome: state.status === "completed" ? "completed" : "abandoned",
    ...(state.reason !== undefined && { reason: state.reason }),
    pauses: state.pauses.map((p) => ({ from: iso(p.from), to: iso(p.to ?? endedAt) })),
    blocks: state.blocks.map((b) => ({ app: b.app, at: iso(b.at), killed: b.killed })),
  };
}
