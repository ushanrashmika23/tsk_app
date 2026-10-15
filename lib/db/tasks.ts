import { getDb } from "./client";
import { Task, TaskInput, Priority } from "@/types/task";
import { NotFoundError, ToolValidationError } from "@/lib/errors";
import { isValidISODate, isValidTime24 } from "@/lib/dates";

/** Hard ceiling on rows returned by any single query, to bound token usage. */
export const MAX_ROWS = 200;

const TASK_COLUMNS =
  "id, title, description, project_id, scheduled_date, scheduled_time, priority, category, completed, completed_at, created_at, updated_at";

/** Normalises a raw D1 row: SQLite has no booleans and stores empty strings. */
export function normalizeTaskRow(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: (row.description as string | null) ?? null,
    project_id: (row.project_id as string | null) ?? null,
    scheduled_date: String(row.scheduled_date ?? ""),
    scheduled_time: (row.scheduled_time as string | null) || null,
    priority: ((row.priority as string) || "medium") as Priority,
    category: (row.category as string | null) || null,
    completed: Number(row.completed ?? 0) ? 1 : 0,
    completed_at: (row.completed_at as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function requireISODate(value: unknown, field: string): string {
  if (!isValidISODate(value)) {
    throw new ToolValidationError(`"${field}" must be a valid YYYY-MM-DD date.`, { field, value });
  }
  return value;
}

function clampLimit(limit: number | undefined, fallback = MAX_ROWS): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), MAX_ROWS);
}

/** Counts rows changed by a mutation, using D1's `meta.changes`. */
function rowsChanged(meta: { changes?: number }): number {
  return Number(meta?.changes ?? 0);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** All tasks scheduled on exactly one day, most important first. */
export async function getTasksForDate(date: string): Promise<Task[]> {
  requireISODate(date, "date");
  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE scheduled_date = ?
       ORDER BY completed ASC, priority DESC, scheduled_time IS NULL, scheduled_time ASC, title ASC
       LIMIT ?`
    )
    .bind(date, MAX_ROWS)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeTaskRow);
}

export interface TaskQuery {
  startDate?: string;
  endDate?: string;
  completed?: boolean;
  priority?: Priority;
  category?: string;
  projectId?: string;
  /** Case-insensitive substring match against the title. */
  titleContains?: string;
  limit?: number;
}

/**
 * Bounded, filtered task search. All user-supplied values are bound as SQL
 * parameters; nothing is interpolated into the statement.
 */
export async function queryTasks(query: TaskQuery = {}): Promise<Task[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.startDate !== undefined) {
    conditions.push("scheduled_date >= ?");
    params.push(requireISODate(query.startDate, "startDate"));
  }
  if (query.endDate !== undefined) {
    conditions.push("scheduled_date <= ?");
    params.push(requireISODate(query.endDate, "endDate"));
  }
  if (query.completed !== undefined) {
    conditions.push("completed = ?");
    params.push(query.completed ? 1 : 0);
  }
  if (query.priority !== undefined) {
    conditions.push("priority = ?");
    params.push(query.priority);
  }
  if (query.category !== undefined) {
    conditions.push("category = ?");
    params.push(query.category);
  }
  if (query.projectId !== undefined) {
    conditions.push("project_id = ?");
    params.push(query.projectId);
  }
  if (query.titleContains !== undefined && query.titleContains.trim() !== "") {
    conditions.push("LOWER(title) LIKE ?");
    params.push(`%${query.titleContains.trim().toLowerCase()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT ${TASK_COLUMNS} FROM tasks ${where}
    ORDER BY scheduled_date ASC, completed ASC, priority DESC, scheduled_time IS NULL, scheduled_time ASC
    LIMIT ?`;

  const result = await getDb()
    .prepare(sql)
    .bind(...params, clampLimit(query.limit))
    .all<Record<string, unknown>>();

  return (result.results ?? []).map(normalizeTaskRow);
}

export async function getAllTasks(): Promise<Task[]> {
  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks
       ORDER BY scheduled_date ASC, completed ASC, priority DESC, scheduled_time IS NULL, scheduled_time ASC
       LIMIT ?`
    )
    .bind(MAX_ROWS)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeTaskRow);
}

export async function getUpcomingTasks(fromDate: string, limit = MAX_ROWS): Promise<Task[]> {
  requireISODate(fromDate, "fromDate");
  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE scheduled_date >= ?
       ORDER BY scheduled_date ASC, scheduled_time IS NULL, scheduled_time ASC, completed ASC, priority DESC
       LIMIT ?`
    )
    .bind(fromDate, clampLimit(limit))
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeTaskRow);
}

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id = ?
       ORDER BY completed ASC, scheduled_date ASC, priority DESC LIMIT ?`
    )
    .bind(projectId, MAX_ROWS)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeTaskRow);
}

