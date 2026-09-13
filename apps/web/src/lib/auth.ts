import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "focus_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const SUBJECT = "owner";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Derived from the device key so the server needs only one secret; rotating the key signs you out.
function signingKey(deviceKey: string): Uint8Array {
  return createHash("sha256").update(`focus-session:${deviceKey}`).digest();
}

export async function createSessionToken(deviceKey: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(signingKey(deviceKey));
}

export async function isSignedIn(token: string | undefined, deviceKey: string | undefined): Promise<boolean> {
  if (!token || !deviceKey) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(deviceKey), { algorithms: ["HS256"] });
    return payload.sub === SUBJECT;
  } catch {
    return false;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
