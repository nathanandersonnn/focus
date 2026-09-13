import type { Session } from "@focus/core";
import { safeEqual } from "./auth";
import { sessionSchema } from "./sessionSchema";

export type SessionPostDeps = {
  deviceKey: string | undefined;
  insert: (session: Session) => Promise<void>;
};

export async function handleSessionPost(request: Request, deps: SessionPostDeps): Promise<Response> {
  if (!deps.deviceKey) {
    return Response.json({ error: "FOCUS_DEVICE_KEY is not set on the server" }, { status: 500 });
  }
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${deps.deviceKey}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid session", issues: parsed.error.issues }, { status: 400 });
  }

  await deps.insert(parsed.data);
  return Response.json({ ok: true });
}
