import { z } from "zod";
import {
  queryTasks,
  getTasksForDate,
  findTaskById,
  searchTasksByTitle,
  getNextIncompleteTask,
  getOverdueTasks,
  getTaskSummary,
  createTask,
  patchTask,
  toggleTaskCompletion,
  deleteTask,
} from "@/lib/db/tasks";
import { resolveProjectRef, isToolFailure, isMissing } from "./shared";
import type { AgentTool, ToolExecutionContext, ToolResult } from "../types";
import type { Task } from "@/types/task";
import {
  humanizeDate,
  diffDaysISO,
  addDaysISO,
  isValidISODate,
  formatTime12,
  weekdayShort,
} from "@/lib/dates";
import {
  ok,
  fail,
  guard,
  clarification,
  toTaskView,
  toProjectView,
  loadProjectNames,
  resolveRange,
  resolveSingleDate,
  requireSingleDate,
  resolveOptionalTime,
  whenField,
  startDateField,
  endDateField,
  timeField,
  priorityField,
  limitField,
  type TaskView,
} from "./shared";
import { getProjects } from "@/lib/db/projects";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Renders a task list together with the project names it references. */
async function presentTasks(
  tasks: Task[],
  ctx: ToolExecutionContext
): Promise<{ tasks: TaskView[]; projects: Array<Record<string, unknown>> }> {
  const names = await loadProjectNames(tasks.map((t) => t.project_id));
  const usedIds = new Set(Array.from(names.keys()));
  const projects = usedIds.size > 0 ? (await getProjects()).filter((p) => usedIds.has(p.id)).map(toProjectView) : [];

  return {
    tasks: tasks.map((task) => toTaskView(task, { today: ctx.today, projectNames: names })),
    projects,
  };
}

/**
 * Detects tasks that share an exact scheduled time on the same day.
 *
 * The schema stores no duration, so only identical time slots are reported.
 * Durations are never invented to widen the window.
 */
function findTimeConflicts(tasks: Task[], date: string, time: string | null, excludeId?: string): Task[] {
  if (!time) return [];
  return tasks.filter(
    (candidate) =>
      candidate.id !== excludeId &&
      candidate.scheduled_date === date &&
      candidate.scheduled_time === time &&
      !candidate.completed
  );
}

/**
 * Groups unfinished, timed tasks by their exact time slot. Only identical slots
 * are reported because the schema stores no duration to widen the window with.
 */
function groupTimeConflicts(tasks: Task[]): Array<{ time: string; tasks: Task[] }> {
  const byTime = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.scheduled_time || task.completed) continue;
    const bucket = byTime.get(task.scheduled_time) ?? [];
    bucket.push(task);
    byTime.set(task.scheduled_time, bucket);
  }
  return Array.from(byTime.entries())
    .filter(([, group]) => group.length > 1)
    .map(([time, group]) => ({ time, tasks: group }));
}

function missingDateQuestion(verb: string): string {
  return `Which day should I ${verb}? For example "today", "tomorrow" or "next Monday".`;
}

/* ------------------------------------------------------------------ */
/* Read tools                                                          */
/* ------------------------------------------------------------------ */

const getTasksSchema = z.object({
  when: whenField,
  startDate: startDateField,
  endDate: endDateField,
  completed: z.boolean().optional().describe("Filter by completion state. Omit to include both."),
  priority: priorityField.optional(),
  category: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  projectName: z.string().min(1).optional().describe("Project name as the user said it, e.g. \"TKS-App\"."),
  titleContains: z.string().min(1).optional().describe("Case-insensitive substring of the task title."),
  limit: limitField,
});

