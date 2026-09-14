import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { computeStats } from "@focus/core";
import { sweep } from "./blocker.js";
import {
  abandon,
  finish,
  isEnded,
  recordBlocks,
  recoverStale,
  startSession,
  tick,
  toSession,
  type SessionState,
} from "./session.js";
import { createStore, defaultDir, isProcessAlive, type Config, type Store } from "./store.js";
import { flush, type SyncResult } from "./sync.js";
import { killProcess, listProcesses, msSinceLastInput } from "./win32.js";

const NEETCODE_URL = "https://neetcode.io/practice";
const TICK_MS = 1000;
const SAVE_EVERY_MS = 5000;
const STALE_AFTER_MS = 30_000;
const MAX_MINUTES = 600;

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
];

function localDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA");
}

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

function draw(line: string) {
  process.stdout.write(`\r${line.slice(0, width()).padEnd(width())}`);
}

function log(message: string) {
  process.stdout.write(`\r${" ".repeat(width())}\r${message}\n`);
}

function openInBrowser(url: string) {
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  const [cmd, args] = chrome ? [chrome, [url]] : ["cmd", ["/c", "start", "", url]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

function recoverIfStale(store: Store): "none" | "running" | "recovered" {
  const active = store.loadActive();
  if (!active) return "none";
  const fresh = Date.now() - active.state.lastTickAt < STALE_AFTER_MS;
  if (active.pid !== process.pid && fresh && isProcessAlive(active.pid)) return "running";
  store.enqueue(toSession(recoverStale(active.state)));
  store.clearActive();
  return "recovered";
}

function describeSync(result: SyncResult, store: Store): string {
  if (result.kind === "not-configured") {
    return `Dashboard not set up yet; ${result.queued} session(s) saved locally. Add dashboardUrl and deviceKey to ${store.configPath}.`;
  }
  if (result.unauthorized) return `Dashboard rejected the device key; ${result.queued} session(s) still queued. Check deviceKey in ${store.configPath}.`;
  if (result.queued > 0) return `Synced ${result.sent}; ${result.queued} still queued (dashboard unreachable). They'll retry next session.`;
  return result.sent > 0 ? `Synced ${result.sent} session(s) to the dashboard.` : "Dashboard up to date.";
}

function renderLine(state: SessionState): string {
  const clock =
    state.plannedMin === null
      ? `${fmt(state.focusedMs)} focused`
      : `${fmt(state.plannedMin * 60_000 - state.focusedMs)} left`;
  const parts = [`  [ FOCUS ]  ${clock}`];
  if (state.status === "paused") parts.push("PAUSED (idle)");
  const counts = new Map<string, number>();
  for (const b of state.blocks) counts.set(b.app, (counts.get(b.app) ?? 0) + 1);
  if (counts.size > 0) {
    parts.push(`blocked: ${[...counts].map(([app, n]) => `${app} x${n}`).join(", ")}`);
  }
  parts.push(state.plannedMin === null ? "s = finish" : "s = stop");
  return parts.join("   |   ");
}

function runSession(store: Store, config: Config, initial: SessionState): Promise<SessionState> {
  return new Promise((resolve) => {
    let state = initial;
    let lastSave = Date.now();
    let prompting = false;
    const warned = new Set<string>();
    const stdin = process.stdin;

    const end = (final: SessionState) => {
      clearInterval(timer);
      store.saveActive({ pid: process.pid, state: final });
      if (stdin.isTTY) {
        stdin.off("data", onKey);
        stdin.setRawMode(false);
      }
      stdin.pause();
      resolve(final);
    };

    const timer = setInterval(() => {
      const now = Date.now();
      const results = sweep(config.blocklist, listProcesses, killProcess);
      state = recordBlocks(state, now, results);
      state = tick(state, now, now - msSinceLastInput());

      if (!prompting) {
        const stamp = new Date(now).toLocaleTimeString();
        for (const r of results) {
          if (r.killed) log(`  ${stamp}  blocked ${r.app}`);
          else if (!warned.has(r.app)) {
            warned.add(r.app);
            log(`  ${stamp}  couldn't close ${r.app} (it may be protected by anti-cheat)`);
          }
        }
      }

      if (isEnded(state)) return end(state);
      if (now - lastSave >= SAVE_EVERY_MS) {
        store.saveActive({ pid: process.pid, state });
        lastSave = now;
      }
      if (!prompting) draw(renderLine(state));
    }, TICK_MS);

    async function onKey(key: string) {
      if (prompting || (key !== "s" && key !== "S" && key !== "\u0003")) return;
      if (state.plannedMin === null) return end(finish(state, Date.now()));
      prompting = true;
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      log("");

      const rl = createInterface({ input: stdin, output: process.stdout });
      const abort = new AbortController();
      rl.on("SIGINT", () => abort.abort());
      let reason = "";
      try {
        reason = (await rl.question("  Stopping early. Why? (press Enter with nothing to keep going) ", { signal: abort.signal })).trim();
      } catch {
        reason = "";
      }
      rl.close();

      if (isEnded(state)) return;
      if (reason) return end(abandon(state, Date.now(), reason));

      log("  Back to it.");
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onKey);
      prompting = false;
    }

    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.resume();
      stdin.on("data", onKey);
    }
  });
}

