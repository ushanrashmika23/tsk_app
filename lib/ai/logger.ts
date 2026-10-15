/**
 * Structured agent logging.
 *
 * Deliberately narrow: it records *what the agent did* (intent, model, tool
 * name, kind, outcome, duration, token counts) and never the user's message
 * text, tool arguments or any value that could carry a credential. Keys that
 * look secret are dropped rather than logged, so a future caller cannot leak a
 * key by adding a field.
 */

const SENSITIVE_KEY = /(key|token|secret|password|passwd|cookie|authorization|credential|api[_-]?id)/i;

/**
 * Token *counts* are the opposite of a secret — they are how §11's token
 * consumption gets reviewed — so a key that names a plural count keeps its
 * numeric value even though it contains the word "token". A bare `token`,
 * `access_token` or `apiToken` still is not matched here and stays redacted.
 */
const TOKEN_COUNT_KEY = /tokens$/i;

/** Fields that exist for debugging but must never reach a log line. */
const FORBIDDEN_KEYS = new Set(["messages", "content", "arguments", "args", "prompt", "sql", "body"]);

function sanitizeValue(key: string, value: unknown): unknown {
  if (FORBIDDEN_KEYS.has(key)) return "[redacted]";
  if (SENSITIVE_KEY.test(key) && !(TOKEN_COUNT_KEY.test(key) && typeof value === "number")) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Long strings are almost always content or SQL; keep a bounded shape only.
    return value.length > 120 ? `[${value.length} chars]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  return "[object]";
}

/**
 * Emits one structured line. Never throws: logging must not be able to fail a
 * request.
 */
export function logAgentEvent(event: string, fields: Record<string, unknown> = {}): void {
  try {
    const payload: Record<string, unknown> = { scope: "ai", event, at: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields)) {
      payload[key] = sanitizeValue(key, value);
    }
    // `console.warn`/`error` keep failures visible without a logging library.
    const line = JSON.stringify(payload);
    if (event.includes("error") || event.includes("failure") || event.includes("fail")) {
      console.warn(line);
    } else {
      console.log(line);
    }
  } catch {
    // ignore
  }
}
