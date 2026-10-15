import { AppError } from "@/lib/errors";

/**
 * Model configuration.
 *
 * Model identifiers are checked against a capability table because the models
 * available on Groq differ in tool support, parallel tool calls, reasoning
 * behaviour and output ceilings. A wrong or unknown identifier must surface as
 * an explicit configuration error, never as a silent substitution.
 */

export type ModelRole = "simple" | "tool" | "summary" | "planning";

export interface ModelCapabilities {
  /** Whether the model can emit `tool_calls` at all. */
  toolCalling: boolean;
  /** Whether the model accepts `parallel_tool_calls: true`. */
  parallelToolCalls: boolean;
  /** Reasoning models spend part of the completion budget on hidden reasoning. */
  reasoning: boolean;
  /** Largest completion budget the provider accepts for this model. */
  maxOutputTokens: number;
  contextWindow: number;
}

/**
 * Capability table for the models this application may be pointed at.
 * Verified against `GET /openai/v1/models` for the configured account.
 */
export const KNOWN_MODELS: Record<string, ModelCapabilities> = {
  "openai/gpt-oss-120b": {
    toolCalling: true,
    parallelToolCalls: false,
    reasoning: true,
    maxOutputTokens: 32_768,
    contextWindow: 131_072,
  },
  "openai/gpt-oss-20b": {
    toolCalling: true,
    parallelToolCalls: false,
    reasoning: true,
    maxOutputTokens: 32_768,
    contextWindow: 131_072,
  },
  "openai/gpt-oss-safeguard-20b": {
    toolCalling: true,
    parallelToolCalls: false,
    reasoning: true,
    maxOutputTokens: 32_768,
    contextWindow: 131_072,
  },
  "qwen/qwen3.8-27b": {
    toolCalling: true,
    parallelToolCalls: true,
    reasoning: false,
    maxOutputTokens: 32_768,
    contextWindow: 131_072,
  },
  "openai/gpt-4o-mini": {
    toolCalling: true,
    parallelToolCalls: true,
    reasoning: false,
    maxOutputTokens: 16_384,
    contextWindow: 128_000,
  },
  "llama-3.3-70b-versatile": {
    toolCalling: true,
    parallelToolCalls: true,
    reasoning: false,
    maxOutputTokens: 32_768,
    contextWindow: 131_072,
  },
  "llama-3.1-8b-instant": {
    toolCalling: true,
    parallelToolCalls: true,
    reasoning: false,
    maxOutputTokens: 8_192,
    contextWindow: 131_072,
  },
};

/** Conservative assumptions for a model that is not in the table. */
const UNKNOWN_MODEL_CAPABILITIES: ModelCapabilities = {
  toolCalling: false,
  parallelToolCalls: false,
  reasoning: false,
  maxOutputTokens: 4_096,
  contextWindow: 32_768,
};

/** Last-resort defaults, all of which support tool calling. */
export const DEFAULT_TOOL_MODEL = "qwen/qwen3.8-27b";
export const DEFAULT_REASONING_MODEL = "openai/gpt-oss-120b";

export interface ResolvedModelConfig {
  role: ModelRole;
  model: string;
  maxCompletionTokens: number;
  temperature: number;
  parallelToolCalls: boolean;
  reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
  capabilities: ModelCapabilities;
  /** False when the identifier is not in `KNOWN_MODELS`. */
  verified: boolean;
  warnings: string[];
}

interface RoleDefaults {
  maxCompletionTokens: number;
  temperature: number;
  reasoningEffort?: ResolvedModelConfig["reasoningEffort"];
}

/**
 * Completion budgets are deliberately generous.
 *
 * A tool-call turn costs 80–200 tokens before any argument text, and Groq
 * rejects the whole request with `tool_use_failed` when the model's tool call
 * is cut off mid-JSON. Under-budgeting is therefore a correctness bug, not
 * just an economic one.
 */
