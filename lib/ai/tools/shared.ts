import { z } from "zod";
import { AppError, AppErrorCode, normalizeError } from "@/lib/errors";
import {
  resolveDateExpression,
  resolveDateRangeExpression,
  resolveTimeExpression,
  isValidISODate,
  isValidTime24,
  humanizeDate,
  diffDaysISO,
  addDaysISO,
  APP_TIMEZONE,
} from "@/lib/dates";
import type { ToolResult, ToolExecutionContext } from "../types";
import type { Task } from "@/types/task";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";
import { findProjectsByName } from "@/lib/db/projects";

/* ------------------------------------------------------------------ */
/* Result constructors                                                 */
/* ------------------------------------------------------------------ */

export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export function fail(code: AppErrorCode, message: string, details?: Record<string, unknown>): ToolResult<never> {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

export function failFrom(error: unknown): ToolResult<never> {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      // Only messages explicitly marked safe are surfaced; everything else is
      // replaced so SQL fragments and stack traces never reach the model.
      message: normalized.expose ? normalized.message : safeMessageFor(normalized.code),
      ...(normalized.expose && normalized.details ? { details: normalized.details } : {}),
    },
  };
}

function safeMessageFor(code: AppErrorCode): string {
  switch (code) {
    case "DB_CONFIG_MISSING":
      return "The task database is not configured on the server, so stored tasks, projects and goals cannot be read.";
    case "DB_AUTH_FAILED":
      return "The task database rejected the server's credentials.";
    case "DB_NOT_FOUND":
      return "The configured task database does not exist.";
    case "DB_SCHEMA_MISSING":
      return "The task database is missing required tables.";
    case "DB_TIMEOUT":
      return "The task database did not respond in time.";
    case "DB_SQL_ERROR":
    case "DB_CONSTRAINT_ERROR":
      return "The task database rejected the operation.";
    case "UNKNOWN":
      return "An unexpected error occurred while running this operation.";
    default:
      return "The operation could not be completed.";
  }
}

/** Wraps a handler so nothing ever throws out of the tool registry. */
export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return failFrom(error);
  }
}

export function clarification(message: string, details?: Record<string, unknown>): ToolResult<never> {
  return fail("NEEDS_CLARIFICATION", message, details);
}

/* ------------------------------------------------------------------ */
/* Reusable schema fragments                                           */
/* ------------------------------------------------------------------ */

/**
 * Relative date phrases are resolved in application code, not by the model.
 * Passing the user's own words through removes an entire class of
 * wrong-date bugs.
 */
export const whenField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Relative date phrase copied from the user, e.g. "today", "tomorrow", "next Monday", "this weekend", "this week". Prefer this over computing a date yourself.'
  );

export const startDateField = z
  .string()
  .optional()
  .describe("Explicit inclusive start date, YYYY-MM-DD. Use only when the user gave an exact date.");

export const endDateField = z
  .string()
  .optional()
  .describe("Explicit inclusive end date, YYYY-MM-DD. Use only when the user gave an exact date.");

export const timeField = z
  .string()
  .optional()
  .describe('Time of day, e.g. "19:00", "7 PM", "evening". Omit when the user did not give a time.');

export const priorityField = z.enum(["low", "medium", "high"]);

export const limitField = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Maximum number of rows to return. Defaults to a sensible bound.");

/* ------------------------------------------------------------------ */
/* Date resolution                                                     */
/* ------------------------------------------------------------------ */

export interface ResolvedDateArgs {
  date: string;
  /** How the date was obtained, so the model can state its assumption. */
  source: "explicit" | "expression";
  phrase?: string;
}

/**
 * Sentinel for "the caller did not supply this value".
 *
 * The distinction it carries matters: "no date given" must ask the user, while
 * "an unreadable date was given" is a validation failure. It is a tagged object
 * rather than a `Symbol` because a symbol in a union type does not narrow —
 * `value === MISSING` on a `unique symbol` member is rejected by the compiler
 * as a comparison with no overlap, which left every call site unable to read
 * the resolved value.
 */
export const MISSING = Object.freeze({ missing: true as const });

export type Missing = typeof MISSING;

/** Narrows to the sentinel; use instead of `=== MISSING`. */
export function isMissing(value: unknown): value is Missing {
  return value === MISSING;
}

/** `T`, or the sentinel when nothing was supplied. */
export type Maybe<T> = T | Missing;

function firstPresent<T>(...values: Array<T | undefined>): Maybe<T> {
  for (const value of values) {
    if (value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "")) return value;
  }
  return MISSING;
}

/**
 * Resolves a single date from either an explicit ISO value or a relative
 * phrase. Distinguishes "not given" (returns `MISSING`) from "given but
 * unreadable" (returns a failure).
 */
