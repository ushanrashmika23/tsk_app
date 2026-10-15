import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DbError } from "@/lib/errors";
import { checkScheduleHealth, getDb, readD1Config, setDb } from "@/lib/db/client";
import { getTaskSummary, getTasksForDate, patchTask, deleteTask, createTask, queryTasks } from "@/lib/db/tasks";
import { getProjects, deleteProject } from "@/lib/db/projects";
import { createTestDb, resetTestDb, seedProject, seedTask, countTasks, readTaskRow } from "./support/db";
import { createSqliteD1 } from "./support/sqliteD1";
import { callTool, expectFail, expectOk, testContext, testEnv } from "./support/tools";

/**
 * Database error semantics (§9).
 *
 * The defect these replace: a missing credential returned
 * `{ results: [], success: true }`, so a broken database produced a confident
 * "you have nothing scheduled today". Every case here asserts that a failure
 * stays a failure and only a genuine zero-row query reads as empty.
 */

afterEach(() => {
  resetTestDb();
});

describe("configuration", () => {
  it("reports exactly which Cloudflare variables are missing", () => {
    expect(() => readD1Config(testEnv())).toThrowError(/CLOUDFLARE_ACCOUNT_ID[\s\S]*CLOUDFLARE_DATABASE_ID[\s\S]*CLOUDFLARE_API_TOKEN/);
  });

  it("fails the request instead of pretending the schedule is empty", async () => {
    setDb(null);
    const env = { ...process.env };
    const saved = {
      account: env.CLOUDFLARE_ACCOUNT_ID,
      database: env.CLOUDFLARE_DATABASE_ID,
      token: env.CLOUDFLARE_API_TOKEN,
    };
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_DATABASE_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;

    try {
      expect(() => getDb()).toThrowError();
      const error = (() => {
        try {
          getDb();
        } catch (thrown) {
          return thrown as DbError;
        }
        return null;
      })();
      expect(error?.code).toBe("DB_CONFIG_MISSING");
    } finally {
      if (saved.account !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = saved.account;
      if (saved.database !== undefined) process.env.CLOUDFLARE_DATABASE_ID = saved.database;
      if (saved.token !== undefined) process.env.CLOUDFLARE_API_TOKEN = saved.token;
    }
  });
});

describe("a failed query is never an empty result", () => {
  it("throws when the database is unreachable", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Write the report", scheduled_date: "2026-10-15" });
    db.failWith(new DbError("DB_UPSTREAM_ERROR", "D1 request failed with HTTP 500.", { expose: true }));

    await expect(getTasksForDate("2026-10-15")).rejects.toThrowError(DbError);
  });

  it("returns an empty array only when the query genuinely matched nothing", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Write the report", scheduled_date: "2026-10-15" });

    const rows = await getTasksForDate("2026-10-16");
    expect(rows).toEqual([]);
  });

  it("distinguishes a missing table from an empty one", async () => {
    // No migrations applied: the tables genuinely do not exist.
    setDb(createSqliteD1());

    const health = await checkScheduleHealth("2026-10-15");
    expect(health.reachable).toBe(false);
    expect(health.state).toBe("schema_missing");
    expect(health.message).toMatch(/table/i);
  });

  it("surfaces a database failure to the model as a failed operation", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Write the report", scheduled_date: "2026-10-15" });
    db.failWith(new DbError("DB_TIMEOUT", "The task database did not respond in time.", { expose: true }));

    const { result } = await callTool("get_today_tasks", {});
    const error = expectFail(result);
    expect(error.code).toBe("DB_TIMEOUT");
    // The critical property: no data field that could be read as "nothing today".
    expect(result).not.toHaveProperty("data");
  });

  it("does not report a mutation as successful when the write failed", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Write the report", scheduled_date: "2026-10-15" });
    db.failWith(new DbError("DB_UPSTREAM_ERROR", "D1 request failed with HTTP 500."));

    const { result } = await callTool("complete_task", { id: "t1" });
    expect(expectFail(result).code).toMatch(/^DB_/);
  });
});

describe("schedule health check", () => {
  it("distinguishes a valid empty schedule from an unreachable database", async () => {
    const { db } = createTestDb();

    const empty = await checkScheduleHealth("2026-10-15");
    expect(empty.state).toBe("empty");
    expect(empty.reachable).toBe(true);
    expect(empty.taskCount).toBe(0);

    seedTask(db, { id: "t1", title: "Write the report", scheduled_date: "2026-10-15" });
    const populated = await checkScheduleHealth("2026-10-15");
    expect(populated.state).toBe("ok");
    expect(populated.todayCount).toBe(1);

    db.failWith(new DbError("DB_AUTH_FAILED", "The task database rejected the server's credentials."));
    const broken = await checkScheduleHealth("2026-10-15");
    expect(broken.reachable).toBe(false);
    expect(broken.state).toBe("auth_failed");
    expect(broken.code).toBe("DB_AUTH_FAILED");
  });
});

