import { executeToolCall } from "@/lib/ai/tools";
import type { AIToolCall, ToolExecutionContext, ToolResult } from "@/lib/ai/types";

/**
 * Calls a tool through the real dispatch path — registry lookup, JSON parsing,
 * Zod validation, handler — so tests exercise the same code the agent runs.
 */

export const TEST_TIMEZONE = "Asia/Colombo";

/** 2026-10-15 09:30 in Asia/Colombo (a Thursday). */
export const TEST_NOW = new Date("2026-10-15T04:00:00.000Z");
export const TEST_TODAY = "2026-10-15";

/**
 * A hermetic environment for a test.
 *
 * `NodeJS.ProcessEnv` requires `NODE_ENV` (Next augments the global type with
 * it), and a test must never inherit the developer's own model or credential
 * variables — an assertion about fallback behaviour would otherwise depend on
 * whatever is in the shell.
 */
export function testEnv(values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

export function testContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    now: TEST_NOW,
    timezone: TEST_TIMEZONE,
    today: TEST_TODAY,
    correlationId: "test-correlation",
    ...overrides,
  };
}

export interface ToolCallResult {
  result: ToolResult;
  durationMs: number;
  rejected: boolean;
}

/** Dispatches one tool call with object arguments, as the model would. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext = testContext()
): Promise<ToolCallResult> {
  const call: AIToolCall = {
    id: `call_${name}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
  return executeToolCall(call, ctx);
}

/** Dispatches with raw argument text, for malformed-JSON tests. */
export async function callToolRaw(
  name: string,
  rawArguments: string,
  ctx: ToolExecutionContext = testContext()
): Promise<ToolCallResult> {
  return executeToolCall(
    { id: `call_${name}`, type: "function", function: { name, arguments: rawArguments } },
    ctx
  );
}

/** Narrowing helper: asserts success and returns the data payload. */
export function expectOk<T = Record<string, unknown>>(result: ToolResult): T {
  if (!result.ok) {
    throw new Error(`Expected success but the tool failed: ${result.error.code} — ${result.error.message}`);
  }
  return result.data as T;
}

/** Narrows to the structured failure contract. */
export function expectFail(result: ToolResult): { code: string; message: string; details?: Record<string, unknown> } {
  if (result.ok) {
    throw new Error(`Expected a failure but the tool succeeded: ${JSON.stringify(result.data).slice(0, 200)}`);
  }
  return result.error;
}
