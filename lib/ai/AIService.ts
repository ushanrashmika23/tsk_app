import { AppError, type AppErrorCode, normalizeError } from "@/lib/errors";
import { APP_TIMEZONE, todayISO } from "@/lib/dates";
import {
  AGENT_LIMITS,
  assertToolCapable,
  resolveModelConfig,
  type AgentLimits,
  type ModelRole,
  type ResolvedModelConfig,
} from "./config";
import { logAgentEvent } from "./logger";
import { isConfirmationReply, sanitizeIncomingMessages, trimHistory } from "./messages";
import { getSystemPrompt } from "./prompts";
import { isRetryableProviderError } from "./retry";
import { routeRequest, type AIIntent } from "./router";
import { executeToolCall, getTool, getToolDefinitions } from "./tools";
import type {
  AIProvider,
  AIResponse,
  AIMessage,
  AITool,
  AIToolCall,
  AIUsage,
  ToolExecutionContext,
  ToolKind,
  ToolResult,
} from "./types";

/**
 * The agent execution loop.
 *
 * Design rules, in order of importance:
 *
 *  1. **Every tool call gets a response.** Each `tool_call` in an assistant
 *     turn produces exactly one `tool` message carrying the same id, in the
 *     same order. Pairing is never broken, whatever happens inside a handler.
 *  2. **Mutations are never retried.** A completion is retried when the
 *     provider failed before any tool ran; a write that failed or timed out is
 *     reported as failed, and an identical repeat inside one run is refused,
 *     because either could apply the change twice.
 *  3. **Every run ends in prose.** Hitting an iteration or time budget triggers
 *     one tool-free call asking for a final answer from what was gathered. If
 *     the provider is unusable, the answer is assembled locally from the tool
 *     results already in hand — never invented.
 *  4. **Parallelism only where it is safe.** Independent reads run
 *     concurrently; a batch containing a write runs strictly in order.
 */

const MAX_TOOL_RESULT_CHARS = 12_000;

/**
 * Sent when the user has agreed to an operation and the model answered with
 * prose instead of acting (see the retry in `chat`).
 */
const FORCED_ACTION_NUDGE =
  "You have not called a tool, so nothing has been changed. The user's last message agreed to the operation you proposed in your previous reply. " +
  "Call a tool now: resolve the exact record with a read tool if you do not already have its id, then carry out the operation and report what the tool returned. " +
  "If their message was not in fact an agreement to a change, call a read tool and answer from it.";

/** Below this, a forced re-ask cannot finish, so it is not started. */
const MIN_FORCED_ACTION_BUDGET_MS = 10_000;

export interface AIChatMeta {
  correlationId: string;
  intent: AIIntent;
  routingReason: string;
  modelRole: ModelRole;
  model: string;
  /** Assistant turns that requested tools. */
  iterations: number;
  toolCalls: number;
  toolErrors: number;
  mutations: number;
  durationMs: number;
  tokenUsage: { prompt: number; completion: number; reasoning: number };
  warnings: string[];
  /** True when the run was cut short or answered without the provider. */
  degraded: boolean;
}

export interface AIChatResult {
  /** User-visible history: what was sent, plus the single final reply. */
  messages: AIMessage[];
  reply: string;
  meta: AIChatMeta;
}

export interface AIServiceOptions {
  provider: AIProvider;
  limits?: AgentLimits;
  env?: NodeJS.ProcessEnv;
  /** Injected for deterministic tests. */
  now?: () => Date;
  timezone?: string;
}

interface CallOutcome {
  id: string;
  name: string;
  kind: ToolKind | "unknown";
  write: boolean;
  signature: string;
  durationMs: number;
  result: ToolResult;
}

interface MutationRecord {
  tool: string;
  label: string;
}

function newCorrelationId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().slice(0, 12);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable key for spotting a model that repeats the same write in one run. */function writeSignature(call: AIToolCall): string {
  const name = call.function?.name ?? "";
  const raw = typeof call.function?.arguments === "string" ? call.function.arguments : "";
  let normalized = raw.trim();
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    normalized = JSON.stringify(
      Object.keys(parsed)
        .sort()
        .map((key) => [key, parsed[key]])
    );
  } catch {
    // Not JSON: the raw text still catches exact repeats.
  }
  return `${name}:${normalized}`;
}

