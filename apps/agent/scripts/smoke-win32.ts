import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { sweep } from "../src/blocker.js";
import { killProcess, listProcesses } from "../src/win32.js";

const procs = listProcesses();
console.log(`listProcesses: ${procs.length} processes, e.g. ${procs.slice(0, 3).map((p) => p.name).join(", ")}`);

if (procs.some((p) => p.name.toLowerCase() === "notepad.exe")) {
  console.log("Notepad is already open; refusing to kill it. Close Notepad and re-run.");
  process.exit(2);
}

spawn("notepad.exe", { detached: true, stdio: "ignore" }).unref();
await sleep(2500);

const before = listProcesses().filter((p) => p.name.toLowerCase() === "notepad.exe");
console.log(`notepad running before sweep: ${before.length}`);

const results = sweep({ Notepad: ["notepad.exe"] }, listProcesses, killProcess);
console.log("sweep results:", JSON.stringify(results));

await sleep(1000);
const after = listProcesses().filter((p) => p.name.toLowerCase() === "notepad.exe");
console.log(`notepad running after sweep: ${after.length}`);
process.exit(before.length > 0 && after.length === 0 ? 0 : 1);
