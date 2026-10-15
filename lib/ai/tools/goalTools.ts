import { z } from "zod";
import {
  getGoals,
  findGoalById,
  searchGoalsByTitle,
  createGoal,
  patchGoal,
  completeGoal,
  reopenGoal,
  deleteGoal,
} from "@/lib/db/goals";
import { findProjectById } from "@/lib/db/projects";
import { getTasksByProject } from "@/lib/db/tasks";
import {
  ok,
  fail,
  guard,
  clarification,
  toGoalView,
  isToolFailure,
  isMissing,
  whenField,
  resolveSingleDate,
  toTaskView,
} from "./shared";
import type { AgentTool, ToolExecutionContext } from "../types";
import type { Goal } from "@/types/goal";
import { isValidISODate, diffDaysISO } from "@/lib/dates";

function present(goals: Goal[], ctx: ToolExecutionContext) {
  return goals.map((goal) => toGoalView(goal, ctx.today));
}

/** Resolves a target date from either an ISO value or a relative phrase. */
function resolveTargetDate(
  args: { targetDate?: string | null; when?: string },
  ctx: ToolExecutionContext
): string | null | undefined | ReturnType<typeof fail> {
  if (args.targetDate === null) return null;

  const resolved = resolveSingleDate({ scheduledDate: args.targetDate ?? undefined, when: args.when }, ctx);
  if (isToolFailure(resolved)) return resolved;
  if (isMissing(resolved)) return undefined;
  return resolved.date;
}

const getGoalsSchema = z.object({
  status: z.enum(["active", "completed", "archived"]).optional().describe("Filter by status. Omit for all goals."),
  activeOnly: z.boolean().optional().describe("Shorthand for status = active."),
});

const getGoalsTool: AgentTool<typeof getGoalsSchema> = {
  name: "get_goals",
  kind: "read",
  description:
    "List goals with their stored progress and target dates. Call this for any question about goals or about what to prioritise.",
  schema: getGoalsSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const status = args.activeOnly ? "active" : args.status;
      const goals = await getGoals(status);
      return ok({
        count: goals.length,
        /** `progress` is the stored column value, not an estimate. */
        progressSource: "stored",
        goals: present(goals, ctx),
      });
    }),
};

const getGoalSchema = z.object({ id: z.string().min(1).describe("Exact goal id.") });

const getGoalTool: AgentTool<typeof getGoalSchema> = {
  name: "get_goal",
  kind: "read",
  description: "Retrieve one goal by its exact id.",
  schema: getGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const goal = await findGoalById(args.id);
      if (!goal) return fail("NOT_FOUND", `No goal exists with id "${args.id}".`, { id: args.id });
      return ok({ goal: toGoalView(goal, ctx.today) });
    }),
};

const findGoalSchema = z.object({
  query: z.string().min(1).describe('Title or descriptive phrase, e.g. "AWS course".'),
});

const findGoalTool: AgentTool<typeof findGoalSchema> = {
  name: "find_goal",
  kind: "read",
  description:
    "Resolve a goal reference to an exact id. Returns ranked candidates and an `ambiguous` flag; when ambiguous, ask the user which goal they mean.",
  schema: findGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const direct = await findGoalById(args.query.trim());
      if (direct) {
        return ok({
          query: args.query,
          matchedById: true,
          ambiguous: false,
          candidateCount: 1,
          candidates: present([direct], ctx),
          resolvedGoal: toGoalView(direct, ctx.today),
        });
      }

      const candidates = await searchGoalsByTitle(args.query);
      const views = present(candidates.slice(0, 5), ctx);
      const ambiguous = views.length > 1;

      return ok({
        query: args.query,
        matchedById: false,
        ambiguous,
        candidateCount: views.length,
        candidates: views,
        ...(ambiguous
          ? { instruction: "More than one goal matches. Ask the user which one they mean before changing anything." }
          : { resolvedGoal: views[0] ?? null }),
        ...(views.length === 0 ? { note: "No stored goal matches that description." } : {}),
      });
    }),
};

const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  targetDate: z.string().optional().describe("Exact date YYYY-MM-DD."),
  when: whenField,
  progress: z.number().min(0).max(100).optional().describe("Starting progress. Defaults to 0."),
});

const createGoalTool: AgentTool<typeof createGoalSchema> = {
  name: "create_goal",
  kind: "write",
  description: "Create a goal. Only call this when the user explicitly asks for a goal to be created.",
  schema: createGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const targetDate = resolveTargetDate({ targetDate: args.targetDate, when: args.when }, ctx);
      if (isToolFailure(targetDate)) return targetDate;

      const goal = await createGoal({
        title: args.title,
        description: args.description,
        target_date: targetDate ?? null,
        progress: args.progress ?? 0,
      });

      return ok({
        goal: toGoalView(goal, ctx.today),
        verified: true,
        ...(typeof targetDate === "string" && args.when && !args.targetDate
          ? { dateAssumption: `Interpreted "${args.when}" as ${targetDate}.` }
          : {}),
      });
    }),
};

