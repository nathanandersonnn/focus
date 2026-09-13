import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, isSignedIn } from "../src/lib/auth";
import { handleDeviceLogin } from "../src/lib/handleDeviceLogin";

const KEY = "device-key-123";

function submit(key: string) {
  return new Request("https://focus.test/api/auth/device", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key }).toString(),
  });
}

function cookieValue(res: Response): string | undefined {
  const header = res.headers.get("set-cookie") ?? "";
  return header.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
}

describe("device login", () => {
  it("signs in with the right key and redirects to the dashboard", async () => {
    const res = await handleDeviceLogin(submit(KEY), KEY);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://focus.test/");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await isSignedIn(cookieValue(res), KEY)).toBe(true);
  });

  it("rejects a wrong key without setting a cookie", async () => {
    const res = await handleDeviceLogin(submit("nope"), KEY);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("stops accepting old cookies once the device key changes", async () => {
    const token = cookieValue(await handleDeviceLogin(submit(KEY), KEY));
    expect(await isSignedIn(token, "rotated-key")).toBe(false);
  });

  it("rejects forged and missing tokens", async () => {
    expect(await isSignedIn("not.a.jwt", KEY)).toBe(false);
    expect(await isSignedIn(undefined, KEY)).toBe(false);
  });

  it("fails loudly when the server has no device key", async () => {
    expect((await handleDeviceLogin(submit(KEY), undefined)).status).toBe(500);
  });
});
