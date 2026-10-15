import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setDb } from "@/lib/db/client";
import { createSqliteD1, type FakeD1 } from "./sqliteD1";
import { TEST_TODAY } from "./tools";

/**
 * Test database harness.
 *
 * Migrations are read from `migrations/` and applied in filename order, so the
 * schema under test is the schema that ships — a migration that does not run is
 * a failing test rather than a surprise in production.
 */

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export function applyMigrations(engine: FakeD1): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    engine.engine.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return files;
}

export interface TestContext {
  db: FakeD1;
  migrations: string[];
}

/** Fresh in-memory database with the real schema, installed as the shared handle. */
export function createTestDb(): TestContext {
  const db = createSqliteD1();
  const migrations = applyMigrations(db);
  setDb(db);
  return { db, migrations };
}

/** Removes the injected handle so a later test cannot inherit it. */
export function resetTestDb(): void {
  setDb(null);
}

/**
 * Seeds a task row directly, bypassing the tool layer.
 *
 * `scheduled_date` is `NOT NULL` in the shipped schema, so seeding without a
 * date would fail the constraint rather than exercise the code under test.
 */
export function seedTask(
  db: FakeD1,
  task: {
    id: string;
    title: string;
    scheduled_date?: string;
    scheduled_time?: string | null;
    description?: string | null;
    priority?: string;
    category?: string | null;
    completed?: number;
    project_id?: string | null;
  }
): void {
  db.engine
    .prepare(
      `INSERT INTO tasks (id, title, description, scheduled_date, scheduled_time, priority, category, completed, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.id,
      task.title,
      task.description ?? null,
      task.scheduled_date ?? TEST_TODAY,
      task.scheduled_time ?? null,
      task.priority ?? "medium",
      task.category ?? null,
      task.completed ?? 0,
      task.project_id ?? null,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );
}

export function seedProject(
  db: FakeD1,
  project: { id: string; name: string; description?: string | null; status?: string; color?: string | null }
): void {
  db.engine
    .prepare(
      `INSERT INTO projects (id, name, description, color, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project.id,
      project.name,
      project.description ?? null,
      project.color ?? null,
      project.status ?? "active",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );
}

/** Columns match `0002_add_goals.sql` exactly; the goals table has no category. */
export function seedGoal(
  db: FakeD1,
  goal: {
    id: string;
    title: string;
    description?: string | null;
    target_date?: string | null;
    progress?: number;
    status?: string;
  }
): void {
  db.engine
    .prepare(
      `INSERT INTO goals (id, title, description, target_date, progress, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      goal.id,
      goal.title,
      goal.description ?? null,
      goal.target_date ?? null,
      goal.progress ?? 0,
      goal.status ?? "active",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );
}

/** Reads a task row as stored, for asserting exactly which fields changed. */
export function readTaskRow(db: FakeD1, id: string): Record<string, unknown> | undefined {
  return db.engine.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

export function countTasks(db: FakeD1): number {
  const row = db.engine.prepare(`SELECT COUNT(*) AS n FROM tasks`).get() as { n: number };
  return Number(row.n);
}