export async function getTasksWithoutProject(): Promise<Task[]> {
  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id IS NULL
       ORDER BY completed ASC, scheduled_date ASC, priority DESC LIMIT ?`
    )
    .bind(MAX_ROWS)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeTaskRow);
}

/** Returns `null` instead of throwing, for callers that probe by id. */
export async function findTaskById(id: string): Promise<Task | null> {
  if (!id || typeof id !== "string") return null;
  const row = await getDb()
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? normalizeTaskRow(row) : null;
}

export async function getTask(id: string): Promise<Task> {
  const task = await findTaskById(id);
  if (!task) {
    throw new NotFoundError(`No task exists with id "${id}".`, { id });
  }
  return task;
}

/** Word-overlap search used to resolve "my DSA task" style references. */
export async function searchTasksByTitle(phrase: string, limit = 25): Promise<Task[]> {
  const terms = phrase
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  if (terms.length === 0) return [];

  const conditions = terms.map(() => "LOWER(title) LIKE ?").join(" OR ");
  const params = terms.map((t) => `%${t}%`);

  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${conditions}
       ORDER BY completed ASC, scheduled_date ASC LIMIT ?`
    )
    .bind(...params, clampLimit(limit))
    .all<Record<string, unknown>>();

  const tasks = (result.results ?? []).map(normalizeTaskRow);

  // Rank by how many of the user's terms the title actually contains, then by
  // whether the term appears as a whole word. The caller decides whether the
  // top match is unambiguous — this function never picks a winner.
  return tasks
    .map((task) => {
      const title = task.title.toLowerCase();
      const hits = terms.filter((t) => title.includes(t)).length;
      const exactWord = terms.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title));
      return { task, score: hits * 10 + (exactWord ? 5 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.task.scheduled_date.localeCompare(b.task.scheduled_date))
    .map((entry) => entry.task);
}

/** The first incomplete task at or after `fromDate`, time-ordered. */
export async function getNextIncompleteTask(fromDate: string): Promise<Task | null> {
  requireISODate(fromDate, "fromDate");
  const row = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE completed = 0 AND scheduled_date >= ?
       ORDER BY scheduled_date ASC, scheduled_time IS NULL, scheduled_time ASC,
                CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC
       LIMIT 1`
    )
    .bind(fromDate)
    .first<Record<string, unknown>>();
  return row ? normalizeTaskRow(row) : null;
}

/** Incomplete tasks from dates before `date` (i.e. overdue). */
export async function getOverdueTasks(date: string, limit = 50): Promise<Task[]> {
  requireISODate(date, "date");
  const result = await getDb()
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE completed = 0 AND scheduled_date < ?
       ORDER BY scheduled_date ASC, priority DESC LIMIT ?`
    )
    .bind(date, clampLimit(limit))
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeTaskRow);
}

export interface TaskSummary {
  startDate: string;
  endDate: string;
  total: number;
  completed: number;
  remaining: number;
  overdue: number;
  byPriority: Record<Priority, number>;
  /** Per-day remaining counts, only for days that have tasks. */
  byDate: Array<{ date: string; total: number; completed: number; remaining: number }>;
}

/**
 * Server-side aggregates for "summarise my day/week" requests. Counting is
 * done in SQL so the numbers cannot drift from what the UI shows.
 */
