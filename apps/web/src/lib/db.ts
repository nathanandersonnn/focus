import { neon } from "@neondatabase/serverless";
import type { Session } from "@focus/core";

type Row = {
  id: string;
  local_date: string;
  started_at: string | Date;
  ended_at: string | Date;
  planned_min: number | null;
  focused_ms: string | number;
  outcome: Session["outcome"];
  deep: boolean;
  reason: string | null;
  pauses: Session["pauses"];
  blocks: Session["blocks"];
};

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

let tableReady: Promise<unknown> | undefined;

async function createOrMigrate(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS sessions (
      id          text PRIMARY KEY,
      local_date  text        NOT NULL,
      started_at  timestamptz NOT NULL,
      ended_at    timestamptz NOT NULL,
      planned_min integer,
      focused_ms  bigint      NOT NULL,
      outcome     text        NOT NULL,
      deep        boolean     NOT NULL DEFAULT false,
      reason      text,
      pauses      jsonb       NOT NULL,
      blocks      jsonb       NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )`;
  // Tables created before open-ended sessions had planned_min NOT NULL. Idempotent.
  await db`ALTER TABLE sessions ALTER COLUMN planned_min DROP NOT NULL`;
  await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deep boolean NOT NULL DEFAULT false`;
}

function ensureTable(): Promise<unknown> {
  tableReady ??= createOrMigrate().catch((err: unknown) => {
    tableReady = undefined;
    throw err;
  });
  return tableReady;
}

export async function insertSession(s: Session): Promise<void> {
  await ensureTable();
  await sql()`
    INSERT INTO sessions
      (id, local_date, started_at, ended_at, planned_min, focused_ms, outcome, deep, reason, pauses, blocks)
    VALUES
      (${s.id}, ${s.localDate}, ${s.startedAt}, ${s.endedAt}, ${s.plannedMin}, ${s.focusedMs},
       ${s.outcome}, ${s.deep}, ${s.reason ?? null}, ${JSON.stringify(s.pauses)}::jsonb, ${JSON.stringify(s.blocks)}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
}

export async function listSessions(): Promise<Session[]> {
  await ensureTable();
  const rows = (await sql()`SELECT * FROM sessions ORDER BY started_at`) as Row[];
  return rows.map((r) => ({
    id: r.id,
    localDate: r.local_date,
    startedAt: new Date(r.started_at).toISOString(),
    endedAt: new Date(r.ended_at).toISOString(),
    plannedMin: r.planned_min,
    focusedMs: Number(r.focused_ms),
    outcome: r.outcome,
    deep: r.deep,
    ...(r.reason !== null && { reason: r.reason }),
    pauses: r.pauses,
    blocks: r.blocks,
  }));
}
