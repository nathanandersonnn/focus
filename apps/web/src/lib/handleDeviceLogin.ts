import { SESSION_COOKIE, SESSION_MAX_AGE_S, cookieOptions, createSessionToken, safeEqual } from "./auth";

function serializeCookie(name: string, value: string): string {
  const parts = [`${name}=${value}`, `Path=${cookieOptions.path}`, `Max-Age=${SESSION_MAX_AGE_S}`, "HttpOnly", "SameSite=Lax"];
  if (cookieOptions.secure) parts.push("Secure");
  return parts.join("; ");
}

export async function handleDeviceLogin(request: Request, deviceKey: string | undefined): Promise<Response> {
  if (!deviceKey) return new Response("FOCUS_DEVICE_KEY is not set on the server", { status: 500 });

  let submitted = "";
  try {
    submitted = String((await request.formData()).get("key") ?? "");
  } catch {
    return new Response("Expected a form submission", { status: 400 });
  }
  if (!safeEqual(submitted, deviceKey)) {
    return new Response("That key doesn't match. Run focus dashboard again from your PC.", { status: 401 });
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: new URL("/", request.url).toString(),
      "set-cookie": serializeCookie(SESSION_COOKIE, await createSessionToken(deviceKey)),
    },
  });
}
