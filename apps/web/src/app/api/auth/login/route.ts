import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, cookieOptions, requireEnv } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", requireEnv("GITHUB_CLIENT_ID"));
  authorize.searchParams.set("redirect_uri", new URL("/api/auth/callback", request.url).toString());
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(STATE_COOKIE, state, { ...cookieOptions, maxAge: 600 });
  return response;
}