const updateGoalSchema = z.object({
  id: z.string().min(1).describe("Exact goal id."),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional().describe("Exact new date, or null to clear it."),
  when: whenField,
  progress: z.number().min(0).max(100).optional().describe("Stored progress percentage, 0-100."),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

const updateGoalTool: AgentTool<typeof updateGoalSchema> = {
  name: "update_goal",
  kind: "write",
  description:
    "Update selected fields of one goal. Omitted fields are preserved. `progress` writes the stored percentage exactly as given.",
  schema: updateGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const before = await findGoalById(args.id);
      if (!before) return fail("NOT_FOUND", `No goal exists with id "${args.id}".`, { id: args.id });

      const patch: Parameters<typeof patchGoal>[1] = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.status !== undefined) patch.status = args.status;
      if (args.progress !== undefined) patch.progress = args.progress;

      if (args.targetDate !== undefined || args.when !== undefined) {
        const targetDate = resolveTargetDate({ targetDate: args.targetDate, when: args.when }, ctx);
        if (isToolFailure(targetDate)) return targetDate;
        if (targetDate !== undefined) patch.target_date = targetDate;
      }

      if (Object.keys(patch).length === 0) {
        return clarification(`What would you like to change about the goal "${before.title}"?`);
      }

      const goal = await patchGoal(args.id, patch);
      return ok({
        goal: toGoalView(goal, ctx.today),
        previous: toGoalView(before, ctx.today),
        verified: true,
      });
    }),
};

const completeGoalSchema = z.object({ id: z.string().min(1).describe("Exact goal id.") });

const completeGoalTool: AgentTool<typeof completeGoalSchema> = {
  name: "complete_goal",
  kind: "write",
  description: "Mark a goal complete and set its stored progress to 100.",
  schema: completeGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const before = await findGoalById(args.id);
      if (!before) return fail("NOT_FOUND", `No goal exists with id "${args.id}".`, { id: args.id });

      const goal = await completeGoal(args.id);
      return ok({ goal: toGoalView(goal, ctx.today), previous: toGoalView(before, ctx.today), verified: true });
    }),
};

const reopenGoalSchema = z.object({ id: z.string().min(1).describe("Exact goal id.") });

const reopenGoalTool: AgentTool<typeof reopenGoalSchema> = {
  name: "reopen_goal",
  kind: "write",
  description: "Reopen a completed goal. Its stored progress is preserved rather than reset.",
  schema: reopenGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const goal = await reopenGoal(args.id);
      return ok({ goal: toGoalView(goal, ctx.today), verified: true });
    }),
};

const deleteGoalSchema = z.object({
  id: z.string().min(1),
  confirm: z.boolean().optional().describe("Must be true, only after explicit user confirmation."),
});

const deleteGoalTool: AgentTool<typeof deleteGoalSchema> = {
  name: "delete_goal",
  kind: "write",
  description: "Permanently delete a goal. Requires explicit user confirmation.",
  schema: deleteGoalSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const goal = await findGoalById(args.id);
      if (!goal) return fail("NOT_FOUND", `No goal exists with id "${args.id}".`, { id: args.id });

      if (args.confirm !== true) {
        return fail("CONFIRMATION_REQUIRED", `Deleting the goal "${goal.title}" cannot be undone. Confirm first.`, {
          goal: toGoalView(goal, ctx.today),
        });
      }

      const result = await deleteGoal(args.id);
      const stillThere = await findGoalById(args.id);
      if (stillThere) {
        return fail("TOOL_ERROR", "The delete did not take effect; the goal is still stored.", { id: args.id });
      }
      return ok({ ...result, goal: toGoalView(goal, ctx.today), verified: true });
    }),
};

const getGoalProgressSchema = z.object({
  id: z.string().min(1).describe("Exact goal id."),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe("Optional project id whose task completion should be reported alongside the goal."),
});

const getGoalProgressTool: AgentTool<typeof getGoalProgressSchema> = {
  name: "get_goal_progress",
  kind: "read",
  description:
    "Report a goal's stored progress, target date and how many days remain. When a project id is supplied it also reports that project's task completion counts, clearly labelled as derived from the project rather than from the goal.",
  schema: getGoalProgressSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const goal = await findGoalById(args.id);
      if (!goal) return fail("NOT_FOUND", `No goal exists with id "${args.id}".`, { id: args.id });

      const base = toGoalView(goal, ctx.today);

      if (goal.target_date && isValidISODate(goal.target_date)) {
        const days = diffDaysISO(ctx.today, goal.target_date);
        base.daysUntilTarget = days;
        base.overdue = days < 0 && goal.status === "active";
      }

      if (!args.projectId) {
        return ok({
          goal: base,
          /** Explicit: `progress` above is the stored value, never an estimate. */
          progressSource: "stored",
          note: "Progress is the value stored for this goal. No progress was estimated or inferred.",
        });
      }

      const project = await findProjectById(args.projectId);
      if (!project) {
        return fail("NOT_FOUND", `No project exists with id "${args.projectId}".`, { id: args.projectId });
      }

      const tasks = await getTasksByProject(args.projectId);
      const completed = tasks.filter((t) => t.completed).length;

      return ok({
        goal: base,
        progressSource: "stored",
        derivedFromProject: {
          projectId: project.id,
          projectName: project.name,
          totalTasks: tasks.length,
          completedTasks: completed,
          remainingTasks: tasks.length - completed,
          completionRatio: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : null,
          tasks: tasks.slice(0, 25).map((task) => toTaskView(task, { today: ctx.today })),
          /**
           * This ratio describes the project's tasks only. It is deliberately
           * reported as its own field so it is never presented as the goal's
           * recorded progress.
           */
          note: "This ratio is derived from the project's tasks, not from the goal's stored progress.",
        },
      });
    }),
};

export const GOAL_TOOLS = [
  getGoalsTool,
  getGoalTool,
  findGoalTool,
  createGoalTool,
  updateGoalTool,
  completeGoalTool,
  reopenGoalTool,
  deleteGoalTool,
  getGoalProgressTool,
] as unknown as AgentTool[];
