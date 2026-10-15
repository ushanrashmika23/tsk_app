import { describe, expect, it } from "vitest";
import { RateLimitError } from "groq-sdk";
import { providerRequestedDelayMs, toGroqMessages } from "@/lib/ai/providers/GroqProvider";
import { retryDelayMs } from "@/lib/ai/AIService";
import { AppError } from "@/lib/errors";

/**
 * Provider-layer mapping.
 *
 * These are the parts of the Groq integration that can be checked without a key
 * or a network: how application messages become SDK messages, and how a
 * rate-limit response's own "wait this long" instruction is read and bounded.
 */

function rateLimit(options: { header?: string; message?: string }): RateLimitError {
  const headers = new Headers();
  if (options.header !== undefined) headers.set("retry-after", options.header);
  const body = { message: options.message ?? "Rate limit reached.", type: "tokens", code: "rate_limit_exceeded" };
  return new RateLimitError(429, body, undefined, headers);
}

describe("toGroqMessages", () => {
  it("keeps tool results paired with the call they answer", () => {
    const [assistant, tool] = toGroqMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_tasks", arguments: "{}" } }],
      },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1" },
    ]);

    expect(assistant).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(tool).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  it("sends an assistant turn with no tool calls as plain content", () => {
    expect(toGroqMessages([{ role: "assistant", content: "Done." }])[0]).toEqual({
      role: "assistant",
      content: "Done.",
    });
  });
});

describe("the wait a rate limit asks for", () => {
  it("reads the retry-after header", () => {
    expect(providerRequestedDelayMs(rateLimit({ header: "12" }))).toBe(12_000);
  });

  it("falls back to the wait named in the message", () => {
    const error = rateLimit({ message: "Please try again in 11.537142857s. Need more tokens?" });
    expect(providerRequestedDelayMs(error)).toBe(11_537);
  });

  it("is undefined when the provider names no wait", () => {
    expect(providerRequestedDelayMs(rateLimit({}))).toBeUndefined();
  });

  it("clamps an implausible wait instead of trusting it", () => {
    // The value arrives from outside the application and must not be able to
    // swallow the whole request budget.
    expect(providerRequestedDelayMs(rateLimit({ header: "600" }))).toBe(15_000);
  });

  it("prefers the header over the message", () => {
    const error = rateLimit({ header: "3", message: "Please try again in 40s." });
    expect(providerRequestedDelayMs(error)).toBe(3_000);
  });
});

describe("retryDelayMs", () => {
  it("waits as long as the provider asked, when that is longer", () => {
    const failure = new AppError("RATE_LIMITED", "Throttled.", { details: { retryAfterMs: 9_000 } });
    expect(retryDelayMs(failure, 400)).toBe(9_000);
  });

  it("keeps its own backoff when the provider asked for less", () => {
    const failure = new AppError("RATE_LIMITED", "Throttled.", { details: { retryAfterMs: 100 } });
    expect(retryDelayMs(failure, 400)).toBe(400);
  });

  it("uses the backoff when nothing was requested", () => {
    expect(retryDelayMs(new AppError("PROVIDER_ERROR", "Boom."), 800)).toBe(800);
  });

  it("ignores a non-numeric value", () => {
    const failure = new AppError("RATE_LIMITED", "Throttled.", { details: { retryAfterMs: "soon" } });
    expect(retryDelayMs(failure, 400)).toBe(400);
  });
});
