import { afterEach, describe, expect, it } from "vitest";
import { ALL_TOOL_NAMES, TOOL_REGISTRY, getToolDefinitions, getToolJsonSchema } from "@/lib/ai/tools";
import { callTool, callToolRaw, expectFail, expectOk, testContext } from "./support/tools";
import { countTasks, createTestDb, readTaskRow, resetTestDb, seedProject, seedTask } from "./support/db";

/**
 * Tool behaviour (§2, §5, §6, §7).
 *
 * Every call goes through the real dispatch path — registry allowlist, JSON
 * parsing, strict Zod validation, handler — so these assertions cover the same
 * code the agent runs, not a parallel test double.
 */

afterEach(() => {
  resetTestDb();
});

/* ------------------------------------------------------------------ */
/* Registry integrity (§2)                                             */
/* ------------------------------------------------------------------ */

describe("tool registry", () => {
  it("has one authoritative definition per tool, with no drift between halves", () => {
    for (const name of ALL_TOOL_NAMES) {
      const tool = TOOL_REGISTRY[name];
      expect(tool.name).toBe(name);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(["read", "write"]).toContain(tool.kind);
      expect(typeof tool.handler).toBe("function");
      expect(tool.schema).toBeDefined();
    }
  });

  it("exposes a JSON Schema derived from the same validator the runtime uses", () => {
    for (const name of ALL_TOOL_NAMES) {
      const schema = getToolJsonSchema(name);
      expect(schema).not.toBeNull();
      expect(schema?.type).toBe("object");
      // `$schema` is dropped: it costs tokens on every request and says nothing.
      expect(schema).not.toHaveProperty("$schema");
    }
  });

  it("covers every tool the brief requires", () => {
    const required = [
      "get_tasks",
      "get_task",
      "get_schedule",
      "get_today_tasks",
      "get_next_task",
      "create_task",
      "update_task",
      "complete_task",
      "reopen_task",
      "delete_task",
      "find_task",
      "get_task_summary",
      "get_projects",
      "get_project",
      "find_project",
      "create_project",
      "update_project",
      "delete_project",
      "get_project_tasks",
      "get_goals",
      "get_goal",
      "find_goal",
      "create_goal",
      "update_goal",
      "complete_goal",
      "get_goal_progress",
    ];
    for (const name of required) {
      expect(ALL_TOOL_NAMES, `missing tool: ${name}`).toContain(name);
    }
  });

  it("builds provider definitions for exactly the requested names", () => {
    const definitions = getToolDefinitions(["get_today_tasks", "create_task", "does_not_exist"]);
    expect(definitions.map((d) => d.function.name)).toEqual(["get_today_tasks", "create_task"]);
  });
});

/* ------------------------------------------------------------------ */
/* Argument validation (§15 case 11)                                   */
/* ------------------------------------------------------------------ */