const getTasks: AgentTool<typeof getTasksSchema> = {
  name: "get_tasks",
  kind: "read",
  description:
    "Search stored tasks. Filter by date or date range (natural language or explicit dates), completion, priority, category, project or a title fragment. Use this before answering any question about the user's tasks, and before updating or completing one.",
  schema: getTasksSchema,
  handler: (args, ctx) =>
    guard(async () => {
      if (args.projectId || args.projectName) {
        const project = await resolveProjectRef({ projectId: args.projectId, projectName: args.projectName });
        if (isToolFailure(project)) return project;
        if (!project) return fail("VALIDATION_ERROR", "A project filter was given but could not be resolved.");
        args = { ...args, projectId: project.id };
      }

      const range = resolveRange({ startDate: args.startDate, endDate: args.endDate, when: args.when }, ctx);
      if (isToolFailure(range)) return range;

      const tasks = await queryTasks({
        startDate: isMissing(range) ? undefined : range.start,
        endDate: isMissing(range) ? undefined : range.end,
        completed: args.completed,
        priority: args.priority,
        category: args.category,
        projectId: args.projectId,
        titleContains: args.titleContains,
        limit: args.limit,
      });

      const { tasks: views, projects } = await presentTasks(tasks, ctx);

      return ok({
        filters: {
          range: isMissing(range) ? "all dates" : `${range.start}..${range.end}`,
          completed: args.completed ?? "any",
          priority: args.priority ?? "any",
          category: args.category ?? "any",
          titleContains: args.titleContains ?? null,
        },
        count: views.length,
        tasks: views,
        ...(projects.length > 0 ? { projects } : {}),
      });
    }),
};

const getTaskSchema = z.object({
  id: z.string().min(1).describe("Exact task id, as returned by get_tasks or find_task."),
});

const getTaskById: AgentTool<typeof getTaskSchema> = {
  name: "get_task",
  kind: "read",
  description: "Retrieve one task by its exact id. Use after get_tasks or find_task has identified it.",
  schema: getTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const task = await findTaskById(args.id);
      if (!task) return fail("NOT_FOUND", `No task exists with id "${args.id}".`, { id: args.id });
      const { tasks: views } = await presentTasks([task], ctx);
      return ok({ task: views[0] });
    }),
};

const findTaskSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Title or descriptive phrase to search for, e.g. "DSA" or "the meeting with mihiranga".'),
  includeCompleted: z.boolean().optional().describe("Include completed tasks. Defaults to true."),
});

const findTask: AgentTool<typeof findTaskSchema> = {
  name: "find_task",
  kind: "read",
  description:
    "Search existing tasks by title or description to resolve a reference such as \"my DSA task\". Returns ranked candidates plus an `ambiguous` flag. When `ambiguous` is true, ask the user which task they mean instead of choosing one.",
  schema: findTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const trimmed = args.query.trim();

      // A message that already carries an id should not need a text search.
      const direct = await findTaskById(trimmed);
      if (direct) {
        const { tasks: views } = await presentTasks([direct], ctx);
        return ok({
          query: trimmed,
          matchedById: true,
          ambiguous: false,
          candidateCount: 1,
          candidates: views,
          resolvedTask: views[0],
        });
      }

      let candidates = await searchTasksByTitle(trimmed);
      if (args.includeCompleted === false) {
        candidates = candidates.filter((c) => !c.completed);
      }

      const { tasks: views } = await presentTasks(candidates.slice(0, 5), ctx);

      // Only the plausible head of the ranking counts towards ambiguity.
      const ambiguous = views.length > 1;

      return ok({
        query: trimmed,
        matchedById: false,
        ambiguous,
        candidateCount: views.length,
        candidates: views,
        ...(ambiguous
          ? {
              instruction:
                "More than one stored task matches. Ask the user which one they mean and do not modify anything yet.",
            }
          : { resolvedTask: views[0] ?? null }),
        ...(views.length === 0 ? { note: "No stored task matches that description." } : {}),
      });
    }),
};

const getTodayTasksSchema = z.object({
  includeCompleted: z.boolean().optional().describe("Include tasks already completed today. Defaults to true."),
});

const getTodayTasks: AgentTool<typeof getTodayTasksSchema> = {
  name: "get_today_tasks",
  kind: "read",
  description:
    "Return every task scheduled for today in the application timezone, including overdue unfinished tasks. Use this for \"what do I have today\" and for daily summaries.",
  schema: getTodayTasksSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const todays = await getTasksForDate(ctx.today);
      const overdue = await getOverdueTasks(ctx.today);
      const visible = args.includeCompleted === false ? todays.filter((t) => !t.completed) : todays;

      const { tasks: views, projects } = await presentTasks(visible, ctx);
      const { tasks: overdueViews } = await presentTasks(overdue.slice(0, 10), ctx);

      const remaining = visible.filter((t) => !t.completed);
      const conflicts = groupTimeConflicts(visible);

      return ok({
        date: ctx.today,
        dateLabel: `${weekdayShort(ctx.today)} ${humanizeDate(ctx.today, ctx.today)}`,
        timezone: ctx.timezone,
        counts: {
          total: todays.length,
          remaining: remaining.length,
          completed: todays.filter((t) => t.completed).length,
          overdue: overdue.length,
        },
        tasks: views,
        overdueTasks: overdueViews,
        ...(conflicts.length > 0
          ? {
              timeConflicts: conflicts.map((group) => ({
                time: group.time,
                tasks: group.tasks.map((t) => ({ id: t.id, title: t.title })),
              })),
            }
          : {}),
        ...(projects.length > 0 ? { projects } : {}),
      });
    }),
};