describe("query layer", () => {
  it("binds user input as parameters instead of interpolating it", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Write the report", scheduled_date: "2026-10-15" });

    await queryTasks({ titleContains: "'; DROP TABLE tasks; --" });

    const statement = db.executed[db.executed.length - 1];
    expect(statement).not.toContain("DROP TABLE");
    expect(statement).toContain("?");
    // The table is still there and still holds its row.
    expect(countTasks(db)).toBe(1);
  });

  it("computes summary counts in the database and reports them accurately", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "A", scheduled_date: "2026-10-15" });
    seedTask(db, { id: "t2", title: "B", scheduled_date: "2026-10-15", completed: 1 });
    seedTask(db, { id: "t3", title: "C", scheduled_date: "2026-10-16", priority: "high" });
    seedTask(db, { id: "t4", title: "D", scheduled_date: "2026-10-10" });

    const summary = await getTaskSummary("2026-10-15", "2026-10-16", "2026-10-15");
    expect(summary.total).toBe(3);
    expect(summary.completed).toBe(1);
    expect(summary.remaining).toBe(2);
    expect(summary.overdue).toBe(1);
  });

  it("preserves fields a patch does not mention and clears the ones it nulls", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedTask(db, {
      id: "t1",
      title: "Study DSA",
      description: "Chapter 4",
      scheduled_date: "2026-10-15",
      scheduled_time: "19:00",
      priority: "high",
      category: "study",
      project_id: "p1",
    });

    await patchTask("t1", { scheduled_date: "2026-10-16" });

    const row = readTaskRow(db, "t1");
    expect(row?.scheduled_date).toBe("2026-10-16");
    expect(row?.scheduled_time).toBe("19:00");
    expect(row?.priority).toBe("high");
    expect(row?.category).toBe("study");
    expect(row?.project_id).toBe("p1");
    expect(row?.description).toBe("Chapter 4");
  });

  it("reports a missing row as not found rather than succeeding silently", async () => {
    const { db } = createTestDb();
    await expect(deleteTask("does-not-exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(countTasks(db)).toBe(0);
  });

  it("detaches tasks rather than deleting them when a project is removed", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedTask(db, { id: "t1", title: "Ship it", project_id: "p1" });

    const result = await deleteProject("p1");
    expect(result.deleted).toBe(true);
    expect(countTasks(db)).toBe(1);
    expect(readTaskRow(db, "t1")?.project_id).toBeNull();
  });

  it("rejects an invalid date before it reaches SQL", async () => {
    createTestDb();
    await expect(createTask({ title: "Bad date", scheduled_date: "2026-13-45" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("lists projects ordered and bounded", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "Zeta" });
    seedProject(db, { id: "p2", name: "Alpha" });

    const projects = await getProjects();
    expect(projects.map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("migrations", () => {
  it("applies every migration in order to an empty database", () => {
    const { migrations } = createTestDb();
    expect(migrations).toEqual([
      "0001_initial.sql",
      "0002_add_goals.sql",
      "0003_add_projects.sql",
      "0004_add_ai_indexes.sql",
    ]);
  });

  it("re-applies the newest migration to a populated database unchanged", async () => {
    // §16: a migration must be safe on existing data. 0004 only creates
    // indexes, so running it twice must neither fail nor change a row.
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Existing task", scheduled_date: "2026-10-15" });
    const before = readTaskRow(db, "t1");

    const sql = readFileSync(join(process.cwd(), "migrations", "0004_add_ai_indexes.sql"), "utf8");
    db.engine.exec(sql);
    db.engine.exec(sql);

    expect(readTaskRow(db, "t1")).toEqual(before);
    expect(countTasks(db)).toBe(1);
    const indexes = db.engine
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toContain("idx_tasks_date_completed");
  });

  it("serves the AI's own date+completion read from the new index", () => {
    // Not a timing test: it asserts the query planner can use the index at all,
    // which is what makes the today/next-task reads scale.
    const { db } = createTestDb();
    const plan = db.engine
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE scheduled_date = ? AND completed = 0 ORDER BY scheduled_time`
      )
      .all("2026-10-15") as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join(" ")).toMatch(/idx_tasks_date_completed/);
  });
});

describe("tool context", () => {
  it("uses the injected clock rather than the host clock", () => {
    const ctx = testContext();
    expect(ctx.today).toBe("2026-10-15");
    expect(ctx.now.toISOString()).toBe("2026-10-15T04:00:00.000Z");
  });

  it("creates a task exactly where the tool reports it", async () => {
    createTestDb();
    const { result } = await callTool("create_task", {
      title: "Study DSA",
      when: "tomorrow at 7 PM",
    });
    const data = expectOk<{ task: { id: string; scheduledDate: string; scheduledTime: string } }>(result);
    expect(data.task.scheduledDate).toBe("2026-10-16");
    expect(data.task.scheduledTime).toBe("19:00");

    const stored = await getTasksForDate("2026-10-16");
    expect(stored.map((task) => task.id)).toContain(data.task.id);
  });
});