export function resolveSingleDate(
  args: { scheduledDate?: string; date?: string; when?: string },
  ctx: ToolExecutionContext
): Maybe<ResolvedDateArgs> | ToolResult<never> {
  const explicit = firstPresent(args.scheduledDate, args.date);
  if (!isMissing(explicit)) {
    const value = String(explicit);
    if (!isValidISODate(value)) {
      return fail("VALIDATION_ERROR", `"${value}" is not a valid YYYY-MM-DD date.`, {
        field: "scheduledDate",
        value,
      });
    }
    return { date: value, source: "explicit" };
  }

  if (args.when !== undefined && args.when.trim() !== "") {
    const resolved = resolveDateExpression(args.when, { today: ctx.today, tz: ctx.timezone, now: ctx.now });
    if (resolved.status === "resolved") {
      return { date: resolved.date, source: "expression", phrase: args.when };
    }
    if (resolved.status === "invalid") {
      return fail("VALIDATION_ERROR", resolved.reason ?? `Could not understand the date in "${args.when}".`, {
        field: "when",
        value: args.when,
      });
    }
  }

  return MISSING;
}

/** Same as `resolveSingleDate` but fails with a clarification prompt. */
export function requireSingleDate(
  args: { scheduledDate?: string; when?: string },
  ctx: ToolExecutionContext,
  question = "Which day should this be scheduled for?"
): { date: string; source: "explicit" | "expression"; phrase?: string } | ToolResult<never> {
  const resolved = resolveSingleDate(args, ctx);
  if (isMissing(resolved)) {
    return clarification(question, { field: "when" });
  }
  if ("ok" in resolved) {
    return resolved;
  }
  return resolved;
}

export interface ResolvedRangeArgs {
  start: string;
  end: string;
  source: "explicit" | "expression";
  phrase?: string;
}

/** Resolves an inclusive date range from explicit bounds and/or a phrase. */
export function resolveRange(
  args: { startDate?: string; endDate?: string; when?: string },
  ctx: ToolExecutionContext
): Maybe<ResolvedRangeArgs> | ToolResult<never> {
  const start = firstPresent(args.startDate);
  const end = firstPresent(args.endDate);

  if (!isMissing(start) || !isMissing(end)) {
    const startValue = isMissing(start) ? String(end) : String(start);
    const endValue = isMissing(end) ? String(start) : String(end);
    for (const [field, value] of [
      ["startDate", startValue],
      ["endDate", endValue],
    ] as const) {
      if (!isValidISODate(value)) {
        return fail("VALIDATION_ERROR", `"${value}" is not a valid YYYY-MM-DD date.`, { field, value });
      }
    }
    if (diffDaysISO(startValue, endValue) < 0) {
      return fail("VALIDATION_ERROR", `The start date ${startValue} is after the end date ${endValue}.`, {
        startDate: startValue,
        endDate: endValue,
      });
    }
    return { start: startValue, end: endValue, source: "explicit" };
  }

  if (args.when !== undefined && args.when.trim() !== "") {
    const resolved = resolveDateRangeExpression(args.when, { today: ctx.today, tz: ctx.timezone, now: ctx.now });
    if (resolved.status === "resolved") {
      return { start: resolved.start, end: resolved.end, source: "expression", phrase: args.when };
    }
    if (resolved.status === "invalid") {
      return fail("VALIDATION_ERROR", resolved.reason ?? `Could not understand the date range in "${args.when}".`, {
        field: "when",
        value: args.when,
      });
    }
  }

  return MISSING;
}

export interface ResolvedTimeArgs {
  time: string | null;
  approximate: boolean;
}

/**
 * Resolves an optional time. A missing time is `null` and never a prompt —
 * the user is not asked for a time they did not mention.
 */
export function resolveOptionalTime(
  args: { scheduledTime?: string; time?: string; when?: string },
  options: { allowFromWhen?: boolean } = {}
): ResolvedTimeArgs | ToolResult<never> {
  const explicit = firstPresent(args.scheduledTime, args.time);
  if (!isMissing(explicit)) {
    const value = String(explicit);
    if (!isValidTime24(value)) {
      const parsed = resolveTimeExpression(value);
      if (parsed.status === "resolved") {
        return { time: parsed.time, approximate: parsed.approximate };
      }
      return fail("VALIDATION_ERROR", `"${value}" is not a time I can read. Use HH:MM or a phrase like "7 PM".`, {
        field: "scheduledTime",
        value,
      });
    }
    const [h, m] = value.split(":");
    return { time: `${h.padStart(2, "0")}:${m}`, approximate: false };
  }

  if (options.allowFromWhen !== false && args.when) {
    const parsed = resolveTimeExpression(args.when);
    if (parsed.status === "resolved") {
      return { time: parsed.time, approximate: parsed.approximate };
    }
    if (parsed.status === "invalid") {
      return fail("VALIDATION_ERROR", parsed.reason ?? `Could not read a time from "${args.when}".`, {
        field: "when",
        value: args.when,
      });
    }
  }

  return { time: null, approximate: false };
}