const getNextTaskSchema = z.object({
  fromDate: z.string().optional().describe("YYYY-MM-DD. Defaults to today."),
  includeToday: z.boolean().optional().describe("Consider tasks scheduled today. Defaults to true."),
});

const getNextTask: AgentTool<typeof getNextTaskSchema> = {
  name: "get_next_task",
  kind: "read",
  description:
    "Return the next upcoming incomplete task, earliest date first and then by time and priority. Also reports how many tasks are overdue.",
  schema: getNextTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const from = args.fromDate ?? ctx.today;
      if (!isValidISODate(from)) {
        return fail("VALIDATION_ERROR", `"${from}" is not a valid YYYY-MM-DD date.`, { field: "fromDate" });
      }

      const task = await getNextIncompleteTask(from);
      const overdue = await getOverdueTasks(ctx.today);
      const todaysRemaining = (await getTasksForDate(ctx.today)).filter(
        (t) => !t.completed && args.includeToday !== false
      );

      if (!task && overdue.length === 0 && todaysRemaining.length === 0) {
        return ok({
          found: false,
          fromDate: from,
          message: "There are no outstanding tasks scheduled on or after that date.",
          overdueCount: 0,
        });
      }

      const { tasks: views } = task ? await presentTasks([task], ctx) : { tasks: [] };

      const reasons: string[] = [];
      if (task) {
        const delta = diffDaysISO(ctx.today, task.scheduled_date);
        reasons.push(delta < 0 ? `scheduled ${-delta} day(s) ago and still open` : humanizeDate(task.scheduled_date, ctx.today));
        if (task.priority === "high") reasons.push("high priority");
        if (task.scheduled_time) reasons.push(`at ${formatTime12(task.scheduled_time)}`);
      }

      return ok({
        found: Boolean(task),
        fromDate: from,
        nextTask: views[0] ?? null,
        reason: reasons.join(", ") || "no outstanding tasks",
        overdueCount: overdue.length,
        todayRemainingCount: todaysRemaining.length,
      });
    }),
};

const getScheduleSchema = z.object({
  when: whenField,
  startDate: startDateField,
  endDate: endDateField,
  days: z.number().int().min(1).max(60).optional().describe("Window length when no dates are given. Defaults to 7."),
  includeCompleted: z.boolean().optional().describe("Include completed entries. Defaults to false."),
  limit: limitField,
});

const getSchedule: AgentTool<typeof getScheduleSchema> = {
  name: "get_schedule",
  kind: "read",
  description:
    "Return upcoming schedule entries from the application's internal schedule for a date or date range. This is the app's own stored schedule, not an external calendar. Use it for \"what's coming up\", \"my schedule this week\" and similar.",
  schema: getScheduleSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const range = resolveRange({ startDate: args.startDate, endDate: args.endDate, when: args.when }, ctx);
      if (isToolFailure(range)) return range;

      const window = isMissing(range) ? { start: ctx.today, end: addDaysISO(ctx.today, args.days ?? 7) } : range;

      const tasks = await queryTasks({
        startDate: window.start,
        endDate: window.end,
        limit: args.limit ?? 100,
      });
      const visible = args.includeCompleted === false ? tasks.filter((t) => !t.completed) : tasks;

      const { tasks: views, projects } = await presentTasks(visible, ctx);

      // Group by day so the model does not have to.
      const byDate = new Map<string, TaskView[]>();
      for (const view of views) {
        const bucket = byDate.get(view.scheduledDate) ?? [];
        bucket.push(view);
        byDate.set(view.scheduledDate, bucket);
      }

      const days_list = Array.from(byDate.entries()).map(([date, entries]) => {
        const conflicts = groupTimeConflicts(visible.filter((t) => t.scheduled_date === date));

        return {
          date,
          label: humanizeDate(date, ctx.today),
          weekday: weekdayShort(date),
          count: entries.length,
          remaining: entries.filter((e) => !e.completed).length,
          tasks: entries,
          ...(conflicts.length > 0
            ? {
                timeConflicts: conflicts.map((group) => ({
                  time: group.time,
                  tasks: group.tasks.map((t) => ({ id: t.id, title: t.title })),
                  note: "Same scheduled time; no duration is stored, so only exact slot matches are reported.",
                })),
              }
            : {}),
        };
      });

      return ok({
        range: `${window.start}..${window.end}`,
        timezone: ctx.timezone,
        source: "internal_schedule",
        totalEntries: views.length,
        days: days_list,
        ...(projects.length > 0 ? { projects } : {}),
        ...(views.length === 0
          ? { note: "The schedule was read successfully and there is nothing scheduled in this window." }
          : {}),
      });
    }),
};

