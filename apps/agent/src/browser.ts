import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Store } from "./store.js";

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
];

export function openInBrowser(url: string) {
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  const [cmd, args] = chrome ? [chrome, [url]] : ["powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:FOCUS_OPEN_URL",
  ]];
  const child = spawn(cmd, args, {
    detached: true, stdio: "ignore", windowsHide: true,
    env: { ...process.env, FOCUS_OPEN_URL: url },
  });
  child.on("error", (err) => console.error(`Could not open browser: ${err.message}`));
  child.unref();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function openDashboard(store: Store) {
  const config = store.loadConfig();
  if (!config.dashboardUrl || !config.deviceKey) {
    throw new Error(`Dashboard not set up yet. Add dashboardUrl and deviceKey to ${store.configPath}.`);
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
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("The browser never loaded the sign-in page. Is Chrome or a default browser installed?"));
    }, 60_000);
    server.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
