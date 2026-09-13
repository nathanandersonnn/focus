import type { BlockResult } from "./session.js";
import type { ProcessInfo } from "./win32.js";

export type Blocklist = Record<string, string[]>;

export const DEFAULT_BLOCKLIST: Blocklist = {
  Discord: ["discord.exe"],
  Steam: ["steam.exe", "steamwebhelper.exe"],
  "War Thunder": ["aces.exe"],
  Squad: ["squadgame.exe"],
};

export function sweep(
  blocklist: Blocklist,
  list: () => ProcessInfo[],
  kill: (pid: number) => boolean,
): BlockResult[] {
  const appByName = new Map<string, string>();
  for (const [app, names] of Object.entries(blocklist)) {
    for (const name of names) appByName.set(name.toLowerCase(), app);
  }

  const outcomes = new Map<string, boolean>();
  for (const proc of list()) {
    const app = appByName.get(proc.name.toLowerCase());
    if (!app) continue;
    const killed = kill(proc.pid);
    outcomes.set(app, (outcomes.get(app) ?? true) && killed);
  }
  return [...outcomes].map(([app, killed]) => ({ app, killed }));
}
