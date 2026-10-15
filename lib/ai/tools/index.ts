import { z, ZodObject, type ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentTool, AITool, AIToolCall, ToolResult } from "../types";
import { AppError } from "@/lib/errors";
import { fail } from "./shared";
import { TASK_TOOLS } from "./taskTools";
import { PROJECT_TOOLS } from "./projectTools";
import { GOAL_TOOLS } from "./goalTools";
import { SYSTEM_TOOLS } from "./systemTools";

/**
 * The single tool registry.
 *
 * Every tool is declared once, in one object that carries its description, Zod
 * validator (from which the provider JSON Schema is *derived*, so the two can
 * never drift), kind and implementation. Dispatch is allowlist-only: a name
 * that is not in this map is rejected before anything executes.
 */
export const TOOL_REGISTRY: Record<string, AgentTool> = Object.fromEntries(
  [...TASK_TOOLS, ...PROJECT_TOOLS, ...GOAL_TOOLS, ...SYSTEM_TOOLS].map((tool) => [tool.name, tool])
);

export const ALL_TOOL_NAMES: string[] = Object.keys(TOOL_REGISTRY);

export function getTool(name: string): AgentTool | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name) ? TOOL_REGISTRY[name] : undefined;
}

/**
 * Narrows a tool's validator to a Zod object schema.
 *
 * Every entry in the registry is built from `z.object({...})`, and rejecting
 * unexpected keys requires `.strict()`, which only object schemas have. The
 * `instanceof` check makes that a verified invariant rather than an assumption,
 * and it narrows the type without a cast.
 */
function objectSchema(tool: AgentTool): ZodObject<ZodRawShape> {
  if (!(tool.schema instanceof ZodObject)) {
    throw new AppError(
      "TOOL_ERROR",
      `Tool "${tool.name}" has a non-object argument schema, so its arguments cannot be validated.`
    );
  }
  return tool.schema;
}

const jsonSchemaCache = new Map<string, Record<string, unknown>>();

/** Derives the provider-facing JSON Schema from the tool's Zod validator. */
export function getToolJsonSchema(name: string): Record<string, unknown> | null {
  const cached = jsonSchemaCache.get(name);
  if (cached) return cached;

  const tool = getTool(name);
  if (!tool) return null;

  const schema = zodToJsonSchema(tool.schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  // `$schema` is noise for the model and costs tokens on every request.
  delete schema.$schema;

  jsonSchemaCache.set(name, schema);
  return schema;
}

/** Builds the provider tool list for exactly the requested tool names. */
export function getToolDefinitions(names: string[]): AITool[] {
  const definitions: AITool[] = [];
  for (const name of names) {
    const tool = getTool(name);
    if (!tool) continue;
    const parameters = getToolJsonSchema(name);
    if (!parameters) continue;
    definitions.push({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters },
    });
  }
  return definitions;
}

/* ------------------------------------------------------------------ */
/* Argument handling                                                   */
/* ------------------------------------------------------------------ */

export type ParsedArgs = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Parses the model's `arguments` string defensively.
 *
 * Providers occasionally emit an empty string for a no-argument tool, or wrap
 * JSON in prose/code fences. Neither should end the conversation, and neither
 * should be silently coerced into bogus values.
 */
export function parseToolArguments(raw: unknown): ParsedArgs {
  if (raw === null || raw === undefined) return { ok: true, value: {} };
  if (typeof raw === "object") return { ok: true, value: raw as Record<string, unknown> };
  if (typeof raw !== "string") return { ok: false, reason: "Tool arguments were not a string or object." };

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: {} };

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "Tool arguments must be a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    // Attempt a single conservative repair: take the outermost object literal.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { ok: true, value: parsed as Record<string, unknown> };
        }
      } catch {
        // fall through to the failure below
      }
    }
  }

  return { ok: false, reason: "Tool arguments were not valid JSON." };
}

function formatZodIssues(error: z.ZodError): { message: string; issues: Array<Record<string, unknown>> } {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    code: issue.code,
    message: issue.message,
  }));

  const unexpected = issues.filter((i) => i.code === "unrecognized_keys");
  const message =
    unexpected.length > 0
      ? `Unexpected argument(s): ${unexpected.map((i) => i.message).join("; ")}. Only the documented arguments are accepted.`
      : `Invalid arguments: ${issues.map((i) => `${i.path} — ${i.message}`).join("; ")}`;

  return { message, issues };
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export interface DispatchOutcome {
  result: ToolResult;
  /** Milliseconds spent inside the handler. */
  durationMs: number;
  /** True when the call was rejected before the handler ran. */
  rejected: boolean;
}

/**
 * Validates and executes one tool call. Never throws: every outcome, including
 * an unknown tool name or malformed JSON, becomes a structured `ToolResult`.
 */
export async function executeToolCall(
  call: AIToolCall,
  ctx: Parameters<AgentTool["handler"]>[1]
): Promise<DispatchOutcome> {
  const startedAt = Date.now();
  const name = call?.function?.name;

  if (!name || typeof name !== "string") {
    return {
      result: fail("VALIDATION_ERROR", "The model requested a tool call without a tool name."),
      durationMs: Date.now() - startedAt,
      rejected: true,
    };
  }

  const tool = getTool(name);
  if (!tool) {
    return {
      result: fail("TOOL_NOT_ALLOWED", `"${name}" is not an available tool.`, { availableTools: ALL_TOOL_NAMES }),
      durationMs: Date.now() - startedAt,
      rejected: true,
    };
  }

  const parsed = parseToolArguments(call.function.arguments);
  if (!parsed.ok) {
    return {
      result: fail("VALIDATION_ERROR", `${parsed.reason} Call ${name} again with a single valid JSON object.`),
      durationMs: Date.now() - startedAt,
      rejected: true,
    };
  }

  // `.strict()` turns unexpected keys into errors instead of dropping them.
  const validated = objectSchema(tool).strict().safeParse(parsed.value);
  if (!validated.success) {
    const { message, issues } = formatZodIssues(validated.error);
    return {
      result: fail("VALIDATION_ERROR", message, { issues }),
      durationMs: Date.now() - startedAt,
      rejected: true,
    };
  }

  try {
    const result = await tool.handler(validated.data, ctx);
    return { result, durationMs: Date.now() - startedAt, rejected: false };
  } catch (error) {
    const { failFrom } = await import("./shared");
    return { result: failFrom(error), durationMs: Date.now() - startedAt, rejected: false };
  }
}
