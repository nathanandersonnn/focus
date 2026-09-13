import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "focus_session";
export const STATE_COOKIE = "focus_oauth_state";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export type Viewer = { githubId: string; login: string };

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(requireEnv("SESSION_SECRET"));
}

export async function createSessionToken(viewer: Viewer): Promise<string> {
  return new SignJWT({ login: viewer.login })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(viewer.githubId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secret());
}

export async function readViewer(token: string | undefined): Promise<Viewer | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.sub !== requireEnv("GITHUB_ALLOWED_USER_ID")) return null;
    return { githubId: payload.sub, login: String(payload.login) };
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
