import { getDb } from "./client";
import { Goal, GoalInput, GoalStatus } from "@/types/goal";
import { NotFoundError, ToolValidationError } from "@/lib/errors";
import { isValidISODate } from "@/lib/dates";

export const MAX_GOAL_ROWS = 200;

const GOAL_COLUMNS = "id, title, description, target_date, progress, status, created_at, updated_at";

export function normalizeGoalRow(row: Record<string, unknown>): Goal {
  const progress = Number(row.progress ?? 0);
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: (row.description as string | null) ?? null,
    target_date: (row.target_date as string | null) || null,
    progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, Math.round(progress))) : 0,
    status: ((row.status as string) || "active") as GoalStatus,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function rowsChanged(meta: { changes?: number }): number {
  return Number(meta?.changes ?? 0);
}

function validateTargetDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isValidISODate(value)) {
    throw new ToolValidationError('"targetDate" must be a valid YYYY-MM-DD date.', {
      field: "targetDate",
      value,
    });
  }
  return value;
}

export async function getGoals(status?: GoalStatus): Promise<Goal[]> {
  const db = getDb();
  const statement =
    status === undefined
      ? db
          .prepare(`SELECT ${GOAL_COLUMNS} FROM goals ORDER BY status ASC, target_date IS NULL, target_date ASC LIMIT ?`)
          .bind(MAX_GOAL_ROWS)
      : db
          .prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE status = ? ORDER BY target_date IS NULL, target_date ASC LIMIT ?`)
          .bind(status, MAX_GOAL_ROWS);

  const result = await statement.all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeGoalRow);
}

export async function getActiveGoals(): Promise<Goal[]> {
  const result = await getDb()
    .prepare(
      `SELECT ${GOAL_COLUMNS} FROM goals WHERE status = 'active'
       ORDER BY target_date IS NULL, target_date ASC, created_at ASC LIMIT ?`
    )
    .bind(MAX_GOAL_ROWS)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeGoalRow);
}

/** Returns `null` instead of throwing, for callers that probe by id. */
export async function findGoalById(id: string): Promise<Goal | null> {
  if (!id || typeof id !== "string") return null;
  const row = await getDb()
    .prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? normalizeGoalRow(row) : null;
}

export async function getGoal(id: string): Promise<Goal> {
  const goal = await findGoalById(id);
  if (!goal) {
    throw new NotFoundError(`No goal exists with id "${id}".`, { id });
  }
  return goal;
}

/** Every goal whose title plausibly matches, most likely first. */
export async function searchGoalsByTitle(phrase: string): Promise<Goal[]> {
  const terms = phrase
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  if (terms.length === 0) return [];

  const conditions = terms.map(() => "LOWER(title) LIKE ?").join(" OR ");
  const result = await getDb()
    .prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE ${conditions} ORDER BY created_at ASC LIMIT 25`)
    .bind(...terms.map((t) => `%${t}%`))
    .all<Record<string, unknown>>();

  return (result.results ?? [])
    .map((row) => normalizeGoalRow(row))
    .map((goal) => {
      const title = goal.title.toLowerCase();
      return { goal, score: terms.filter((t) => title.includes(t)).length };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.goal);
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const title = input.title?.trim();
  if (!title) {
    throw new ToolValidationError("A goal needs a non-empty title.", { field: "title" });
  }

  const targetDate = validateTargetDate(input.target_date);
  const progress = input.progress ?? 0;
  if (progress < 0 || progress > 100) {
    throw new ToolValidationError('"progress" must be between 0 and 100.', { field: "progress", value: progress });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO goals (id, title, description, target_date, progress, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, title, input.description?.trim() || null, targetDate, Math.round(progress), input.status || "active", now, now)
    .run();

  return getGoal(id);
}

export interface GoalPatch {
  title?: string;
  description?: string | null;
  target_date?: string | null;
  progress?: number;
  status?: GoalStatus;
}

/** Omitted keys are preserved; an explicit `null` clears the column. */
export async function patchGoal(id: string, patch: GoalPatch): Promise<Goal> {
  const current = await getGoal(id);

  const next = {
    title: patch.title !== undefined ? patch.title.trim() : current.title,
    description: patch.description !== undefined ? patch.description : current.description,
    target_date: patch.target_date !== undefined ? validateTargetDate(patch.target_date) : current.target_date,
    progress: patch.progress !== undefined ? patch.progress : current.progress,
    status: patch.status !== undefined ? patch.status : current.status,
  };

  if (!next.title) {
    throw new ToolValidationError("A goal title cannot be empty.", { field: "title" });
  }
  if (!Number.isFinite(next.progress) || next.progress < 0 || next.progress > 100) {
    throw new ToolValidationError('"progress" must be between 0 and 100.', {
      field: "progress",
      value: patch.progress,
    });
  }

  const result = await getDb()
    .prepare(
      "UPDATE goals SET title = ?, description = ?, target_date = ?, progress = ?, status = ?, updated_at = ? WHERE id = ?"
    )
    .bind(
      next.title,
      next.description,
      next.target_date,
      Math.round(next.progress),
      next.status,
      new Date().toISOString(),
      id
    )
    .run();

  if (rowsChanged(result.meta) === 0) {
    throw new NotFoundError(`No goal exists with id "${id}", so nothing was updated.`, { id });
  }

  return getGoal(id);
}

/** Backwards-compatible wrapper used by the existing server actions. */
export async function updateGoal(id: string, updates: Partial<GoalInput>): Promise<Goal> {
  return patchGoal(id, {
    title: updates.title,
    description: updates.description !== undefined ? updates.description : undefined,
    target_date: updates.target_date !== undefined ? updates.target_date : undefined,
    progress: updates.progress,
    status: updates.status,
  });
}

export async function completeGoal(id: string): Promise<Goal> {
  await getGoal(id);
  return patchGoal(id, { status: "completed", progress: 100 });
}

export async function reopenGoal(id: string): Promise<Goal> {
  const current = await getGoal(id);
  // Progress is preserved rather than reset — the user's recorded progress is
  // real data and reopening a goal should not destroy it.
  return patchGoal(id, { status: "active", progress: current.progress === 100 ? 0 : current.progress });
}

export async function deleteGoal(id: string): Promise<{ id: string; deleted: true }> {
  const result = await getDb().prepare("DELETE FROM goals WHERE id = ?").bind(id).run();
  if (rowsChanged(result.meta) === 0) {
    throw new NotFoundError(`No goal exists with id "${id}", so nothing was deleted.`, { id });
  }
  return { id, deleted: true };
}
