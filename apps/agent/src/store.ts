import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session } from "@focus/core";
import { DEFAULT_BLOCKLIST, type Blocklist } from "./blocker.js";
import { recoverStale, toSession, type SessionState } from "./session.js";

export type Config = {
  blocklist: Blocklist;
  dashboardUrl?: string;
  deviceKey?: string;
  startUrl?: string;
};

export type Active = { pid: number; state: SessionState };

export type Store = ReturnType<typeof createStore>;

// Not %LOCALAPPDATA%: Windows redirects AppData writes from packaged apps (e.g. the Claude desktop app's
// shell) into a private copy, so a normal terminal would see a different config.
export function defaultDir(): string {
  return join(homedir(), ".focus");
}

export function createStore(dir: string) {
  const outboxDir = join(dir, "outbox");
  const configPath = join(dir, "config.json");
  const activePath = join(dir, "active.json");
  mkdirSync(outboxDir, { recursive: true });

  function writeJson(path: string, value: unknown) {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, path);
  }

  function readJson<T>(path: string): T | null {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`Could not read ${path}; the file has been preserved.`, { cause: err });
    }
  }

  return {
    configPath,

    loadConfig(): Config {
      const existing = readJson<Partial<Config>>(configPath);
      if (!existing) {
        const fresh: Config = { blocklist: DEFAULT_BLOCKLIST, dashboardUrl: "", deviceKey: "", startUrl: "" };
        writeJson(configPath, fresh);
        return fresh;
      }
      if (existing.startUrl) {
        try {
          if (typeof existing.startUrl !== "string" || !["http:", "https:"].includes(new URL(existing.startUrl).protocol)) {
            throw new Error("invalid URL");
          }
        } catch {
          throw new Error(`startUrl in ${configPath} must be an http(s) URL or an empty string.`);
        }
      }
      return { ...existing, blocklist: existing.blocklist ?? DEFAULT_BLOCKLIST };
    },

    loadActive: () => readJson<Active>(activePath),
    saveActive: (active: Active) => writeJson(activePath, active),
    clearActive: () => rmSync(activePath, { force: true }),

    enqueue: (session: Session) => writeJson(join(outboxDir, `${session.id}.json`), session),
    dequeue: (id: string) => rmSync(join(outboxDir, `${id}.json`), { force: true }),
    outbox(): Session[] {
      return readdirSync(outboxDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJson<Session>(join(outboxDir, f)))
        .filter((s): s is Session => s !== null);
    },
  };
}

// Callers hold the session lock, so no live agent can own the active file. Checking its pid would be
// wrong: Windows reuses process IDs, and an unrelated process could block every later start.
export function recoverIfStale(store: Store): "none" | "recovered" {
  const active = store.loadActive();
  if (!active) return "none";
  store.enqueue(toSession(recoverStale(active.state)));
  store.clearActive();
  return "recovered";
}