/**
 * Keeps one tool result inside the context budget.
 *
 * The cut is visible to the model (a `truncated` marker plus the original
 * length) so it can narrow the query instead of reasoning about half a list.
 */
function serializeToolResult(result: ToolResult): string {
  let text: string;
  try {
    text = JSON.stringify(result);
  } catch {
    return JSON.stringify({
      ok: false,
      error: { code: "TOOL_ERROR", message: "The tool result could not be serialised." },
    } satisfies ToolResult);
  }

  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;

  return JSON.stringify({
    ok: true,
    data: {
      truncated: true,
      originalLength: text.length,
      note: "Result truncated to fit the context window. Narrow the query (add a date range, a limit or a title filter) and call again for the rest.",
      preview: text.slice(0, MAX_TOOL_RESULT_CHARS),
    },
  });
}

/** Describes a successful mutation in plain words, for local fallback answers. */
function summarizeMutation(toolName: string, result: ToolResult): MutationRecord {
  let label = "";
  if (result.ok) {
    const data = result.data as Record<string, unknown> | null;
    if (data && typeof data === "object") {
      for (const key of ["task", "project", "goal"]) {
        const entity = data[key] as Record<string, unknown> | undefined;
        if (entity && typeof entity === "object") {
          const title = entity.title ?? entity.name;
          if (typeof title === "string" && title.trim()) {
            label = title.trim();
            break;
          }
        }
      }
      if (label === "") {
        const direct = data.title ?? data.name;
        if (typeof direct === "string" && direct.trim()) label = direct.trim();
      }
    }
  }
  return { tool: toolName, label: label ? `"${label}"` : "the requested record" };
}

/**
 * How long to wait before retrying a transient provider failure.
 *
 * The provider's own instruction wins when it gives one: a rate limit reported
 * as "try again in 11.5s" cannot be satisfied by the 400 ms first backoff, and
 * spending the single allowed retry too early turns a recoverable throttle into
 * a user-visible failure. The value is clamped by the provider layer.
 */
export function retryDelayMs(failure: AppError, backoffMs: number): number {
  const requested = failure.details?.retryAfterMs;
  return typeof requested === "number" && Number.isFinite(requested) && requested > backoffMs
    ? Math.round(requested)
    : backoffMs;
}

/** User-facing wording for a provider failure, with no internal detail. */
export function safeProviderMessage(code: AppErrorCode): string {  switch (code) {
    case "RATE_LIMITED":
      return "the AI provider is rate limiting requests right now. Try again in a moment.";
    case "TIMEOUT":
      return "the AI provider did not respond in time.";
    case "AUTH_ERROR":
      return "the AI provider rejected the configured API key.";
    case "MODEL_NOT_FOUND":
      return "the configured AI model is not available for this API key.";
    case "CONTEXT_LENGTH_EXCEEDED":
      return "the conversation grew too long for the model.";
    case "TOOL_USE_FAILED":
      return "the model's tool call was rejected by the provider.";
    case "AI_CONFIG_MISSING":
      return "the AI provider is not configured on the server.";
    case "INVALID_REQUEST":
      return "the AI provider rejected the request.";
    case "PROVIDER_ERROR":
      return "the AI provider reported a server error.";
    default:
      return "the AI provider returned an error.";
  }
}

export class AIService {
  private readonly provider: AIProvider;
  private readonly limits: AgentLimits;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly timezone: string;

  constructor(options: AIServiceOptions) {
    this.provider = options.provider;
    this.limits = options.limits ?? AGENT_LIMITS;
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.timezone = options.timezone ?? APP_TIMEZONE;
  }