const getTaskSummarySchema = z.object({
  when: whenField,
  startDate: startDateField,
  endDate: endDateField,
});

const getTaskSummaryTool: AgentTool<typeof getTaskSummarySchema> = {
  name: "get_task_summary",
  kind: "read",
  description:
    "Return counted statistics for a period: total, completed, remaining, overdue and how many open tasks remain per priority, plus a per-day breakdown. Use for \"how is my day/week going\" and daily briefings instead of counting rows yourself.",
  schema: getTaskSummarySchema,
  handler: (args, ctx) =>
    guard(async () => {
      const range = resolveRange({ startDate: args.startDate, endDate: args.endDate, when: args.when }, ctx);
      if (isToolFailure(range)) return range;

      const window = isMissing(range) ? { start: ctx.today, end: ctx.today } : range;
      const summary = await getTaskSummary(window.start, window.end, ctx.today);
      const overdue = await getOverdueTasks(ctx.today, 20);
      const { tasks: overdueViews } = await presentTasks(overdue, ctx);

      return ok({
        range: `${window.start}..${window.end}`,
        timezone: ctx.timezone,
        ...summary,
        overdueTasks: overdueViews,
      });
    }),
};

/* ------------------------------------------------------------------ */
/* Write tools                                                         */
/* ------------------------------------------------------------------ */

const createTaskSchema = z.object({
  title: z.string().min(1).describe("Short title of the task."),
  when: whenField,
  scheduledDate: z.string().optional().describe("Exact date YYYY-MM-DD. Prefer `when` for relative phrases."),
  scheduledTime: timeField,
  description: z.string().optional(),
  priority: priorityField.optional().describe("Defaults to medium when the user does not say."),
  category: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  projectName: z.string().min(1).optional().describe("Project name the user mentioned; it will be resolved to an id."),
});

