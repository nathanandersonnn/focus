import type { Config, Store } from "./store.js";

export type SyncResult =
  | { kind: "not-configured"; queued: number }
  | { kind: "done"; sent: number; queued: number; unauthorized: boolean };

const TIMEOUT_MS = 8000;

export async function flush(store: Store, config: Config, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const pending = store.outbox();
  if (!config.dashboardUrl || !config.deviceKey) {
    return { kind: "not-configured", queued: pending.length };
  }

  const url = new URL("/api/sessions", config.dashboardUrl);
  let sent = 0;
  for (const session of pending) {
    let status: number;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.deviceKey}` },
        body: JSON.stringify(session),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch {
      break;
    }
    if (status === 401) {
      return { kind: "done", sent, queued: pending.length - sent, unauthorized: true };
    }
    if (status !== 200) break;
    store.dequeue(session.id);
    sent += 1;
  }
  return { kind: "done", sent, queued: pending.length - sent, unauthorized: false };
}

export function describeSync(result: SyncResult, store: Store): string {
  if (result.kind === "not-configured") {
    return `Dashboard not set up yet; ${result.queued} session(s) saved locally. Add dashboardUrl and deviceKey to ${store.configPath}.`;
  }
  if (result.unauthorized) return `Dashboard rejected the device key; ${result.queued} session(s) still queued. Check deviceKey in ${store.configPath}.`;
  if (result.queued > 0) return `Synced ${result.sent}; ${result.queued} still queued (dashboard unreachable). They'll retry next session.`;
  return result.sent > 0 ? `Synced ${result.sent} session(s) to the dashboard.` : "Dashboard up to date.";
}
