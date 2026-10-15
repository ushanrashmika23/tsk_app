import type { AIFinishReason, AIProvider, AIRequest, AIResponse, AIToolCall, AIUsage } from "@/lib/ai/types";

/**
 * A scripted AI provider.
 *
 * The agent loop is the thing under test, so the provider is reduced to a queue
 * of canned turns. That keeps the tests deterministic, needs no API key, and
 * makes failure modes (a truncated tool call, a rate limit, a hang) reproducible
 * instead of hoped for.
 */

export interface ToolCallStep {
  name: string;
  /** Object form is serialised; use `rawArguments` to emit malformed JSON. */
  args?: unknown;
  rawArguments?: string;
  id?: string;
}

export interface ProviderStep {
  content?: string | null;
  toolCalls?: ToolCallStep[];
  finishReason?: AIFinishReason;
  usage?: Partial<AIUsage>;
  /** Throw this instead of returning. */
  throws?: unknown;
  /** Reject with a timeout only once the request is aborted. */
  hangUntilAborted?: boolean;
  /** Wait this long before answering. */
  delayMs?: number;
}

export class ScriptedProvider implements AIProvider {
  readonly name = "scripted";
  readonly requests: AIRequest[] = [];
  private queue: ProviderStep[];
  private autoId = 0;

  constructor(steps: ProviderStep[]) {
    this.queue = [...steps];
  }

  /** Pushes an extra step, for assertions that need a provider error mid-run. */
  push(step: ProviderStep): void {
    this.queue.push(step);
  }

  /** Tool names offered on the most recent request. */
  lastToolNames(): string[] {
    const last = this.requests[this.requests.length - 1];
    return (last?.tools ?? []).map((tool) => tool.function.name);
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    // Snapshot the message list: the agent keeps appending to its working array
    // across a turn, and a request must be inspected as it was actually sent.
    this.requests.push({ ...request, messages: [...request.messages] });

    const step = this.queue.shift();
    if (!step) {
      // Running past the scripted turns is a test bug, but returning a final
      // answer keeps the failure readable rather than hanging.
      return {
        message: { role: "assistant", content: "No more scripted turns." },
        finishReason: "stop",
        model: "scripted",
      };
    }

    if (step.hangUntilAborted) {
      return new Promise<AIResponse>((_resolve, reject) => {
        const signal = request.signal;
        if (!signal) return; // never resolves; the test's own timeout catches it
        const onAbort = () => reject(new Error("Request was aborted."));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    }

    if (step.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }

    if (step.throws !== undefined) throw step.throws;

    const toolCalls: AIToolCall[] | undefined = step.toolCalls?.map((call) => ({
      id: call.id ?? `call_${(this.autoId += 1)}`,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: call.rawArguments ?? JSON.stringify(call.args ?? {}),
      },
    }));

    return {
      message: {
        role: "assistant",
        content: step.content ?? null,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      usage: {
        promptTokens: step.usage?.promptTokens ?? 10,
        completionTokens: step.usage?.completionTokens ?? 5,
        totalTokens: step.usage?.totalTokens ?? 15,
        ...(step.usage?.reasoningTokens !== undefined ? { reasoningTokens: step.usage.reasoningTokens } : {}),
      },
      finishReason: step.finishReason ?? (toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop"),
      model: "scripted",
    };
  }
}

/** Reads the `tool` messages from a request, keyed by their tool_call_id. */
export function toolMessages(request: AIRequest | undefined): Array<{ id: string; name: string; body: unknown }> {
  if (!request) return [];
  return request.messages
    .filter((message) => message.role === "tool")
    .map((message) => ({
      id: message.tool_call_id ?? "",
      name: message.name ?? "",
      body: message.content ? (JSON.parse(message.content) as unknown) : null,
    }));
}

/** Reasons the assistant requested tools with, across every request so far. */
export function assistantToolCallIds(request: AIRequest | undefined): string[] {
  if (!request) return [];
  const ids: string[] = [];
  for (const message of request.messages) {
    if (message.role === "assistant" && message.tool_calls) {
      for (const call of message.tool_calls) ids.push(call.id);
    }
  }
  return ids;
}