const createTaskTool: AgentTool<typeof createTaskSchema> = {
  name: "create_task",
  kind: "write",
  description:
    "Create one task. Pass the user's own date wording in `when` (for example \"tomorrow at 7 PM\") instead of computing a date. Only call this when the user asked for a task to be created.",
  schema: createTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      if (!args.title.trim()) {
        return clarification("What should the task be called?");
      }

      const projectRef = await resolveProjectRef({ projectId: args.projectId, projectName: args.projectName });
      if (isToolFailure(projectRef)) return projectRef;

      const date = requireSingleDate(
        { scheduledDate: args.scheduledDate, when: args.when },
        ctx,
        missingDateQuestion(`schedule "${args.title.trim()}"`)
      );
      if (isToolFailure(date)) return date;

      const time = resolveOptionalTime({ scheduledTime: args.scheduledTime, when: args.when });
      if (isToolFailure(time)) return time;

      const existing = await getTasksForDate(date.date);
      const conflicts = findTimeConflicts(existing, date.date, time.time);
      const duplicates = existing.filter(
        (t) => !t.completed && t.title.trim().toLowerCase() === args.title.trim().toLowerCase()
      );

      const created = await createTask({
        title: args.title.trim(),
        description: args.description,
        scheduled_date: date.date,
        scheduled_time: time.time ?? undefined,
        priority: args.priority ?? "medium",
        category: args.category,
        project_id: projectRef?.id ?? null,
      });

      const { tasks: views } = await presentTasks([created], ctx);

      const warnings: Array<Record<string, unknown>> = [];
      if (conflicts.length > 0) {
        warnings.push({
          type: "time_conflict",
          message: `Another unfinished task is already scheduled at ${formatTime12(time.time!)} on ${date.date}.`,
          tasks: conflicts.map((t) => ({ id: t.id, title: t.title, scheduledTime: t.scheduled_time })),
        });
      }
      if (duplicates.length > 0) {
        warnings.push({
          type: "possible_duplicate",
          message: "An unfinished task with the same title already exists on that date.",
          tasks: duplicates.map((t) => ({ id: t.id, title: t.title })),
        });
      }

      return ok({
        /** Re-read from the database, so this reflects stored state. */
        task: views[0],
        verified: true,
        dateAssumption:
          date.source === "expression"
            ? `Interpreted "${date.phrase}" as ${date.date}.`
            : `Used the explicit date ${date.date}.`,
        ...(time.time
          ? { timeAssumption: time.approximate ? `Interpreted the time as ${formatTime12(time.time)}.` : undefined }
          : {}),
        ...(projectRef?.resolvedFromName ? { projectResolvedFromName: projectRef.name } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }),
};

const updateTaskSchema = z.object({
  id: z.string().min(1).describe("Exact id of the task to update. Resolve it with find_task or get_tasks first."),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional().describe("Pass null to remove the description."),
  when: whenField,
  scheduledDate: z.string().optional().describe("Exact new date YYYY-MM-DD. Prefer `when` for relative phrases."),
  scheduledTime: timeField,
  clearTime: z.boolean().optional().describe("Set true to remove the scheduled time entirely."),
  priority: priorityField.optional(),
  category: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  projectName: z.string().min(1).optional(),
  clearProject: z.boolean().optional().describe("Set true to detach the task from its project."),
});

const updateTaskTool: AgentTool<typeof updateTaskSchema> = {
  name: "update_task",
  kind: "write",
  description:
    "Update selected fields of one existing task. Fields you omit are left exactly as they are, so a date change never resets priority, project or description. Always resolve the exact task id first.",
  schema: updateTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const before = await findTaskById(args.id);
      if (!before) {
        return fail("NOT_FOUND", `No task exists with id "${args.id}". Resolve the task first with find_task.`, {
          id: args.id,
        });
      }

      const patch: Parameters<typeof patchTask>[1] = {};

      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.priority !== undefined) patch.priority = args.priority;
      if (args.category !== undefined) patch.category = args.category;

      if (args.clearProject) patch.project_id = null;
      else if (args.projectId !== undefined && args.projectId !== null) patch.project_id = args.projectId;
      else if (args.projectName) {
        const projectRef = await resolveProjectRef({ projectName: args.projectName });
        if (isToolFailure(projectRef)) return projectRef;
        if (projectRef) patch.project_id = projectRef.id;
      }

      if (args.clearTime) {
        patch.scheduled_time = null;
      }

      const date = resolveSingleDate({ scheduledDate: args.scheduledDate, when: args.when }, ctx);
      if (isToolFailure(date)) return date;
      if (!isMissing(date)) patch.scheduled_date = date.date;

      if (!args.clearTime) {
        const time = resolveOptionalTime({ scheduledTime: args.scheduledTime, when: args.when });
        if (isToolFailure(time)) return time;
        if (time.time !== null) patch.scheduled_time = time.time;
      }

      if (Object.keys(patch).length === 0) {
        return clarification(
          `What would you like to change about "${before.title}"? I did not receive any field to update.`
        );
      }

      const updated = await patchTask(args.id, patch);
      const { tasks: views } = await presentTasks([updated], ctx);

      // Report only the fields that actually changed.
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      const beforeView = toTaskView(before, { today: ctx.today });
      const afterView = views[0];
      for (const key of ["title", "description", "scheduledDate", "scheduledTime", "priority", "category", "projectId"] as const) {
        if (beforeView[key] !== afterView[key]) changed[key] = { from: beforeView[key], to: afterView[key] };
      }

      let conflicts: Task[] = [];
      if (patch.scheduled_date !== undefined || patch.scheduled_time !== undefined) {
        conflicts = findTimeConflicts(
          await getTasksForDate(updated.scheduled_date),
          updated.scheduled_date,
          updated.scheduled_time,
          updated.id
        );
      }

      return ok({
        task: afterView,
        verified: true,
        changedFields: Object.keys(changed),
        previousValues: beforeView,
        ...(!isMissing(date) && date.source === "expression"
          ? { dateAssumption: `Interpreted "${date.phrase}" as ${date.date}.` }
          : {}),
        ...(conflicts.length > 0
          ? {
              warnings: [
                {
                  type: "time_conflict",
                  message: `Another unfinished task already occupies that time slot on ${updated.scheduled_date}.`,
                  tasks: conflicts.map((t) => ({ id: t.id, title: t.title })),
                },
              ],
            }
          : {}),
      });
    }),
};

