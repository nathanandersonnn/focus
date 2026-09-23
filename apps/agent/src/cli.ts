import { openDashboard } from "./browser.js";
import { parseStudy, USAGE } from "./modes.js";
import { createStore, defaultDir, recoverIfStale } from "./store.js";
import { study } from "./study.js";
import { describeSync, flush } from "./sync.js";
import { printSummary } from "./terminal.js";
import { acquireSessionLock } from "./win32.js";

// Only the executable sets the process exit code; importing commands has no side effects.
export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const [command = "", arg] = args;
  try {
    const options = parseStudy(command, arg);
    if (!options && command !== "sync" && command !== "dashboard") {
      console.log(USAGE);
      return command ? 1 : 0;
    }

    const store = createStore(defaultDir());
    if (command === "dashboard") {
      await openDashboard(store);
      return 0;
    }

    const release = acquireSessionLock(store.configPath);
    if (!release) {
      if (command === "sync") {
        console.log("A Focus session or sync is running; try again after it ends.");
        return 0;
      }
      console.error("Another Focus session or sync is running.");
      return 1;
    }
    try {
      const config = store.loadConfig();
      if (recoverIfStale(store) === "recovered") console.log("An interrupted session was recovered with its recorded study time.");

      const session = options ? await study(store, config, options) : null;
      const result = await flush(store, config);
      if (session) printSummary(session);
      console.log(describeSync(result, store));
      return 0;
    } finally {
      release();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