describe("argument validation", () => {
  it("rejects a tool name outside the allowlist", async () => {
    createTestDb();
    const { result, rejected } = await callTool("drop_everything", {});
    expect(rejected).toBe(true);
    expect(expectFail(result).code).toBe("TOOL_NOT_ALLOWED");
  });

  it("rejects malformed JSON arguments without crashing", async () => {
    createTestDb();
    const { result } = await callToolRaw("get_today_tasks", "{\"includeCompleted\": tr");
    const error = expectFail(result);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toMatch(/json/i);
  });

  it("accepts an empty argument string for a no-argument tool", async () => {
    createTestDb();
    const { result } = await callToolRaw("get_today_tasks", "");
    expectOk(result);
  });

  it("rejects an unknown argument instead of silently ignoring it", async () => {
    createTestDb();
    const { result } = await callTool("get_tasks", { priority: "high", orderBy: "title" });
    const error = expectFail(result);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toMatch(/unexpected argument/i);
  });

  it("rejects an argument of the wrong type", async () => {
    createTestDb();
    const { result } = await callTool("get_tasks", { limit: "all" });
    expect(expectFail(result).code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid enum value", async () => {
    createTestDb();
    const { result } = await callTool("create_task", { title: "Ship it", when: "today", priority: "urgent" });
    expect(expectFail(result).code).toBe("VALIDATION_ERROR");
  });

  it("rejects an impossible date rather than normalising it", async () => {
    const { db } = createTestDb();
    const { result } = await callTool("create_task", { title: "Ship it", scheduledDate: "2026-02-30" });
    expect(expectFail(result).code).toBe("VALIDATION_ERROR");
    expect(countTasks(db)).toBe(0);
  });

  it("rejects a missing id on a mutation", async () => {
    createTestDb();
    const { result } = await callTool("complete_task", {});
    expect(expectFail(result).code).toBe("VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* Creation with natural-language dates (§15 case 4)                    */
/* ------------------------------------------------------------------ */

describe("create_task", () => {
  it("stores 'tomorrow at 7 PM' on the correct day in the configured timezone", async () => {
    const { db } = createTestDb();
    const { result } = await callTool("create_task", { title: "Study DSA", when: "tomorrow at 7 PM" });
    const data = expectOk<{
      task: { id: string; scheduledDate: string; scheduledTime: string; priority: string; completed: boolean };
      verified: boolean;
      dateAssumption: string;
    }>(result);

    expect(data.task.scheduledDate).toBe("2026-10-16");
    expect(data.task.scheduledTime).toBe("19:00");
    expect(data.task.completed).toBe(false);
    expect(data.task.priority).toBe("medium");
    expect(data.verified).toBe(true);
    expect(data.dateAssumption).toContain("2026-10-16");

    // Verified by reading the row back, not by trusting the tool's own claim.
    const row = readTaskRow(db, data.task.id);
    expect(row?.scheduled_date).toBe("2026-10-16");
    expect(row?.scheduled_time).toBe("19:00");
  });

  it("does not ask for a time the user never mentioned", async () => {
    createTestDb();
    const { result } = await callTool("create_task", { title: "Renew the domain", when: "next Monday" });
    const data = expectOk<{ task: { scheduledDate: string; scheduledTime: string | null } }>(result);
    expect(data.task.scheduledDate).toBe("2026-10-19");
    expect(data.task.scheduledTime).toBeNull();
  });

  it("asks which day when no date was given at all", async () => {
    const { db } = createTestDb();
    const { result } = await callTool("create_task", { title: "Write the report" });
    const error = expectFail(result);
    expect(error.code).toBe("NEEDS_CLARIFICATION");
    expect(error.message).toMatch(/which day/i);
    expect(countTasks(db)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Lookup and disambiguation (§15 cases 5, 7)                          */
/* ------------------------------------------------------------------ */

describe("find_task", () => {
  it("resolves a unique reference without asking", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t-dsa", title: "Study DSA", scheduled_date: "2026-10-15" });
    seedTask(db, { id: "t-groceries", title: "Buy groceries", scheduled_date: "2026-10-15" });

    const { result } = await callTool("find_task", { query: "DSA" });
    const data = expectOk<{ ambiguous: boolean; resolvedTask: { id: string } | null }>(result);
    expect(data.ambiguous).toBe(false);
    expect(data.resolvedTask?.id).toBe("t-dsa");
  });

  it("flags an ambiguous reference instead of choosing the first match", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15" });
    seedTask(db, { id: "t2", title: "DSA practice problems", scheduled_date: "2026-10-16" });

    const { result } = await callTool("find_task", { query: "DSA" });
    const data = expectOk<{
      ambiguous: boolean;
      candidateCount: number;
      candidates: Array<{ id: string }>;
      instruction?: string;
      resolvedTask?: unknown;
    }>(result);

    expect(data.ambiguous).toBe(true);
    expect(data.candidateCount).toBe(2);
    expect(data.candidates.map((c) => c.id).sort()).toEqual(["t1", "t2"]);
    expect(data.instruction).toMatch(/ask the user/i);
    expect(data).not.toHaveProperty("resolvedTask");
  });

  it("does not modify anything while searching", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15" });
    seedTask(db, { id: "t2", title: "DSA practice problems", scheduled_date: "2026-10-16", completed: 1 });

    await callTool("find_task", { query: "DSA" });

    expect(readTaskRow(db, "t1")?.completed).toBe(0);
    expect(readTaskRow(db, "t2")?.completed).toBe(1);
    expect(countTasks(db)).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Updates preserve unrelated fields (§15 case 5)                       */
/* ------------------------------------------------------------------ */

describe("update_task", () => {
  it("moves the right task to Friday and changes nothing else", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedTask(db, {
      id: "t-dsa",
      title: "Study DSA",
      description: "Chapter 4 — graphs",
      scheduled_date: "2026-10-15",
      scheduled_time: "19:00",
      priority: "high",
      category: "study",
      project_id: "p1",
    });
    seedTask(db, { id: "t-other", title: "Buy groceries", scheduled_date: "2026-10-15", priority: "low" });

    // Exactly the flow the agent must follow: resolve, then update by id.
    const found = await callTool("find_task", { query: "DSA" });
    const resolved = expectOk<{ resolvedTask: { id: string } }>(found.result);

    const { result } = await callTool("update_task", { id: resolved.resolvedTask.id, when: "Friday" });
    const data = expectOk<{
      task: Record<string, unknown>;
      changedFields: string[];
      verified: boolean;
      dateAssumption?: string;
    }>(result);

    expect(data.verified).toBe(true);
    expect(data.task.scheduledDate).toBe("2026-10-16");
    expect(data.changedFields).toEqual(["scheduledDate"]);
    expect(data.dateAssumption).toContain("2026-10-16");

    const row = readTaskRow(db, "t-dsa");
    expect(row?.scheduled_date).toBe("2026-10-16");
    expect(row?.scheduled_time).toBe("19:00");
    expect(row?.priority).toBe("high");
    expect(row?.category).toBe("study");
    expect(row?.project_id).toBe("p1");
    expect(row?.description).toBe("Chapter 4 — graphs");
    expect(row?.title).toBe("Study DSA");

    // The unrelated task is untouched.
    const other = readTaskRow(db, "t-other");
    expect(other?.scheduled_date).toBe("2026-10-15");
    expect(other?.priority).toBe("low");
  });

  it("refuses to update an id that does not exist", async () => {
    createTestDb();
    const { result } = await callTool("update_task", { id: "nope", priority: "high" });
    expect(expectFail(result).code).toBe("NOT_FOUND");
  });

  it("asks what to change when no field was supplied", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15" });

    const { result } = await callTool("update_task", { id: "t1" });
    expect(expectFail(result).code).toBe("NEEDS_CLARIFICATION");
    expect(readTaskRow(db, "t1")?.scheduled_date).toBe("2026-10-15");
  });

  it("changes a priority without touching the date or asking for one", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15", scheduled_time: "19:00" });

    const { result } = await callTool("update_task", { id: "t1", priority: "high" });
    // §15 case 16: no clarification, because a date was not required here.
    expectOk(result);

    const row = readTaskRow(db, "t1");
    expect(row?.priority).toBe("high");
    expect(row?.scheduled_date).toBe("2026-10-15");
    expect(row?.scheduled_time).toBe("19:00");
  });
});

/* ------------------------------------------------------------------ */
/* Completion hits exactly one task (§15 case 6)                       */
/* ------------------------------------------------------------------ */

describe("complete_task", () => {
  it("modifies only the intended task", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15" });
    seedTask(db, { id: "t2", title: "DSA practice problems", scheduled_date: "2026-10-16" });

    const { result } = await callTool("complete_task", { id: "t1" });
    const data = expectOk<{ task: { id: string; completed: boolean }; alreadyCompleted: boolean; changed: boolean }>(
      result
    );

    expect(data.changed).toBe(true);
    expect(data.alreadyCompleted).toBe(false);
    expect(data.task.completed).toBe(true);

    expect(readTaskRow(db, "t1")?.completed).toBe(1);
    expect(readTaskRow(db, "t2")?.completed).toBe(0);
  });

  it("does not claim a change when the task was already complete", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15", completed: 1 });

    const { result } = await callTool("complete_task", { id: "t1" });
    const data = expectOk<{ alreadyCompleted: boolean; changed: boolean }>(result);
    expect(data.alreadyCompleted).toBe(true);
    expect(data.changed).toBe(false);
  });

  it("reports NOT_FOUND for an id that is not stored", async () => {
    createTestDb();
    const { result } = await callTool("complete_task", { id: "ghost" });
    expect(expectFail(result).code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/* Deletion safety (§13.9)                                             */
/* ------------------------------------------------------------------ */

describe("delete_task", () => {
  it("requires an explicit confirmation and deletes nothing without it", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15" });

    const { result } = await callTool("delete_task", { id: "t1" });
    const error = expectFail(result);
    expect(error.code).toBe("CONFIRMATION_REQUIRED");
    expect(error.message).toMatch(/cannot be undone/i);
    expect(countTasks(db)).toBe(1);
  });

  it("deletes exactly one task once confirmed, and verifies it is gone", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Study DSA", scheduled_date: "2026-10-15" });
    seedTask(db, { id: "t2", title: "Buy groceries", scheduled_date: "2026-10-15" });

    const { result } = await callTool("delete_task", { id: "t1", confirm: true });
    const data = expectOk<{ deleted: boolean; verified: boolean }>(result);
    expect(data.deleted).toBe(true);
    expect(data.verified).toBe(true);

    expect(readTaskRow(db, "t1")).toBeUndefined();
    expect(readTaskRow(db, "t2")).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Project references are never guessed (§15 case 8)                   */
/* ------------------------------------------------------------------ */

describe("project resolution", () => {
  it("refuses to invent a project and reports the real options instead", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedProject(db, { id: "p2", name: "Personal" });

    const { result } = await callTool("create_task", {
      title: "Write the spec",
      when: "tomorrow",
      projectName: "TKS-Website",
    });

    const error = expectFail(result);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toMatch(/TKS-Website/);
    // Ordered the way `getProjects` orders them, so the model can offer the
    // real choices rather than guessing at one.
    expect(error.details?.availableProjects).toEqual([
      { id: "p2", name: "Personal" },
      { id: "p1", name: "TKS-App" },
    ]);
    // Nothing was created under a substitute project.
    expect(countTasks(db)).toBe(0);
  });

  it("asks which project is meant when a partial name matches several", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedProject(db, { id: "p2", name: "TKS-Website" });

    const { result } = await callTool("create_task", { title: "Write the spec", when: "tomorrow", projectName: "TKS" });
    const error = expectFail(result);
    expect(error.code).toBe("AMBIGUOUS_MATCH");
    expect(countTasks(db)).toBe(0);
  });

  it("links an unambiguous project by name", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });

    const { result } = await callTool("create_task", { title: "Write the spec", when: "tomorrow", projectName: "tks-app" });
    const data = expectOk<{ task: { id: string; projectId: string } }>(result);
    expect(data.task.projectId).toBe("p1");
  });

  it("keeps the project when an unrelated field is updated", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedTask(db, { id: "t1", title: "Write the spec", scheduled_date: "2026-10-15", project_id: "p1" });

    await callTool("update_task", { id: "t1", priority: "high" });
    expect(readTaskRow(db, "t1")?.project_id).toBe("p1");

    await callTool("update_task", { id: "t1", when: "next Monday" });
    expect(readTaskRow(db, "t1")?.project_id).toBe("p1");
  });
});

/* ------------------------------------------------------------------ */
/* Schedule reads (§15 cases 1, 9, and conflict reporting)             */
/* ------------------------------------------------------------------ */

describe("schedule reads", () => {
  it("returns today's stored tasks with every field needed to act on them", async () => {
    const { db } = createTestDb();
    seedProject(db, { id: "p1", name: "TKS-App" });
    seedTask(db, {
      id: "t1",
      title: "Study DSA",
      description: "Graphs",
      scheduled_date: "2026-10-15",
      scheduled_time: "19:00",
      priority: "high",
      project_id: "p1",
    });
    seedTask(db, { id: "t2", title: "Buy groceries", scheduled_date: "2026-10-16" });

    const { result } = await callTool("get_today_tasks", {});
    const data = expectOk<{
      date: string;
      counts: { total: number; remaining: number; completed: number };
      tasks: Array<Record<string, unknown>>;
      projects?: Array<{ id: string; name: string }>;
    }>(result);

    expect(data.date).toBe("2026-10-15");
    expect(data.counts).toEqual({ total: 1, remaining: 1, completed: 0, overdue: 0 });
    expect(data.tasks).toHaveLength(1);

    const task = data.tasks[0];
    expect(task).toMatchObject({
      id: "t1",
      title: "Study DSA",
      description: "Graphs",
      scheduledDate: "2026-10-15",
      scheduledTime: "19:00",
      priority: "high",
      completed: false,
      projectId: "p1",
      projectName: "TKS-App",
    });
    expect(data.projects).toEqual([expect.objectContaining({ id: "p1", name: "TKS-App" })]);
  });

  it("reports a genuinely empty day as empty, not as an error", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Buy groceries", scheduled_date: "2026-11-01" });

    const { result } = await callTool("get_today_tasks", {});
    const data = expectOk<{ counts: { total: number }; tasks: unknown[] }>(result);
    expect(data.counts.total).toBe(0);
    expect(data.tasks).toEqual([]);
  });

  it("reports an exact time-slot clash without inventing durations", async () => {
    const { db } = createTestDb();
    seedTask(db, { id: "t1", title: "Standup", scheduled_date: "2026-10-16", scheduled_time: "19:00" });

    const clash = await callTool("create_task", { title: "Study DSA", when: "tomorrow at 7 PM" });
    const clashData = expectOk<{ warnings?: Array<{ type: string; tasks: Array<{ id: string }> }> }>(clash.result);
    expect(clashData.warnings?.[0].type).toBe("time_conflict");
    expect(clashData.warnings?.[0].tasks.map((t) => t.id)).toEqual(["t1"]);

    // An adjacent hour is not a conflict: durations are not stored, so the
    // window is never widened to guess at one.
    const adjacent = await callTool("create_task", { title: "Read a chapter", when: "tomorrow at 8 PM" });
    const adjacentData = expectOk<{ warnings?: unknown[] }>(adjacent.result);
    expect(adjacentData.warnings).toBeUndefined();
  });

  it("keeps task reads bounded and ordered", async () => {
    const { db } = createTestDb();
    for (let i = 0; i < 12; i += 1) {
      seedTask(db, { id: `t${i}`, title: `Task ${i}`, scheduled_date: `2026-10-${String(i + 1).padStart(2, "0")}` });
    }

    const { result } = await callTool("get_tasks", { limit: 5 });
    const data = expectOk<{ tasks: Array<{ scheduledDate: string }> }>(result);
    expect(data.tasks).toHaveLength(5);
    const dates = data.tasks.map((t) => t.scheduledDate);
    expect(dates).toEqual([...dates].sort());
  });
});

/* ------------------------------------------------------------------ */
/* Tool context                                                        */
/* ------------------------------------------------------------------ */

describe("execution context", () => {
  it("resolves relative phrases against the injected clock, not the host clock", async () => {
    createTestDb();
    const ctx = testContext({ today: "2027-03-01", now: new Date("2027-03-01T04:00:00.000Z") });

    const { result } = await callTool("create_task", { title: "Quarterly review", when: "tomorrow" }, ctx);
    const data = expectOk<{ task: { scheduledDate: string } }>(result);
    expect(data.task.scheduledDate).toBe("2027-03-02");
  });
});
