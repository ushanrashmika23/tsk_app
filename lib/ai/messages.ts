import type { AIMessage, Role } from "./types";
import type { AgentLimits } from "./config";

/**
 * Conversation hygiene.
 *
 * Two separate histories exist and must not be confused:
 *
 *  - the **provider history**, built by the agent, which contains the system
 *    prompt, assistant tool-call turns and their matching tool results;
 *  - the **user-visible history**, which contains only user and assistant
 *    prose.
 *
 * The client stores and re-sends only the user-visible history. Sending
 * assistant tool-call turns without their tool results (which is what happens
 * when a chat UI filters tool messages out of its state) produces a
 * malformed request, so the boundary rejects it outright.
 */

export interface SanitizeOutcome {
  ok: true;
  messages: AIMessage[];
  warnings: string[];
}

export interface SanitizeFailure {
  ok: false;
  error: string;
}

const ALLOWED_CLIENT_ROLES: Role[] = ["user", "assistant"];

function asText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return null;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part === "string" ? part : typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
      .join("")
      .trim();
    return joined === "" ? null : joined;
  }
  return null;
}

/**
 * Validates and normalises client-supplied messages.
 *
 * Rejects `system` and `tool` roles so a caller cannot overwrite the
 * server-side system prompt or fabricate tool output, enforces size limits,
 * and collapses consecutive same-role messages.
 */
export function sanitizeIncomingMessages(raw: unknown, limits: AgentLimits): SanitizeOutcome | SanitizeFailure {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "`messages` must be an array." };
  }
  if (raw.length === 0) {
    return { ok: false, error: "`messages` must contain at least one message." };
  }
  if (raw.length > limits.maxIncomingMessages) {
    return { ok: false, error: `Too many messages (${raw.length}). The limit is ${limits.maxIncomingMessages}.` };
  }

  const warnings: string[] = [];
  const cleaned: AIMessage[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: `Message ${index} is not an object.` };
    }

    const { role } = entry as { role?: unknown };
    if (typeof role !== "string" || !ALLOWED_CLIENT_ROLES.includes(role as Role)) {
      // Explicitly refuse prompt-injection vectors rather than dropping them
      // silently, so callers learn the rule instead of losing content.
      return {
        ok: false,
        error: `Message ${index} has role "${String(role)}". Only "user" and "assistant" messages are accepted from the client.`,
      };
    }

    const content = asText((entry as { content?: unknown }).content);
    if (content === null || content.trim() === "") {
      warnings.push(`Dropped empty ${role} message at index ${index}.`);
      continue;
    }
    if (content.length > limits.maxMessageLength) {
      return {
        ok: false,
        error: `Message ${index} is longer than the ${limits.maxMessageLength} character limit.`,
      };
    }

    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
      continue;
    }

    cleaned.push({ role: role as Role, content: content.trim() });
  }

  if (cleaned.length === 0) {
    return { ok: false, error: "No usable messages were supplied." };
  }

  while (cleaned.length > 0 && cleaned[0].role !== "user") {
    cleaned.shift();
  }
  if (cleaned.length === 0) {
    return { ok: false, error: "The conversation must start with a user message." };
  }

  return { ok: true, messages: cleaned, warnings };
}

/**
 * Bounds the conversation history.
 *
 * Because the client only sends user/assistant text there are no tool-call
 * pairs to break, but the slice is still aligned to a user turn so the model
 * never starts on a dangling assistant reply.
 */
export function trimHistory(messages: AIMessage[], maxMessages: number): AIMessage[] {
  if (messages.length <= maxMessages) {
    const firstUser = messages.findIndex((m) => m.role === "user");
    return firstUser <= 0 ? messages : messages.slice(firstUser);
  }

  const slice = messages.slice(messages.length - maxMessages);
  const firstUser = slice.findIndex((m) => m.role === "user");
  return firstUser === -1 ? slice.slice(-1) : slice.slice(firstUser);
}

/** Strips internal turns, leaving what a chat UI should render. */
export function visibleMessages(messages: AIMessage[]): AIMessage[] {
  const visible: AIMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    // Assistant turns that only requested tools carry no prose to show.
    if (message.role === "assistant" && (!message.content || message.content.trim() === "")) continue;
    visible.push({ role: message.role, content: message.content });
  }
  return visible;
}

/**
 * Agreements a user gives when answering a confirmation prompt.
 *
 * Matched at the start of a short message, with contrast and negation words
 * excluded: "yes, but make it Friday instead" is a new instruction, not an
 * agreement. This only ever selects a prompt hint — it never grants a tool or
 * changes routing — so a missed or extra match cannot widen what the agent is
 * allowed to do.
 */
const AFFIRMATIVE_START = /^(?:yes|yeah|yep|yup|ok|okay|sure|please|go ahead|go for it|do it|confirm|confirmed|proceed|correct|that'?s right)\b/i;
const AFFIRMATIVE_DISQUALIFIER = /\b(?:but|however|instead|wait|no|not|don'?t|except|unless|actually)\b/i;

/**
 * True when the user's latest turn answers the assistant's own question with an
 * agreement, e.g. "Delete it?" → "Yes, delete it".
 *
 * Used to tell the model, in the request itself, that the confirmation it asked
 * for has arrived and the operation should now be performed. Without it the
 * model tends to answer such a turn with prose instead of a tool call.
 */
export function isConfirmationReply(messages: AIMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return false;

  const text = (last.content ?? "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (AFFIRMATIVE_DISQUALIFIER.test(text)) return false;
  if (!AFFIRMATIVE_START.test(text)) return false;

  // The turn before it must be the assistant actually asking something. The
  // question mark is looked for anywhere in that turn, not only at its end:
  // a confirmation prompt is routinely followed by a trailing sentence
  // ("Delete "Study DSA"? This cannot be undone.").
  const previous = messages[messages.length - 2];
  return previous?.role === "assistant" && (previous.content ?? "").includes("?");
}
