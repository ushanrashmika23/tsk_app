import { getDb } from "./client";
import { Project, ProjectInput, ProjectStatus } from "@/types/project";
import { NotFoundError, ToolValidationError } from "@/lib/errors";

export const MAX_PROJECT_ROWS = 200;

const PROJECT_COLUMNS = "id, name, description, color, status, created_at, updated_at";

export function normalizeProjectRow(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    status: ((row.status as string) || "active") as ProjectStatus,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function rowsChanged(meta: { changes?: number }): number {
  return Number(meta?.changes ?? 0);
}

export async function getProjects(status?: ProjectStatus): Promise<Project[]> {
  const db = getDb();
  const statement =
    status === undefined
      ? db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY status ASC, name ASC LIMIT ?`).bind(MAX_PROJECT_ROWS)
      : db
          .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE status = ? ORDER BY name ASC LIMIT ?`)
          .bind(status, MAX_PROJECT_ROWS);

  const result = await statement.all<Record<string, unknown>>();
  return (result.results ?? []).map(normalizeProjectRow);
}

/** Returns `null` instead of throwing, for callers that probe by id. */
export async function findProjectById(id: string): Promise<Project | null> {
  if (!id || typeof id !== "string") return null;
  const row = await getDb()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? normalizeProjectRow(row) : null;
}

export async function getProject(id: string): Promise<Project> {
  const project = await findProjectById(id);
  if (!project) {
    throw new NotFoundError(`No project exists with id "${id}".`, { id });
  }
  return project;
}

/**
 * Case-insensitive project lookup by name. Returns every candidate so the
 * caller can refuse to guess when the name is ambiguous or absent — a similar
 * name must never be silently substituted.
 */
export async function findProjectsByName(name: string): Promise<Project[]> {
  const trimmed = name?.trim();
  if (!trimmed) return [];

  const exact = await getDb()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE LOWER(name) = ? LIMIT 10`)
    .bind(trimmed.toLowerCase())
    .all<Record<string, unknown>>();

  if ((exact.results ?? []).length > 0) {
    return (exact.results ?? []).map(normalizeProjectRow);
  }

  const partial = await getDb()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE LOWER(name) LIKE ? ORDER BY name ASC LIMIT 10`)
    .bind(`%${trimmed.toLowerCase()}%`)
    .all<Record<string, unknown>>();

  return (partial.results ?? []).map(normalizeProjectRow);
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const name = input.name?.trim();
  if (!name) {
    throw new ToolValidationError("A project needs a non-empty name.", { field: "name" });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO projects (id, name, description, color, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, name, input.description?.trim() || null, input.color?.trim() || null, input.status || "active", now, now)
    .run();

  return getProject(id);
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  color?: string | null;
  status?: ProjectStatus;
}

/** Omitted keys are preserved; an explicit `null` clears the column. */
export async function patchProject(id: string, patch: ProjectPatch): Promise<Project> {
  const current = await getProject(id);

  const next = {
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    color: patch.color !== undefined ? patch.color : current.color,
    status: patch.status !== undefined ? patch.status : current.status,
  };

  if (!next.name) {
    throw new ToolValidationError("A project name cannot be empty.", { field: "name" });
  }

  const result = await getDb()
    .prepare("UPDATE projects SET name = ?, description = ?, color = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind(next.name, next.description, next.color, next.status, new Date().toISOString(), id)
    .run();

  if (rowsChanged(result.meta) === 0) {
    throw new NotFoundError(`No project exists with id "${id}", so nothing was updated.`, { id });
  }

  return getProject(id);
}

/** Backwards-compatible wrapper used by the existing server actions. */
export async function updateProject(id: string, updates: Partial<ProjectInput>): Promise<Project> {
  return patchProject(id, {
    name: updates.name,
    description: updates.description !== undefined ? updates.description : undefined,
    color: updates.color !== undefined ? updates.color : undefined,
    status: updates.status,
  });
}

export interface DeleteProjectResult {
  id: string;
  deleted: true;
  /** Number of tasks that were detached from the project. */
  detachedTasks: number;
}

/**
 * Deletes a project. Tasks are never deleted — their `project_id` is nulled so
 * the user keeps the work items.
 */
export async function deleteProject(id: string): Promise<DeleteProjectResult> {
  const db = getDb();
  await getProject(id);

  const detach = await db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ?").bind(id).run();
  const removal = await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();

  if (rowsChanged(removal.meta) === 0) {
    throw new NotFoundError(`No project exists with id "${id}", so nothing was deleted.`, { id });
  }

  return { id, deleted: true, detachedTasks: rowsChanged(detach.meta) };
}
