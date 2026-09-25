import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { sweep } from "./blocker.js";
import { openInBrowser } from "./browser.js";
import { abandon, applyIdle, finish, IDLE_RULES, isEnded, pause, resume, recordBlocks, startSession, tick, toSession, type IdleEvent, type SessionState } from "./session.js";
import type { Config, Store } from "./store.js";
import type { StudyOptions, StudyMode } from "./modes.js";
import { draw, log, printIntro, renderLine } from "./terminal.js";
import { killProcess, listProcesses, msSinceLastInput, playCheckInSound, playCompletionSound } from "./win32.js";

const TICK_MS = 1000;
const SAVE_EVERY_MS = 5000;

export async function study(store: Store, config: Config, { mode, minutes }: StudyOptions) {
  const initial = startSession({
    id: randomUUID(),
    localDate: new Date().toLocaleDateString("en-CA"),
    plannedMin: minutes,
    mode: mode.name,
    now: Date.now(),
  });
  store.saveActive({ pid: process.pid, state: initial });
  if (mode.openStartPage && config.startUrl) openInBrowser(config.startUrl);
  printIntro(mode, minutes, config);

  const session = toSession(await runSession(store, config, initial, mode));
  store.enqueue(session);
  store.clearActive();
  // Notify before a slow or offline dashboard can delay completion.
  if (mode.completionSound && session.outcome === "completed" && !playCompletionSound()) {
    process.stdout.write("\u0007");
  }
  return session;
}

function runSession(store: Store, config: Config, initial: SessionState, mode: StudyMode): Promise<SessionState> {
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
      const results = mode.blockApps ? sweep(config.blocklist, listProcesses, killProcess) : [];
      state = recordBlocks(state, now, results);
      const wasRunning = state.status === "running";
      state = tick(state, now);
      if (wasRunning && state.status === "paused" && !prompting) {
        log("  Timer interrupted (sleep or a long delay). Paused; press p to resume.");
      }
      if (mode.idleCheck) {
        const idle = applyIdle(state, now - msSinceLastInput());
        state = idle.state;
        if (idle.event) announceIdle(idle.event);
      }

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
      if (!prompting) draw(renderLine(state, mode));
    }, TICK_MS);

    function announceIdle(event: IdleEvent) {
      if (event === "check" && !playCheckInSound()) process.stdout.write("\u0007");
      if (prompting) return;
      const grace = IDLE_RULES.graceMs / 60_000;
      log({
        check: `  Still studying? Move the mouse or press a key within ${grace} minutes, or the session pauses.`,
        answered: "  Still counting.",
        paused: "  No answer, so the session paused from your last activity. Move the mouse to resume.",
        resumed: "  Welcome back; resumed.",
      }[event]);
    }

    async function onKey(key: string) {
      if (prompting || isEnded(state)) return;
      if (key.toLowerCase() === "p") {
        state = state.status === "paused" ? resume(state, Date.now()) : pause(state, Date.now());
        if (isEnded(state)) return end(state);
        store.saveActive({ pid: process.pid, state });
        draw(renderLine(state, mode));
        return;
      }
      if (key !== "s" && key !== "S" && key !== "\u0003") return;
      if (!mode.earlyExit) {
        log("  Deep sessions can't end early. Press p for a break.");
        return;
      }
      if (state.plannedMin === null) return end(finish(state, Date.now()));
      const wasRunning = state.status === "running";
      state = pause(state, Date.now());
      if (isEnded(state)) return end(state);
      store.saveActive({ pid: process.pid, state });
      prompting = true;
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      log("");

      const rl = createInterface({ input: stdin, output: process.stdout });
      const abort = new AbortController();
      rl.on("SIGINT", () => abort.abort());
      let reason = "";
      try {
        reason = (await rl.question("  Stopping early. Why? (Enter cancels; max 500 characters) ", { signal: abort.signal })).trim();
      } catch {
        reason = "";
      }
      rl.close();

      if (isEnded(state)) return;
      if (reason.length > 500) {
        log("  Reason is too long. Stop cancelled; use 500 characters or fewer.");
      } else if (reason) return end(abandon(state, Date.now(), reason));

      if (wasRunning) state = resume(state, Date.now());
      store.saveActive({ pid: process.pid, state });
      log(wasRunning ? "  Back to it." : "  Still paused. Press p to resume.");
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