const ROLE_DEFAULTS: Record<ModelRole, RoleDefaults> = {
  simple: { maxCompletionTokens: 700, temperature: 0.4 },
  tool: { maxCompletionTokens: 1_500, temperature: 0 },
  summary: { maxCompletionTokens: 1_200, temperature: 0.3 },
  planning: { maxCompletionTokens: 2_500, temperature: 0.2, reasoningEffort: "low" },
};

const ROLE_ENV_KEYS: Record<ModelRole, string> = {
  simple: "GROQ_SIMPLE_MODEL",
  tool: "GROQ_TOOL_MODEL",
  summary: "GROQ_SUMMARY_MODEL",
  planning: "GROQ_REASONING_MODEL",
};

function capabilitiesFor(model: string): { capabilities: ModelCapabilities; verified: boolean } {
  const known = KNOWN_MODELS[model];
  if (known) return { capabilities: known, verified: true };
  // A dated snapshot such as "openai/gpt-oss-120b-2025-08-01" inherits the
  // capabilities of its base identifier.
  for (const [base, caps] of Object.entries(KNOWN_MODELS)) {
    if (model.startsWith(`${base}-`)) return { capabilities: caps, verified: true };
  }
  return { capabilities: UNKNOWN_MODEL_CAPABILITIES, verified: false };
}

/**
 * Resolves the configuration for one model role.
 *
 * When a role needs tool calling but its configured model does not support it,
 * the function substitutes a verified tool-capable model and records the
 * substitution in `warnings` so it is reported rather than hidden.
 */
export function resolveModelConfig(role: ModelRole, env: NodeJS.ProcessEnv = process.env): ResolvedModelConfig {
  const defaults = ROLE_DEFAULTS[role];
  const configured = env[ROLE_ENV_KEYS[role]]?.trim();
  const warnings: string[] = [];

  const requiresTools = role === "tool" || role === "planning";
  let model = configured || (role === "planning" ? DEFAULT_REASONING_MODEL : DEFAULT_TOOL_MODEL);
  let { capabilities, verified } = capabilitiesFor(model);

  if (requiresTools && !capabilities.toolCalling) {
    const fallback = role === "planning" ? DEFAULT_REASONING_MODEL : DEFAULT_TOOL_MODEL;
    warnings.push(
      `Model "${model}" is not a verified tool-calling model for the "${role}" role. ` +
        `Falling back to "${fallback}". Set ${ROLE_ENV_KEYS[role]} to silence this warning.`
    );
    model = fallback;
    ({ capabilities, verified } = capabilitiesFor(model));
  } else if (!verified) {
    warnings.push(
      `Model "${model}" is not in the known-model table. Assuming conservative limits ` +
        `(${UNKNOWN_MODEL_CAPABILITIES.maxOutputTokens} output tokens, no tool calling).`
    );
  }

  const maxCompletionTokens = Math.min(defaults.maxCompletionTokens, capabilities.maxOutputTokens);
  if (maxCompletionTokens < defaults.maxCompletionTokens) {
    warnings.push(
      `Reduced the completion budget for role "${role}" to ${maxCompletionTokens} tokens, ` +
        `the ceiling for "${model}".`
    );
  }

  return {
    role,
    model,
    maxCompletionTokens,
    temperature: defaults.temperature,
    parallelToolCalls: capabilities.parallelToolCalls,
    reasoningEffort: capabilities.reasoning ? defaults.reasoningEffort : undefined,
    capabilities,
    verified,
    warnings,
  };
}

/**
 * Throws when a role that needs tools was pointed at a non-tool model.
 *
 * `expose` is set because the message names a variable and a model identifier —
 * never their values — and the person who can fix this is the person reading
 * the error. A generic "the AI is not configured" would leave them with nothing
 * to act on.
 */
export function assertToolCapable(config: ResolvedModelConfig): void {
  if (!config.capabilities.toolCalling) {
    throw new AppError(
      "AI_CONFIG_MISSING",
      `The configured model "${config.model}" cannot call tools, so data questions cannot be answered. ` +
        `Set ${ROLE_ENV_KEYS[config.role]} to a tool-calling model.`,
      { details: { role: config.role, model: config.model }, expose: true }
    );
  }
}

