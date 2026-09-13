import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session } from "@focus/core";
import { DEFAULT_BLOCKLIST, type Blocklist } from "./blocker.js";
import type { SessionState } from "./session.js";

export type Config = {
  blocklist: Blocklist;
  dashboardUrl?: string;
  deviceKey?: string;
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
    } catch {
      return null;
    }
  }

  return {
    configPath,

    loadConfig(): Config {
      const existing = readJson<Partial<Config>>(configPath);
      if (!existing) {
        const fresh: Config = { blocklist: DEFAULT_BLOCKLIST, dashboardUrl: "", deviceKey: "" };
        writeJson(configPath, fresh);
        return fresh;
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