async function start(store: Store, rawMinutes: string | undefined) {
  const minutes = rawMinutes === undefined ? null : Number(rawMinutes);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)) {
    console.error(`Usage: focus start [minutes]   (whole minutes, 1-${MAX_MINUTES}; leave out to run until you press s)`);
    process.exit(1);
  }

  const config = store.loadConfig();
  const stale = recoverIfStale(store);
  if (stale === "running") {
    console.error("A session is already running in another window.");
    process.exit(1);
  }
  if (stale === "recovered") console.log("  Your last session was closed without finishing; it's recorded as abandoned.");
  const pre = await flush(store, config);
  if (pre.kind === "done" && pre.unauthorized) console.log(`  ${describeSync(pre, store)}`);

  let state = startSession({ id: randomUUID(), localDate: localDate(), plannedMin: minutes, now: Date.now() });
  store.saveActive({ pid: process.pid, state });
  openInBrowser(NEETCODE_URL);

  console.log("");
  const length = minutes === null ? "no time limit, press s when you're done" : `${minutes} min`;
  console.log(`  Focus: ${length}. Blocking ${Object.keys(config.blocklist).join(", ")}.`);
  console.log(`  Opened ${NEETCODE_URL}. Idle for 5 min pauses the clock.`);
  console.log("");

  state = await runSession(store, config, state);

  const session = toSession(state);
  store.enqueue(session);
  store.clearActive();
  const result = await flush(store, config);

  log("");
  if (session.outcome === "completed") {
    const points = computeStats([session], session.localDate).points;
    console.log(`  Session complete: ${fmt(session.focusedMs)} focused, +${points} points.`);
  } else {
    console.log(`  Session abandoned after ${fmt(session.focusedMs)} focused. Reason: ${session.reason}`);
  }
  const counts = new Map<string, number>();
  for (const b of session.blocks) counts.set(b.app, (counts.get(b.app) ?? 0) + 1);
  for (const [app, n] of counts) console.log(`    ${app}: blocked ${n}x`);
  console.log(`  ${describeSync(result, store)}`);
  console.log("");
  process.exit(0);
}

async function sync(store: Store) {
  const config = store.loadConfig();
  const stale = recoverIfStale(store);
  if (stale === "recovered") console.log("An unfinished session was recorded as abandoned.");
  if (stale === "running") console.log("A session is running; it will sync itself when it ends.");
  console.log(describeSync(await flush(store, config), store));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function dashboard(store: Store) {
  const config = store.loadConfig();
  if (!config.dashboardUrl || !config.deviceKey) {
    console.error(`Dashboard not set up yet. Add dashboardUrl and deviceKey to ${store.configPath}.`);
    process.exit(1);
  }
  const action = new URL("/api/auth/device", config.dashboardUrl).toString();
  // A POSTed form keeps the key out of the URL, browser history, and server logs.
  const page =
    `<!doctype html><meta charset="utf-8"><title>Signing in to Focus</title>` +
    `<form id="f" method="post" action="${escapeHtml(action)}">` +
    `<input type="hidden" name="key" value="${escapeHtml(config.deviceKey)}"></form>` +
    `<script>document.getElementById("f").submit()</script>`;

  // Served over loopback rather than as a .html file, which Windows may open in an editor.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page);
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  openInBrowser(`http://127.0.0.1:${port}/`);
  console.log("Opening your dashboard...");
  const timeout = setTimeout(() => {
    console.error("The browser never loaded the sign-in page. Is Chrome or a default browser installed?");
    server.close();
    process.exit(1);
  }, 60_000);
  await new Promise((resolve) => server.on("close", resolve));
  clearTimeout(timeout);
}

const [command, arg] = process.argv.slice(2);
const store = createStore(defaultDir());

if (command === "start") await start(store, arg);
else if (command === "sync") await sync(store);
else if (command === "dashboard") await dashboard(store);
else {
  console.log(
    "Usage:\n  focus start [minutes]   start a focus session (no minutes = run until you press s)\n  focus sync              upload any queued sessions\n  focus dashboard         open the dashboard, signed in",
  );
  process.exit(command ? 1 : 0);
}
