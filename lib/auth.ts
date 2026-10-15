/**
 * Request authentication for route handlers.
 *
 * `middleware.ts` protects pages but its matcher historically excluded `/api`,
 * which left the AI endpoint open. Rather than rely on that matcher alone, the
 * same token derivation lives here so a handler can enforce the boundary
 * itself and answer with a proper status code instead of an HTML redirect.
 *
 * The token is a SHA-256 digest of the password plus a fixed salt, exactly as
 * produced at login — no secret material is ever written to the client beyond
 * that digest, and the password itself is never compared against user input
 * here.
 */

export const AUTH_COOKIE_NAME = "auth_token";

const AUTH_SALT = "app_salt_task_manager";

export type AuthFailureReason = "unconfigured" | "missing_cookie" | "invalid";

/** Discriminated so a caller handling the failure branch gets the reason typed. */
export type AuthResult =
  | { authenticated: true; reason: "ok" }
  | { authenticated: false; reason: AuthFailureReason };

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Derives the cookie value for a password. Shared with the login action. */
export async function deriveAuthToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(password + AUTH_SALT);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** Comparison whose duration does not depend on where the strings differ. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/**
 * Verifies the request's auth cookie.
 *
 * A missing `APP_PASSWORD` denies access, matching the middleware: an
 * unconfigured deployment must not become an open one.
 */
export async function verifyRequestAuth(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): Promise<AuthResult> {
  const password = env.APP_PASSWORD;
  if (!password) return { authenticated: false, reason: "unconfigured" };

  const cookie = readCookie(request.headers.get("cookie"), AUTH_COOKIE_NAME);
  if (!cookie) return { authenticated: false, reason: "missing_cookie" };

  const expected = await deriveAuthToken(password);
  return constantTimeEqual(cookie, expected) ? { authenticated: true, reason: "ok" } : { authenticated: false, reason: "invalid" };
}

/** User-facing wording for an auth failure that reveals nothing about secrets. */
export function authFailureMessage(reason: AuthFailureReason): string {
  switch (reason) {
    case "unconfigured":
      return "This app has no APP_PASSWORD configured, so the AI endpoint is disabled. Set APP_PASSWORD on the server.";
    case "missing_cookie":
    case "invalid":
    default:
      return "Your session is not signed in. Reload the page and sign in again.";
  }
}