export async function getTaskSummary(startDate: string, endDate: string, today: string): Promise<TaskSummary> {
  requireISODate(startDate, "startDate");
  requireISODate(endDate, "endDate");
  requireISODate(today, "today");

  const totals = await getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(completed), 0) AS completed,
         COALESCE(SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END), 0) AS high_remaining_total,
         COALESCE(SUM(CASE WHEN priority = 'medium' THEN 1 ELSE 0 END), 0) AS medium_total,
         COALESCE(SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END), 0) AS low_total,
         COALESCE(SUM(CASE WHEN completed = 0 AND priority = 'high' THEN 1 ELSE 0 END), 0) AS high_remaining,
         COALESCE(SUM(CASE WHEN completed = 0 AND priority = 'medium' THEN 1 ELSE 0 END), 0) AS medium_remaining,
         COALESCE(SUM(CASE WHEN completed = 0 AND priority = 'low' THEN 1 ELSE 0 END), 0) AS low_remaining
       FROM tasks WHERE scheduled_date BETWEEN ? AND ?`
    )
    .bind(startDate, endDate)
    .first<Record<string, number>>();

  const overdueRow = await getDb()
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE completed = 0 AND scheduled_date < ?")
    .bind(today)
    .first<{ count: number }>();

  const perDay = await getDb()
    .prepare(
      `SELECT scheduled_date AS date,
              COUNT(*) AS total,
              COALESCE(SUM(completed), 0) AS completed
       FROM tasks WHERE scheduled_date BETWEEN ? AND ?
       GROUP BY scheduled_date ORDER BY scheduled_date ASC`
    )
    .bind(startDate, endDate)
    .all<{ date: string; total: number; completed: number }>();

  const total = Number(totals?.total ?? 0);
  const completed = Number(totals?.completed ?? 0);

  return {
    startDate,
    endDate,
    total,
    completed,
    remaining: total - completed,
    overdue: Number(overdueRow?.count ?? 0),
    byPriority: {
      high: Number(totals?.high_remaining ?? 0),
      medium: Number(totals?.medium_remaining ?? 0),
      low: Number(totals?.low_remaining ?? 0),
    },
    byDate: (perDay.results ?? []).map((row) => ({
      date: row.date,
      total: Number(row.total),
      completed: Number(row.completed),
      remaining: Number(row.total) - Number(row.completed),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createTask(input: TaskInput): Promise<Task> {
  if (!input.title || input.title.trim() === "") {
    throw new ToolValidationError("A task needs a non-empty title.", { field: "title" });
  }
  requireISODate(input.scheduled_date, "scheduled_date");
  if (input.scheduled_time != null && !isValidTime24(input.scheduled_time)) {
    throw new ToolValidationError('"scheduled_time" must be HH:MM (24 hour).', {
      field: "scheduled_time",
      value: input.scheduled_time,
    });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO tasks (id, title, description, project_id, scheduled_date, scheduled_time, priority, category, completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id,
      input.title.trim(),
      input.description?.trim() || null,
      input.project_id || null,
      input.scheduled_date,
      input.scheduled_time || null,
      input.priority || "medium",
      input.category?.trim() || null,
      now,
      now
    )
    .run();

  // Re-read from the database so the caller reports stored state, not intent.
  return getTask(id);
}

/**
 * Patch semantics: an omitted key leaves the column untouched, while an
 * explicit `null` clears it. This is what makes "move it to Friday" preserve
 * the task's priority, project and description.
 */
export interface TaskPatch {
  title?: string;
  description?: string | null;
  project_id?: string | null;
  scheduled_date?: string;
  scheduled_time?: string | null;
  priority?: Priority;
  category?: string | null;
}

export async function patchTask(id: string, patch: TaskPatch): Promise<Task> {
  const current = await getTask(id);

  const next = {
    title: patch.title !== undefined ? patch.title.trim() : current.title,
    description: patch.description !== undefined ? patch.description : current.description,
    project_id: patch.project_id !== undefined ? patch.project_id : current.project_id,
    scheduled_date: patch.scheduled_date !== undefined ? patch.scheduled_date : current.scheduled_date,
    scheduled_time: patch.scheduled_time !== undefined ? patch.scheduled_time : current.scheduled_time,
    priority: patch.priority !== undefined ? patch.priority : current.priority,
    category: patch.category !== undefined ? patch.category : current.category,
  };

  if (next.title === "") {
    throw new ToolValidationError("A task title cannot be empty.", { field: "title" });
  }
  requireISODate(next.scheduled_date, "scheduled_date");
  if (next.scheduled_time != null && !isValidTime24(next.scheduled_time)) {
    throw new ToolValidationError('"scheduled_time" must be HH:MM (24 hour).', {
      field: "scheduled_time",
      value: next.scheduled_time,
    });
  }

  const now = new Date().toISOString();
  const result = await getDb()
    .prepare(
      `UPDATE tasks
       SET title = ?, description = ?, project_id = ?, scheduled_date = ?, scheduled_time = ?,
           priority = ?, category = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      next.title,
      next.description,
      next.project_id,
      next.scheduled_date,
      next.scheduled_time,
      next.priority,
      next.category,
      now,
      id
    )
    .run();

  if (rowsChanged(result.meta) === 0) {
    throw new NotFoundError(`No task exists with id "${id}", so nothing was updated.`, { id });
  }

  return getTask(id);
}

/** Backwards-compatible wrapper used by the existing server actions. */
export async function updateTask(id: string, updates: Partial<TaskInput>): Promise<Task> {
  return patchTask(id, {
    title: updates.title,
    description: updates.description !== undefined ? updates.description ?? null : undefined,
    project_id: updates.project_id !== undefined ? updates.project_id : undefined,
    scheduled_date: updates.scheduled_date,
    scheduled_time: updates.scheduled_time !== undefined ? updates.scheduled_time ?? null : undefined,
    priority: updates.priority,
    category: updates.category !== undefined ? updates.category ?? null : undefined,
  });
}

export async function toggleTaskCompletion(id: string, completed: boolean): Promise<Task> {
  const current = await getTask(id);

  if (Boolean(current.completed) === completed) {
    // Already in the requested state — report the stored row without a write.
    return current;
  }

  const now = new Date().toISOString();
  const result = await getDb()
    .prepare("UPDATE tasks SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .bind(completed ? 1 : 0, completed ? now : null, now, id)
    .run();

  if (rowsChanged(result.meta) === 0) {
    throw new NotFoundError(`No task exists with id "${id}", so nothing was changed.`, { id });
  }

  return getTask(id);
}

/**
 * Deletes a task and reports whether a row was actually removed, so the agent
 * never claims a delete that matched nothing.
 */
export async function deleteTask(id: string): Promise<{ id: string; deleted: true }> {
  const result = await getDb().prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  if (rowsChanged(result.meta) === 0) {
    throw new NotFoundError(`No task exists with id "${id}", so nothing was deleted.`, { id });
  }
  return { id, deleted: true };
}
