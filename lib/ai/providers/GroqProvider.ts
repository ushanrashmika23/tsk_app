import Groq from "groq-sdk";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "groq-sdk/resources/chat/completions";
import type { AIProvider, AIRequest, AIResponse, AIFinishReason, AIMessage, AIToolCall } from "../types";
import { AppError } from "@/lib/errors";

/**
 * Groq provider.
 *
 * Uses the installed SDK's own request/response types — no `any` casts of
 * arbitrary fields — and maps SDK error classes onto the application's error
 * taxonomy so a rate limit, a bad key and a failed tool call are reported
 * differently.
 */

/** Shape of Groq's error body, used to refine a 400/404 into a precise code. */
interface GroqErrorBody {
  message?: string;
  type?: string;
  code?: string | null;
  failed_generation?: string;
}

/**
 * How long the provider itself says to wait before retrying.
 *
 * Groq reports the wait twice — a `retry-after` header and a message ending
 * "Please try again in 11.5s" — and its free tier limits *input tokens per
 * minute*, so a wait of ten seconds is normal while the loop's own exponential
 * backoff starts at 400 ms. Retrying at 400 ms would burn the retry budget on a
 * request that cannot yet succeed. The value is clamped: it comes from outside
 * the application and must never be able to consume the whole run.
 */
const MAX_PROVIDER_DELAY_MS = 15_000;

/** Exported for tests: the wait a failed request asked for, if it asked. */
export function providerRequestedDelayMs(error: APIError): number | undefined {
  const header = error.headers?.get?.("retry-after");
  let seconds: number | undefined;
  if (header) {
    const parsed = Number.parseFloat(header);
    if (Number.isFinite(parsed)) seconds = parsed;
  }
  if (seconds === undefined) {
    const body = error.error as GroqErrorBody | undefined;
    const match = /try again in ([\d.]+)\s*s/i.exec(body?.message ?? "");
    if (match) seconds = Number.parseFloat(match[1]);
  }
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  return Math.min(MAX_PROVIDER_DELAY_MS, Math.max(0, Math.round(seconds * 1000)));
}

const FINISH_REASONS: Record<string, AIFinishReason> = {
  stop: "stop",
  tool_calls: "tool_calls",
  length: "length",
  function_call: "function_call",
  content_filter: "content_filter",
};

function classifyErrorBody(body: GroqErrorBody | undefined): { code: string | null; message?: string } {
  return { code: body?.code ?? null, message: body?.message };
}

/** Converts an SDK error into a typed `AppError` with a safe message. */
function toAppError(error: unknown, model: string, abortedByUs: boolean): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof APIUserAbortError) {
    return new AppError("TIMEOUT", abortedByUs ? "The AI request exceeded its time budget." : "The AI request was cancelled.");
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new AppError("TIMEOUT", "The AI provider did not respond in time.", { cause: error });
  }
  if (error instanceof RateLimitError) {
    const retryAfterMs = providerRequestedDelayMs(error);
    return new AppError("RATE_LIMITED", "The AI provider is rate limiting requests.", {
      cause: error,
      ...(retryAfterMs !== undefined ? { details: { retryAfterMs } } : {}),
    });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AppError("AUTH_ERROR", "The AI provider rejected the API key.", { cause: error });
  }

  if (error instanceof BadRequestError) {
    const body = error.error as GroqErrorBody | undefined;
    const { code } = classifyErrorBody(body);

    if (code === "tool_use_failed" || (body?.type === "invalid_request_error" && /tool/i.test(body?.message ?? ""))) {
      return new AppError(
        "TOOL_USE_FAILED",
        "The model's tool call was rejected by the provider, usually because the arguments were cut off before the JSON was complete.",
        { cause: error, details: { providerCode: code ?? "tool_use_failed" } }
      );
    }
    if (/context_length_exceeded|request_too_large|too large/i.test(`${code} ${body?.message ?? ""}`)) {
      return new AppError("CONTEXT_LENGTH_EXCEEDED", "The conversation exceeded the model's context window.", {
        cause: error,
      });
    }
    return new AppError("INVALID_REQUEST", "The AI provider rejected the request.", {
      cause: error,
      details: { providerCode: code ?? "bad_request" },
    });
  }

  if (error instanceof APIError) {
    const status = error.status;
    const body = error.error as GroqErrorBody | undefined;
    const { code } = classifyErrorBody(body);

    if (code === "model_not_found" || status === 404) {
      return new AppError("MODEL_NOT_FOUND", `The AI model "${model}" is not available for this API key.`, {
        cause: error,
        details: { model },
      });
    }
    if (status === 429) {
      const retryAfterMs = providerRequestedDelayMs(error);
      return new AppError("RATE_LIMITED", "The AI provider is rate limiting requests.", {
        cause: error,
        ...(retryAfterMs !== undefined ? { details: { retryAfterMs } } : {}),
      });
    }
    if (status === 401 || status === 403) {
      return new AppError("AUTH_ERROR", "The AI provider rejected the API key.", { cause: error });
    }
    if (typeof status === "number" && status >= 500) {
      return new AppError("PROVIDER_ERROR", "The AI provider reported a server error.", {
        cause: error,
        details: { status },
      });
    }
    if (status === 413) {
      return new AppError("CONTEXT_LENGTH_EXCEEDED", "The request was too large for the AI provider.", { cause: error });
    }
    return new AppError("PROVIDER_ERROR", "The AI provider returned an unexpected error.", {
      cause: error,
      details: { status, providerCode: code ?? "unknown" },
    });
  }

  if (error instanceof InternalServerError) {
    return new AppError("PROVIDER_ERROR", "The AI provider reported a server error.", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new AppError("PROVIDER_ERROR", "Could not reach the AI provider.", { cause: error });
  }

  return new AppError("UNKNOWN", error instanceof Error ? error.message : "Unknown provider error", { cause: error });
}

