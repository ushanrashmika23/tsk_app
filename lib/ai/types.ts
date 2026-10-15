import type { ZodTypeAny, z } from "zod";
import type { AppErrorCode } from "@/lib/errors";

export type Role = "system" | "user" | "assistant" | "tool";

export interface AIMessage {
  role: Role;
  content: string | null;
  /** Set on tool result messages by some providers. */
  name?: string;
  /** Pairs a `tool` message with the assistant `tool_call` it answers. */
  tool_call_id?: string;
  /** Present on assistant turns that request tools. */
  tool_calls?: AIToolCall[];
}

export interface AIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON encoded arguments, exactly as the model emitted them. */
    arguments: string;
  };
}

export interface AITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/* ------------------------------------------------------------------ */
/* Tool results                                                        */
/* ------------------------------------------------------------------ */

export type ToolKind = "read" | "write";

export interface ToolSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: {
    code: AppErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * The single result shape every tool returns. A tool never throws out of the
 * registry, so the agent always has a structured outcome to reason about and
 * can tell a failure apart from an empty result.
 */
export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface ToolExecutionContext {
  /** Instant the request started, injected so behaviour is testable. */
  now: Date;
  timezone: string;
  /** Civil date in `timezone`, i.e. what "today" means to the user. */
  today: string;
  correlationId: string;
  signal?: AbortSignal;
}

/**
 * One authoritative tool definition: description, JSON Schema, Zod validator
 * and implementation live together so they cannot drift apart.
 */
export interface AgentTool<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  kind: ToolKind;
  schema: TSchema;
  handler: (args: z.infer<TSchema>, ctx: ToolExecutionContext) => Promise<ToolResult>;
}

/* ------------------------------------------------------------------ */
/* Provider contract                                                   */
/* ------------------------------------------------------------------ */

export interface AIRequest {
  messages: AIMessage[];
  tools?: AITool[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  parallelToolCalls?: boolean;
  /**
   * Whether the model may, must, or must not call a tool. Defaults to "auto".
   *
   * `"required"` is used for one narrow recovery case in the agent loop: the
   * user has agreed to an operation the assistant proposed and the model
   * answered with prose instead of acting. Providers differ in how reliably
   * they honour it, so the loop treats a repeated prose answer as a failure
   * rather than assuming the call happened.
   */
  toolChoice?: "auto" | "none" | "required";
  reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
  /** Cancels the underlying HTTP request when the agent budget expires. */
  signal?: AbortSignal;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export type AIFinishReason = "stop" | "tool_calls" | "length" | "function_call" | "content_filter" | "other";

export interface AIResponse {
  message: AIMessage;
  usage?: AIUsage;
  finishReason: AIFinishReason;
  /** The model that actually served the request. */
  model: string;
}

export interface AIProvider {
  readonly name: string;
  generateResponse(request: AIRequest): Promise<AIResponse>;
  /** Optional: used by diagnostics to verify configured model identifiers. */
  listModels?(): Promise<string[]>;
}
