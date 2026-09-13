import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  STATE_COOKIE,
  cookieOptions,
  createSessionToken,
  requireEnv,
} from "@/lib/auth";

function fail(message: string, status: number) {
  return new NextResponse(message, { status, headers: { "content-type": "text/plain" } });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) {
    return fail("Sign-in expired or was tampered with. Go back and try again.", 400);
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: requireEnv("GITHUB_CLIENT_ID"),
      client_secret: requireEnv("GITHUB_CLIENT_SECRET"),
      code,
      redirect_uri: new URL("/api/auth/callback", request.url).toString(),
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return fail("GitHub did not issue a token.", 502);

  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "focus-dashboard" },
  });
  if (!userRes.ok) return fail("Could not read your GitHub profile.", 502);
  const user = (await userRes.json()) as { id: number; login: string };

  if (String(user.id) !== requireEnv("GITHUB_ALLOWED_USER_ID")) {
    return fail(`@${user.login} is not allowed to view this dashboard.`, 403);
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE, await createSessionToken({ githubId: String(user.id), login: user.login }), {
    ...cookieOptions,
    maxAge: SESSION_MAX_AGE_S,
  });
  response.cookies.delete(STATE_COOKIE);
  return response;
}