/**
 * Converts application messages into SDK message params.
 *
 * The SDK types `system` content as a plain string and `assistant` content as
 * `string | null`, which is exactly what the application needs, so no cast is
 * required.
 */
export function toGroqMessages(messages: AIMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content ?? "",
        tool_call_id: message.tool_call_id ?? "",
      };
    }

    if (message.role === "system") {
      return { role: "system", content: message.content ?? "" };
    }

    if (message.role === "assistant") {
      if (message.tool_calls && message.tool_calls.length > 0) {
        return {
          role: "assistant",
          content: message.content ?? null,
          tool_calls: message.tool_calls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.function.name, arguments: call.function.arguments },
          })),
          ...(message.name ? { name: message.name } : {}),
        };
      }
      return { role: "assistant", content: message.content ?? null };
    }

    return { role: "user", content: message.content ?? "" };
  });
}

function parseToolCalls(completion: ChatCompletion): AIToolCall[] | undefined {
  const raw = completion.choices[0]?.message?.tool_calls;
  if (!raw || raw.length === 0) return undefined;

  const calls: AIToolCall[] = [];
  for (const call of raw) {
    const name = call.function?.name;
    if (!name) continue;
    calls.push({
      // A missing id would break message pairing, so synthesise a stable one.
      id: call.id ?? `call_${calls.length}_${Date.now().toString(36)}`,
      type: "function",
      function: { name, arguments: call.function?.arguments ?? "{}" },
    });
  }
  return calls.length > 0 ? calls : undefined;
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";
  private readonly client: Groq;

  constructor(apiKey: string, options: { baseURL?: string } = {}) {
    if (!apiKey || apiKey.trim() === "") {
      throw new AppError("AI_CONFIG_MISSING", "GROQ_API_KEY is not set on the server.");
    }
    this.client = new Groq({ apiKey, ...(options.baseURL ? { baseURL: options.baseURL } : {}) });
  }

  /** Model identifiers available to this key, for diagnostics. */
  async listModels(): Promise<string[]> {
    const page = await this.client.models.list();
    return (page.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const body: ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages: toGroqMessages(request.messages),
      temperature: request.temperature,
    };

    if (request.maxTokens !== undefined) {
      // The installed SDK marks `max_tokens` deprecated in favour of
      // `max_completion_tokens`, and reasoning models budget their hidden
      // tokens inside it.
      body.max_completion_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
      body.tool_choice = request.toolChoice ?? "auto";
      if (request.parallelToolCalls !== undefined) {
        body.parallel_tool_calls = request.parallelToolCalls;
      }
    }

    if (request.reasoningEffort) {
      body.reasoning_effort = request.reasoningEffort;
    }

    let abortedByUs = false;
    const onAbort = () => {
      abortedByUs = true;
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const completion = await this.client.chat.completions.create(body, { signal: request.signal });

      const choice = completion.choices[0];
      if (!choice) {
        throw new AppError("PROVIDER_ERROR", "The AI provider returned no completion choices.");
      }

      const rawContent = choice.message?.content;
      // The SDK types non-streaming content as `string | null`; anything else
      // (a stray content-parts array from a proxy) is treated as no content
      // rather than being force-cast.
      const content = typeof rawContent === "string" ? rawContent : null;

      const toolCalls = parseToolCalls(completion);

      return {
        message: {
          role: "assistant",
          content: content && content.length > 0 ? content : null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens ?? 0,
              completionTokens: completion.usage.completion_tokens ?? 0,
              totalTokens: completion.usage.total_tokens ?? 0,
              ...(completion.usage.completion_tokens_details?.reasoning_tokens !== undefined
                ? { reasoningTokens: completion.usage.completion_tokens_details.reasoning_tokens }
                : {}),
            }
          : undefined,
        finishReason: FINISH_REASONS[choice.finish_reason ?? ""] ?? "other",
        model: completion.model ?? request.model,
      };
    } catch (error) {
      throw toAppError(error, request.model, abortedByUs);
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}