  /**
   * Runs one user turn to completion.
   *
   * `rawMessages` is untrusted input straight off the wire: only `user` and
   * `assistant` roles are accepted, so the server-side system prompt cannot be
   * replaced from the client.
   */
  async chat(rawMessages: unknown, options: { signal?: AbortSignal } = {}): Promise<AIChatResult> {
    const startedAt = Date.now();
    const correlationId = newCorrelationId();
    const limits = this.limits;
    const now = this.now();
    const today = todayISO(this.timezone, now);
    const deadline = startedAt + limits.totalBudgetMs;

    const sanitized = sanitizeIncomingMessages(rawMessages, limits);
    if (!sanitized.ok) {
      throw new AppError("INVALID_REQUEST", sanitized.error, { expose: true });
    }
    for (const warning of sanitized.warnings) {
      logAgentEvent("request_warning", { correlationId, warning });
    }

    const history = trimHistory(sanitized.messages, limits.maxHistoryMessages);
    const decision = routeRequest(history);
    const config = resolveModelConfig(decision.modelRole, this.env);
    const warnings = [...config.warnings];

    // A route naming a tool the registry does not have would silently strip
    // data access — the exact defect this rewrite exists to remove.
    const requested = decision.toolNames;
    const tools: AITool[] = requested.length > 0 ? getToolDefinitions(requested) : [];
    if (requested.length > 0 && tools.length !== requested.length) {
      const missing = requested.filter((name) => !tools.some((tool) => tool.function.name === name));
      warnings.push(`Unknown tool name(s) ignored: ${missing.join(", ")}.`);
      logAgentEvent("tool_registry_mismatch", { correlationId, missing: missing.join(",") });
    }
    if (tools.length > 0) {
      // A non-tool model cannot answer a data question; fail loudly rather than
      // letting the model guess at stored data.
      assertToolCapable(config);
    }
    const writeOffered = tools.some((tool) => getTool(tool.function.name)?.kind === "write");

    // Derived from the conversation the user actually sent, never from the
    // model's prose: it is a statement about what the *previous turn* was.
    const confirmationPending = isConfirmationReply(history);

    const systemPrompt = getSystemPrompt({
      today,
      timezone: this.timezone,
      now,
      intent: decision.intent,
      toolNames: tools.map((tool) => tool.function.name),
      uncertain: decision.uncertain,
      confirmationPending,
    });

    const providerMessages: AIMessage[] = [{ role: "system", content: systemPrompt }, ...history];
    const toolContext: ToolExecutionContext = {
      now,
      timezone: this.timezone,
      today,
      correlationId,
      ...(options.signal ? { signal: options.signal } : {}),
    };

    const usage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const mutations: MutationRecord[] = [];
    const failureNotes: string[] = [];
    /** Signatures of writes that were dispatched, whether or not they landed. */
    const dispatchedWrites = new Set<string>();

    let iterations = 0;
    let toolCallCount = 0;
    let toolErrorCount = 0;
    let finalText: string | null = null;
    let degraded = false;
    let providerFailure: AppError | null = null;
    /** At most one forced re-ask per request; see the branch in the loop. */
    let forcedActionAsked = false;
    let toolChoice: "auto" | "required" = "auto";

    for (;;) {
      if (iterations >= limits.maxToolIterations) {
        logAgentEvent("iteration_limit", { correlationId, iterations, limit: limits.maxToolIterations });
        degraded = true;
        break;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        logAgentEvent("time_budget_exhausted", { correlationId, iterations });
        degraded = true;
        break;
      }

      iterations += 1;

      let response: AIResponse;
      try {
        response = await this.requestCompletion({
          messages: providerMessages,
          tools,
          config,
          limits,
          remainingMs,
          toolChoice,
          ...(options.signal ? { signal: options.signal } : {}),
          correlationId,
          iteration: iterations,
          // A tool call cut off by the output limit has incomplete JSON in it,
          // so ask for more room instead of executing half an argument list.
          rejectResponse: (candidate) =>
            candidate.finishReason === "length" && (candidate.message.tool_calls?.length ?? 0) > 0
              ? "truncated_tool_call"
              : null,
        });
      } catch (error) {
        providerFailure = normalizeError(error);
        degraded = true;
        logAgentEvent("provider_error", {
          correlationId,
          iteration: iterations,
          code: providerFailure.code,
        });
        break;
      }

      // A forced call applies to one request only: the model must stay able to
      // end the run with a plain answer once it has acted.
      toolChoice = "auto";

      if (response.usage) {
        usage.promptTokens += response.usage.promptTokens;
        usage.completionTokens += response.usage.completionTokens;
        usage.totalTokens += response.usage.totalTokens;
        usage.reasoningTokens = (usage.reasoningTokens ?? 0) + (response.usage.reasoningTokens ?? 0);
      }

      const assistantMessage = response.message;
      const toolCalls = assistantMessage.tool_calls ?? [];
      providerMessages.push(assistantMessage);

      if (toolCalls.length === 0) {
        const text = (assistantMessage.content ?? "").trim() || null;

        // The agreement the assistant asked for, answered with prose.
        //
        // Measured against the real provider, not inferred: for "Delete it?" →
        // "Yes, delete it" the model returns finish_reason "stop", no tool call
        // and the text "Deleted — … is gone." while the row is untouched; with
        // the tool choice forced to "required" it emits find_task or delete_task
        // on every attempt. The prompt already carries the same instruction and
        // is not enough on its own, so the recovery is made deterministic here.
        //
        // It stays narrow on purpose: only when the user agreed, only when the
        // route offered a write tool for that agreement, only before any tool
        // has run, and only once. No argument is trusted because of it — the
        // registry still validates every call — so the worst case is one extra
        // read.
        if (
          text !== null &&
          confirmationPending &&
          writeOffered &&
          !forcedActionAsked &&
          toolCallCount === 0 &&
          mutations.length === 0 &&
          !text.endsWith("?") &&
          deadline - Date.now() >= MIN_FORCED_ACTION_BUDGET_MS
        ) {
          forcedActionAsked = true;
          toolChoice = "required";
          providerMessages.push({ role: "system", content: FORCED_ACTION_NUDGE });
          logAgentEvent("forcing_confirmed_action", { correlationId, intent: decision.intent, iteration: iterations });
          continue;
        }

        finalText = text;
        if (finalText === null) {
          failureNotes.push("The model returned an empty response.");
          logAgentEvent("empty_completion", { correlationId, finishReason: response.finishReason });
          degraded = true;
        }
        break;
      }

      // If the retry above also truncated, the arguments are unusable: report
      // that instead of executing a partial call.
      const truncated = response.finishReason === "length";
      if (truncated) logAgentEvent("truncated_tool_call", { correlationId, calls: toolCalls.length });

      const outcomes = await this.runToolCalls({
        toolCalls,
        toolContext,
        truncated,
        dispatchedWrites,
        deadline,
      });

      for (const outcome of outcomes) {
        toolCallCount += 1;
        if (!outcome.result.ok) toolErrorCount += 1;
        if (outcome.write && outcome.result.ok) mutations.push(summarizeMutation(outcome.name, outcome.result));
        if (!outcome.result.ok) {
          failureNotes.push(`${outcome.name}: ${outcome.result.error.code} — ${outcome.result.error.message}`);
        }

        providerMessages.push({
          role: "tool",
          tool_call_id: outcome.id,
          name: outcome.name,
          content: serializeToolResult(outcome.result),
        });

        logAgentEvent(outcome.result.ok ? "tool_ok" : "tool_failed", {
          correlationId,
          iteration: iterations,
          tool: outcome.name,
          kind: outcome.kind,
          durationMs: outcome.durationMs,
          ...(outcome.result.ok ? {} : { code: outcome.result.error.code }),
        });
      }
    }

    if (finalText === null) {
      finalText = await this.produceClosingAnswer({
        providerMessages,
        mutations,
        failureNotes,
        providerFailure,
        config,
        limits,
        deadline,
        ...(options.signal ? { signal: options.signal } : {}),
        correlationId,
        usage,
      });
    }

    // A write route answered without a single tool call.
    //
    // Reproduced live: asked to confirm a deletion, the model replied
    // "Deleted …" having called nothing at all — the row was still in the
    // database. Prompt wording makes that less likely but cannot make it
    // impossible, and the claim cannot be detected by reading the model's own
    // prose. It *can* be contradicted from what the loop knows for certain:
    // nothing was dispatched, so nothing changed.
    //
    // A reply that asks a question is exempt — it is the clarification the
    // agent is supposed to request, not a claim of success.
    if (writeOffered && toolCallCount === 0 && mutations.length === 0 && !finalText.trimEnd().endsWith("?")) {
      logAgentEvent("write_without_action", { correlationId, intent: decision.intent });
      finalText +=
        "\n\n(No change was made: this reply was produced without running any operation. " +
        "Ask again if you want me to carry it out.)";
      degraded = true;
    }

    const reply = finalText;
    const meta: AIChatMeta = {
      correlationId,
      intent: decision.intent,
      routingReason: decision.reason,
      modelRole: decision.modelRole,
      model: config.model,
      iterations,
      toolCalls: toolCallCount,
      toolErrors: toolErrorCount,
      mutations: mutations.length,
      durationMs: Date.now() - startedAt,
      tokenUsage: {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        reasoning: usage.reasoningTokens ?? 0,
      },
      warnings,
      degraded,
    };

    logAgentEvent("chat_complete", {
      correlationId,
      intent: decision.intent,
      model: config.model,
      iterations,
      toolCalls: meta.toolCalls,
      toolErrors: meta.toolErrors,
      mutations: meta.mutations,
      durationMs: meta.durationMs,
      totalTokens: usage.totalTokens,
      degraded,
    });

    return {
      // The client stores exactly what it sent plus this reply. Intermediate
      // "let me check" turns and tool payloads stay internal.
      messages: [...history, { role: "assistant", content: reply }],
      reply,
      meta,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Tool execution                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Executes one assistant turn's tool calls.
   *
   * Every call produces exactly one outcome, in the order the model emitted
   * them, so the `tool` messages keep their ids aligned with the assistant's
   * `tool_calls` array.
   */
  private async runToolCalls(input: {
    toolCalls: AIToolCall[];
    toolContext: ToolExecutionContext;
    truncated: boolean;
    dispatchedWrites: Set<string>;
    deadline: number;
  }): Promise<CallOutcome[]> {
    const { toolCalls, toolContext, truncated, dispatchedWrites, deadline } = input;

    const kinds = toolCalls.map((call) => getTool(call.function?.name ?? "")?.kind);
    const allReads = kinds.length > 0 && kinds.every((kind) => kind === "read");

    // Parallelism is limited to independent, side-effect-free reads.
    if (allReads && toolCalls.length > 1) {
      const settled = await Promise.all(toolCalls.map((call) => executeToolCall(call, toolContext)));
      return toolCalls.map((call, index) => ({
        id: call.id,
        name: call.function?.name ?? "",
        kind: kinds[index] as ToolKind,
        write: false,
        signature: writeSignature(call),
        durationMs: settled[index].durationMs,
        result: settled[index].result,
      }));
    }

    const outcomes: CallOutcome[] = [];
    const seenInBatch = new Set<string>();
    let writeFailed = false;

    for (let index = 0; index < toolCalls.length; index += 1) {
      const call = toolCalls[index];
      const name = call.function?.name ?? "";
      const kind = kinds[index] as ToolKind | undefined;
      const isWrite = kind === "write";
      const signature = writeSignature(call);

      const outcome: CallOutcome = {
        id: call.id,
        name,
        kind: kind ?? "unknown",
        write: isWrite,
        signature,
        durationMs: 0,
        result: { ok: true, data: {} },
      };

      if (truncated) {
        outcome.result = {
          ok: false,
          error: {
            code: "TOOL_USE_FAILED",
            message:
              "This tool call was cut off before its arguments were complete, so it was not executed. Call it again with the same intent and shorter arguments.",
          },
        };
        outcomes.push(outcome);
        continue;
      }

      if (isWrite && (dispatchedWrites.has(signature) || seenInBatch.has(signature))) {
        outcome.result = {
          ok: false,
          error: {
            code: "TOOL_ERROR",
            message:
              "This exact operation already ran in this request, so it was not repeated — repeating it would apply the change twice. Use the result of the first call.",
          },
        };
        outcomes.push(outcome);
        continue;
      }

      if (isWrite && writeFailed) {
        outcome.result = {
          ok: false,
          error: {
            code: "TOOL_ERROR",
            message:
              "Skipped because an earlier operation in the same step failed and this one may depend on it. Resolve that failure first, then retry this call if it is still needed.",
          },
        };
        outcomes.push(outcome);
        continue;
      }

      if (Date.now() >= deadline) {
        outcome.result = {
          ok: false,
          error: { code: "TIMEOUT", message: "The request ran out of time before this operation started." },
        };
        outcomes.push(outcome);
        continue;
      }

      // Recorded before dispatch: a write that timed out ambiguously must not
      // be repeated, because it may already have been applied.
      if (isWrite) {
        seenInBatch.add(signature);
        dispatchedWrites.add(signature);
      }

      const dispatch = await executeToolCall(call, toolContext);
      outcome.durationMs = dispatch.durationMs;
      outcome.result = dispatch.result;
      if (isWrite && !dispatch.result.ok) writeFailed = true;

      outcomes.push(outcome);
    }

    return outcomes;
  }

  /* ---------------------------------------------------------------- */
  /* Provider calls                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * One completion, with bounded retries.
   *
   * Retries are safe here because the request is a completion and no tool has
   * run for this turn yet, so resending it cannot duplicate an effect. Two
   * cases trigger one: a transient provider failure, and a response the caller
   * rejected as unusable (a tool call truncated by the output limit), which is
   * retried with a larger completion budget.
   */
  private async requestCompletion(input: {
    messages: AIMessage[];
    tools: AITool[];
    config: ResolvedModelConfig;
    limits: AgentLimits;
    remainingMs: number;
    /** Defaults to "auto"; "required" is used only for the recovery above. */
    toolChoice?: "auto" | "required";
    signal?: AbortSignal;
    correlationId: string;
    iteration: number;
    rejectResponse?: (response: AIResponse) => string | null;
  }): Promise<AIResponse> {
    const { messages, tools, config, limits, remainingMs, toolChoice, signal, correlationId, iteration, rejectResponse } = input;

    const ceiling = config.capabilities.maxOutputTokens;
    const startedWaiting = Date.now();
    let maxTokens = config.maxCompletionTokens;
    let attempts = 0;
    let budgetBumps = 0;

    for (;;) {
      attempts += 1;
      const elapsed = Date.now() - startedWaiting;
      const timeoutMs = Math.max(3_000, Math.min(limits.requestTimeoutMs, remainingMs - elapsed));

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      // An "abort" listener added after the signal already fired never runs, so
      // a caller that disconnected before this request would otherwise sit
      // through a full provider timeout with nothing able to cancel it.
      if (signal?.aborted) controller.abort();

      try {
        const response = await this.provider.generateResponse({
          messages,
          ...(tools.length > 0 ? { tools, parallelToolCalls: config.parallelToolCalls } : {}),
          ...(toolChoice && toolChoice !== "auto" && tools.length > 0 ? { toolChoice } : {}),
          model: config.model,
          temperature: config.temperature,
          maxTokens,
          ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
          signal: controller.signal,
        });

        const rejection = rejectResponse?.(response) ?? null;
        if (rejection === null) return response;

        if (budgetBumps < limits.maxReadRetries && maxTokens < ceiling) {
          budgetBumps += 1;
          maxTokens = Math.min(ceiling, Math.max(maxTokens * 2, 1_500));
          logAgentEvent("retry_with_larger_budget", {
            correlationId,
            iteration,
            reason: rejection,
            maxTokens,
          });
          continue;
        }

        // Out of retries: hand the response back so the caller can report the
        // problem instead of executing a partial tool call.
        return response;
      } catch (error) {
        // The caller went away: stop immediately and never retry.
        if (signal?.aborted) throw error;

        const appError = normalizeError(error);

        if (appError.code === "TOOL_USE_FAILED" && maxTokens < ceiling && budgetBumps < limits.maxReadRetries) {
          budgetBumps += 1;
          maxTokens = Math.min(ceiling, Math.max(maxTokens * 2, 1_500));
          logAgentEvent("retry_tool_use_failed", { correlationId, iteration, maxTokens });
          continue;
        }

        const failure =
          timedOut && appError.code === "TIMEOUT"
            ? new AppError("TIMEOUT", `The AI provider did not respond within ${timeoutMs} ms.`, { cause: error })
            : appError;

        const delay = retryDelayMs(failure, limits.baseRetryDelayMs * 2 ** (attempts - 1));
        // `remainingMs` is a duration measured from the caller's start, so the
        // budget left has to be derived from elapsed time — comparing it against
        // an absolute timestamp made this condition permanently false and the
        // retry below unreachable.
        const budgetLeft = remainingMs - (Date.now() - startedWaiting) - delay;
        const canRetry = attempts <= limits.maxReadRetries && isRetryableProviderError(failure) && budgetLeft > 0;

        if (!canRetry) throw failure;

        logAgentEvent("retry_provider", {
          correlationId,
          iteration,
          attempt: attempts,
          code: failure.code,
          delay,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      } finally {
        // The original implementation leaked this timer; clearing it in
        // `finally` keeps a finished request from aborting a later one.
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Closing answers                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Produces the user-facing answer when the loop ended without one.
   *
   * Prefers a single tool-free completion so the model can summarise what it
   * found. If the provider is unusable, the answer is assembled locally from
   * the tool results already obtained — the only way to report partial success
   * truthfully.
   */
  private async produceClosingAnswer(input: {
    providerMessages: AIMessage[];
    mutations: MutationRecord[];
    failureNotes: string[];
    providerFailure: AppError | null;
    config: ResolvedModelConfig;
    limits: AgentLimits;
    deadline: number;
    signal?: AbortSignal;
    correlationId: string;
    usage: AIUsage;
  }): Promise<string> {
    const { providerMessages, mutations, failureNotes, config, limits, deadline, correlationId, usage } = input;
    let providerFailure = input.providerFailure;

    // Below this, the request is guaranteed to be cut off only a few seconds in,
    // which the provider reports as a timeout — a failure the user would read as
    // "the AI is broken" rather than "there was no time left". Composing the
    // answer locally from the tool results already in hand is both faster and
    // more truthful.
    const MIN_CLOSING_BUDGET_MS = 8_000;

    if (providerFailure === null && deadline - Date.now() >= MIN_CLOSING_BUDGET_MS) {
      // Internal only: this turn is never persisted, so the nudge cannot leak
      // into a later request as if the user had written it.
      const nudge: AIMessage = {
        role: "user",
        content:
          "Answer the request now using only the tool results above. Do not call any more tools. " +
          "If something failed, say exactly which operation failed and why. If you changed anything, state what changed.",
      };
      try {
        const response = await this.requestCompletion({
          messages: [...providerMessages, nudge],
          tools: [],
          config,
          limits,
          remainingMs: deadline - Date.now(),
          ...(input.signal ? { signal: input.signal } : {}),
          correlationId,
          iteration: 0,
        });
        if (response.usage) {
          usage.promptTokens += response.usage.promptTokens;
          usage.completionTokens += response.usage.completionTokens;
          usage.totalTokens += response.usage.totalTokens;
          usage.reasoningTokens = (usage.reasoningTokens ?? 0) + (response.usage.reasoningTokens ?? 0);
        }
        const text = (response.message.content ?? "").trim();
        if (text) return text;
        failureNotes.push("The model returned an empty closing answer.");
      } catch (error) {
        providerFailure = normalizeError(error);
        logAgentEvent("closing_answer_failed", { correlationId, code: providerFailure.code });
      }
    }

    return composeLocalAnswer(mutations, failureNotes, providerFailure);
  }
}

/**
 * Last-resort answer with no model involved.
 *
 * It can only state facts the tool layer already returned, so it cannot claim a
 * change that did not happen.
 */
export function composeLocalAnswer(
  mutations: MutationRecord[],
  failureNotes: string[],
  providerFailure: AppError | null
): string {
  const lines: string[] = [];

  if (mutations.length > 0) {
    lines.push(
      mutations.length === 1
        ? "One change went through before the assistant stopped:"
        : `${mutations.length} changes went through before the assistant stopped:`
    );
    for (const mutation of mutations) {
      lines.push(`- ${mutation.tool.replace(/_/g, " ")}: ${mutation.label}`);
    }
  }

  if (failureNotes.length > 0) {
    lines.push(mutations.length > 0 ? "These steps did not succeed:" : "I could not complete that:");
    for (const note of failureNotes.slice(0, 4)) lines.push(`- ${note}`);
  }

  if (providerFailure) {
    const detail = providerFailure.expose ? providerFailure.message : safeProviderMessage(providerFailure.code);
    lines.push("", `The assistant could not finish: ${detail}`);
  } else if (lines.length === 0) {
    lines.push(
      "I reached the limit for a single request before finishing. Ask again with a narrower question and I will pick it up from there."
    );
  }

  return lines.join("\n");
}