/* ------------------------------------------------------------------ */
/* Agent execution limits                                              */
/* ------------------------------------------------------------------ */

export interface AgentLimits {
  /** Upper bound on assistant turns that may request tools. */
  maxToolIterations: number;
  /** Wall-clock budget for the whole agent run. */
  totalBudgetMs: number;
  /** Per provider HTTP request timeout. */
  requestTimeoutMs: number;
  /** Bounded retries for transient read-only failures. */
  maxReadRetries: number;
  baseRetryDelayMs: number;
  /** Conversation history budget, measured in messages kept. */
  maxHistoryMessages: number;
  /** Largest accepted request body from the client. */
  maxIncomingMessages: number;
  maxMessageLength: number;
}

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * Iteration limit: 6 rounds is enough for the worst realistic chain
 * (resolve project → resolve date → search task → disambiguate → mutate →
 * verify) while still bounding cost. Previously this was 2, which made any
 * lookup-then-act request impossible.
 *
 * The time budgets are set from measured latency rather than from a guess: on
 * the configured tool model a single tool-calling completion has been observed
 * to take 10–27 s (it is queued, not thinking), so a 25 s request timeout made
 * ordinary two-step requests fail with a provider timeout. The timeout is a
 * guard against a hung connection, not a performance target.
 */
export const AGENT_LIMITS: AgentLimits = {
  maxToolIterations: envInt(process.env, "AI_MAX_TOOL_ITERATIONS", 6, 1, 12),
  totalBudgetMs: envInt(process.env, "AI_TOTAL_BUDGET_MS", 90_000, 5_000, 300_000),
  requestTimeoutMs: envInt(process.env, "AI_REQUEST_TIMEOUT_MS", 45_000, 3_000, 120_000),
  maxReadRetries: envInt(process.env, "AI_MAX_READ_RETRIES", 1, 0, 3),
  baseRetryDelayMs: envInt(process.env, "AI_BASE_RETRY_DELAY_MS", 400, 50, 5_000),
  maxHistoryMessages: envInt(process.env, "AI_MAX_HISTORY_MESSAGES", 24, 2, 100),
  maxIncomingMessages: envInt(process.env, "AI_MAX_INCOMING_MESSAGES", 60, 2, 200),
  maxMessageLength: envInt(process.env, "AI_MAX_MESSAGE_LENGTH", 4_000, 100, 20_000),
};

export function getAgentLimits(env: NodeJS.ProcessEnv = process.env): AgentLimits {
  if (env === process.env) return AGENT_LIMITS;
  return {
    ...AGENT_LIMITS,
    maxToolIterations: envInt(env, "AI_MAX_TOOL_ITERATIONS", 6, 1, 12),
    totalBudgetMs: envInt(env, "AI_TOTAL_BUDGET_MS", 90_000, 5_000, 300_000),
    requestTimeoutMs: envInt(env, "AI_REQUEST_TIMEOUT_MS", 45_000, 3_000, 120_000),
    maxReadRetries: envInt(env, "AI_MAX_READ_RETRIES", 1, 0, 3),
    maxHistoryMessages: envInt(env, "AI_MAX_HISTORY_MESSAGES", 24, 2, 100),
    maxIncomingMessages: envInt(env, "AI_MAX_INCOMING_MESSAGES", 60, 2, 200),
    maxMessageLength: envInt(env, "AI_MAX_MESSAGE_LENGTH", 4_000, 100, 20_000),
  };
}

/** All role configurations, for diagnostics. */
export function describeModelConfiguration(env: NodeJS.ProcessEnv = process.env): ResolvedModelConfig[] {
  return (["simple", "tool", "summary", "planning"] as ModelRole[]).map((role) => resolveModelConfig(role, env));
}
