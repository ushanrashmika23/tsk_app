export type AIIntent =
  | "simple_chat"
  | "schedule_query"
  | "task_creation"
  | "task_update"
  | "task_completion"
  | "day_summary"
  | "complex_planning"
  | "goal_management";

export interface AIModelConfig {
  model: string;
  maxCompletionTokens: number;
  temperature: number;
}

export type AIErrorCode =
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "TOOL_ERROR"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export class AIError extends Error {
  constructor(public code: AIErrorCode, message: string) {
    super(message);
    this.name = "AIError";
  }
}

export const AI_CONFIG = {
  simple: {
    model: process.env.GROQ_SIMPLE_MODEL || "qwen/qwen3.8-27b",
    maxCompletionTokens: 150,
    temperature: 0.3,
  } as AIModelConfig,

  tool: {
    model: process.env.GROQ_TOOL_MODEL || "qwen/qwen3.8-27b",
    maxCompletionTokens: 100,
    temperature: 0.0,
  } as AIModelConfig,

  summary: {
    model: process.env.GROQ_SIMPLE_MODEL || "qwen/qwen3.8-27b",
    maxCompletionTokens: 250,
    temperature: 0.2,
  } as AIModelConfig,

  reasoning: {
    model: process.env.GROQ_REASONING_MODEL || "openai/gpt-oss-120b",
    maxCompletionTokens: 500,
    temperature: 0.1,
  } as AIModelConfig,

  maxHistoryMessages: 6,
  maxToolIterations: 2,
  timeoutMs: 15000,
};

export function getUserFriendlyAIError(error: AIError | any): string {
  const code = error?.code || "UNKNOWN";
  switch (code) {
    case "RATE_LIMITED":
      return "AI is temporarily busy. Please try again shortly.";
    case "TIMEOUT":
      return "The AI took too long to respond. Please try again.";
    case "AUTH_ERROR":
      return "The AI assistant is currently unavailable (Auth Error).";
    case "TOOL_ERROR":
      return "I couldn't complete that task operation. Please try again.";
    case "PROVIDER_ERROR":
      return "The AI service is temporarily unavailable.";
    default:
      return "Something went wrong with the AI assistant.";
  }
}
