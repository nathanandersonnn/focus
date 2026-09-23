import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "win32")("Windows session lock", () => {
  it("excludes another process and releases ownership for the next session", async () => {
    const { acquireSessionLock } = await import("../src/win32.js");
    const identity = `focus-test-${randomUUID()}`;
    const release = acquireSessionLock(identity);
    expect(release).not.toBeNull();
    const source = new URL("../src/win32.ts", import.meta.url).href;
    const probe = () => spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { acquireSessionLock } from ${JSON.stringify(source)};
       const release = acquireSessionLock(${JSON.stringify(identity)});
       process.exit(release ? 0 : 2);`,
    ], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    try {
      const blocked = probe();
      expect(blocked.stderr).toBe("");
      expect(blocked.status).toBe(2);
    } finally {
      release?.();
    }
    const available = probe();
    expect(available.stderr).toBe("");
    expect(available.status).toBe(0);
    // The probe exits without releasing. Windows must release it on process exit.
    const recovered = acquireSessionLock(identity);
    try {
      expect(recovered).not.toBeNull();
    } finally {
      recovered?.();
    }
  });
});
