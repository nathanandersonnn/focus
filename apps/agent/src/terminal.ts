import { computeStats, type Session } from "@focus/core";
import type { SessionState } from "./session.js";
import type { StudyMode } from "./modes.js";
import type { Config } from "./store.js";

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function width(): number {
  return (process.stdout.columns ?? 80) - 1;
}

export function draw(line: string) {
  process.stdout.write(`\r${line.slice(0, width()).padEnd(width())}`);
}

export function log(message: string) {
  process.stdout.write(`\r${" ".repeat(width())}\r${message}\n`);
}

export function renderLine(state: SessionState, mode: StudyMode): string {
  const clock =
    state.plannedMin === null
      ? `${fmt(state.focusedMs)} studied`
      : `${fmt(state.plannedMin * 60_000 - state.focusedMs)} left`;
  const parts = [`  [ ${mode.name.toUpperCase()} ]  ${clock}`];
  if (state.status === "paused") parts.push("PAUSED");
  parts.push(state.status === "paused" ? "p = resume" : "p = pause");
  if (!mode.earlyExit) parts.push("no early exit");
  else parts.push(state.plannedMin === null ? "s = finish" : "s = stop");
  const counts = blockCounts(state.blocks);
  if (counts.size > 0) {
    parts.push(`blocked: ${[...counts].map(([app, n]) => `${app} x${n}`).join(", ")}`);
  }
  return parts.join("   |   ");
}

function blockCounts(blocks: { app: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { app } of blocks) counts.set(app, (counts.get(app) ?? 0) + 1);
  return counts;
}

export function printIntro(mode: StudyMode, minutes: number | null, config: Config) {
  const length = minutes === null ? "no time limit, press s when you're done" : `${minutes} min`;
  const blocking = mode.blockApps ? `Blocking ${Object.keys(config.blocklist).join(", ") || "no apps"}` : "App blocking off";
  console.log(`\n  ${mode.label}: ${length}. ${blocking}.`);
  if (mode.openStartPage && config.startUrl) console.log(`  Opening ${config.startUrl}.`);
  if (!mode.completionSound) console.log("  Silent completion. Keep your computer awake to record class time.");
  console.log(`  Reading and thinking count. Press p for a break${mode.earlyExit ? "; s to end." : ". No early exit: finish for double points."}`);
  if (mode.blockApps) console.log("  Apps stay blocked while paused.");
  console.log("");
}

export function printSummary(session: Session) {
  log("");
  const points = computeStats([session], session.localDate).points;
  const label = session.outcome === "completed" ? "Session complete" : "Session ended early";
  console.log(`  ${label}: ${fmt(session.focusedMs)} studied, +${points} points.`);
  if (session.reason) console.log(`  Reason: ${session.reason}`);
  for (const [app, count] of blockCounts(session.blocks)) console.log(`    ${app}: blocked ${count}x`);
}