/* ------------------------------------------------------------------ */
/* Project reference resolution                                        */
/* ------------------------------------------------------------------ */

export interface ProjectRef {
  id: string;
  name: string;
  /** True when the id came from a name lookup rather than an explicit id. */
  resolvedFromName: boolean;
}

/**
 * Resolves a project reference without ever guessing.
 *
 *  - explicit id wins;
 *  - an exact name match is used;
 *  - a partial name match is used only when it is unique;
 *  - several matches produce AMBIGUOUS_MATCH;
 *  - no match produces NOT_FOUND together with the real project list.
 */
export async function resolveProjectRef(args: {
  projectId?: string | null;
  projectName?: string | null;
}): Promise<ProjectRef | ToolResult<never> | null> {
  if (args.projectId !== undefined && args.projectId !== null && String(args.projectId).trim() !== "") {
    const id = String(args.projectId).trim();
    return { id, name: "", resolvedFromName: false };
  }

  const name = args.projectName?.trim();
  if (!name) return null;

  const candidates = await findProjectsByName(name);

  if (candidates.length === 0) {
    const { getProjects } = await import("@/lib/db/projects");
    const all = await getProjects();
    return fail("NOT_FOUND", `No project is named "${name}".`, {
      requested: name,
      availableProjects: all.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  if (candidates.length > 1) {
    return fail("AMBIGUOUS_MATCH", `More than one project matches "${name}". Ask the user which one they mean.`, {
      requested: name,
      candidates: candidates.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  return { id: candidates[0].id, name: candidates[0].name, resolvedFromName: true };
}

/** Narrows a resolver result to either a reference or a failure. */
export function isToolFailure(value: unknown): value is ToolResult<never> {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as ToolResult).ok === false);
}

/* ------------------------------------------------------------------ */
/* Row projections                                                     */
/* ------------------------------------------------------------------ */

/**
 * Projects a stored task onto the fields the model needs to answer questions
 * and to build correct follow-up calls. Field names match the tool argument
 * names so a read result can be fed straight back into a write.
 */
export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  priority: string;
  category: string | null;
  completed: boolean;
  completedAt: string | null;
  projectId: string | null;
  /** Present when the caller supplied a project name map. */
  projectName?: string;
  /** Convenience label, e.g. "tomorrow (2026-10-16)". */
  dateLabel?: string;
}

export function toTaskView(task: Task, options: { today?: string; projectNames?: Map<string, string> } = {}): TaskView {
  const view: TaskView = {
    id: task.id,
    title: task.title,
    description: task.description,
    scheduledDate: task.scheduled_date,
    scheduledTime: task.scheduled_time,
    priority: task.priority,
    category: task.category,
    completed: Boolean(task.completed),
    completedAt: task.completed_at,
    projectId: task.project_id,
  };

  if (options.projectNames && task.project_id) {
    const name = options.projectNames.get(task.project_id);
    if (name) view.projectName = name;
  }
  if (options.today) {
    view.dateLabel = humanizeDate(task.scheduled_date, options.today);
  }
  return view;
}

export function toGoalView(goal: Goal, today?: string): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    targetDate: goal.target_date,
    /** Stored value from the database. Never an estimate. */
    progress: goal.progress,
    progressSource: "stored",
    status: goal.status,
  };
  if (today && goal.target_date) {
    const days = diffDaysISO(today, goal.target_date);
    view.daysUntilTarget = days;
    view.overdue = days < 0 && goal.status === "active";
  }
  return view;
}

export function toProjectView(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    status: project.status,
  };
}

/** Builds an `id -> name` map once per tool call instead of per row. */
export async function loadProjectNames(projectIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = Array.from(new Set(projectIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();

  const { getProjects } = await import("@/lib/db/projects");
  const projects = await getProjects();
  const map = new Map<string, string>();
  for (const project of projects) {
    if (ids.includes(project.id)) map.set(project.id, project.name);
  }
  return map;
}

/** Convenience: today's date plus a default forward window. */
export function defaultForwardRange(ctx: ToolExecutionContext, days: number): { start: string; end: string } {
  return { start: ctx.today, end: addDaysISO(ctx.today, days) };
}

export { APP_TIMEZONE };