const completeTaskSchema = z.object({
  id: z.string().min(1).describe("Exact id of the task to mark complete. Resolve it first."),
});

const completeTaskTool: AgentTool<typeof completeTaskSchema> = {
  name: "complete_task",
  kind: "write",
  description:
    "Mark one task as complete. Resolve the exact id with find_task or get_tasks first; if more than one task matches the user's description, ask them which one before calling this.",
  schema: completeTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const before = await findTaskById(args.id);
      if (!before) {
        return fail("NOT_FOUND", `No task exists with id "${args.id}". Resolve the task first with find_task.`, {
          id: args.id,
        });
      }
      // Reporting `alreadyCompleted` matters: without it the model would claim
      // it completed a task that was already complete.
      const wasComplete = Boolean(before.completed);
      const task = await toggleTaskCompletion(args.id, true);
      const { tasks: views } = await presentTasks([task], ctx);
      return ok({ task: views[0], verified: true, alreadyCompleted: wasComplete, changed: !wasComplete });
    }),
};

const reopenTaskSchema = z.object({
  id: z.string().min(1).describe("Exact id of the completed task to reopen."),
});

const reopenTaskTool: AgentTool<typeof reopenTaskSchema> = {
  name: "reopen_task",
  kind: "write",
  description: "Reopen a task that was previously marked complete, returning it to the outstanding list.",
  schema: reopenTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const before = await findTaskById(args.id);
      if (!before) return fail("NOT_FOUND", `No task exists with id "${args.id}".`, { id: args.id });
      if (!before.completed) {
        const { tasks: views } = await presentTasks([before], ctx);
        return ok({ task: views[0], verified: true, alreadyOpen: true });
      }
      const task = await toggleTaskCompletion(args.id, false);
      const { tasks: views } = await presentTasks([task], ctx);
      return ok({ task: views[0], verified: true, alreadyOpen: false });
    }),
};

const deleteTaskSchema = z.object({
  id: z.string().min(1).describe("Exact id of the task to delete."),
  confirm: z.boolean().optional().describe("Must be true. Only pass true after the user has explicitly confirmed."),
});

const deleteTaskTool: AgentTool<typeof deleteTaskSchema> = {
  name: "delete_task",
  kind: "write",
  description:
    "Permanently delete one task. Resolve the exact id first and pass confirm: true only when the user has clearly agreed to delete it. If the reference is ambiguous, ask instead of deleting.",
  schema: deleteTaskSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const task = await findTaskById(args.id);
      if (!task) return fail("NOT_FOUND", `No task exists with id "${args.id}".`, { id: args.id });

      if (args.confirm !== true) {
        const { tasks: views } = await presentTasks([task], ctx);
        return fail("CONFIRMATION_REQUIRED", `Deleting "${task.title}" cannot be undone. Confirm with the user first.`, {
          task: views[0],
        });
      }

      const deleted = await deleteTask(args.id);
      // Verify the row is genuinely gone.
      const stillThere = await findTaskById(args.id);
      if (stillThere) {
        return fail("TOOL_ERROR", "The delete did not take effect; the task is still stored.", { id: args.id });
      }

      return ok({
        deleted: deleted.deleted,
        task: toTaskView(task, { today: ctx.today }),
        verified: true,
      });
    }),
};

export const TASK_TOOLS = [
  getTasks,
  getTaskById,
  findTask,
  getTodayTasks,
  getNextTask,
  getSchedule,
  getTaskSummaryTool,
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  reopenTaskTool,
  deleteTaskTool,
] as unknown as AgentTool[];
