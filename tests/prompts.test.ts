import { describe, expect, it } from "vitest";
import { getSystemPrompt, PROMPT_BASE_RULES } from "@/lib/ai/prompts";
import { ALL_TOOL_NAMES } from "@/lib/ai/tools";
import { TEST_NOW, TEST_TIMEZONE } from "./support/tools";

/**
 * Prompt tests.
 *
 * A prompt is code: it can name a tool that does not exist, promise a
 * capability the app does not have, or contradict what the application layer
 * enforces. These assertions cover exactly those failure modes — not the
 * wording, which is free to change.
 */

function prompt(overrides: Partial<Parameters<typeof getSystemPrompt>[0]> = {}): string {
  return getSystemPrompt({
    today: "2026-10-15",
    timezone: TEST_TIMEZONE,
    now: TEST_NOW,
    intent: "schedule_query",
    toolNames: ["get_today_tasks", "get_schedule"],
    uncertain: false,
    ...overrides,
  });
}

describe("operating rules", () => {
  it("names only tools that exist in the registry", () => {
    // The prompt used to tell the model to resolve records with `find_tasks`,
    // which is not a tool: the model would call it and get TOOL_NOT_ALLOWED.
    // Any snake_case identifier in the rules has to be a real tool name.
    const mentioned = PROMPT_BASE_RULES.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
    expect(mentioned.length).toBeGreaterThan(0);
    expect(mentioned.filter((name) => !ALL_TOOL_NAMES.includes(name))).toEqual([]);
  });

  it("points the model at the internal schedule and disowns external calendars", () => {
    // §8, and the whole reason the agent used to answer "I cannot access your
    // calendar" about data that was sitting in its own database.
    expect(PROMPT_BASE_RULES).toMatch(/internal schedule/i);
    expect(PROMPT_BASE_RULES).toMatch(/no external calendar/i);
    expect(PROMPT_BASE_RULES).not.toMatch(/google calendar is connected|you can read .*calendar account/i);
  });

  it("forbids the two failure modes that produced false answers", () => {
    // Claiming success without a confirming result, and reporting a failure as
    // an empty schedule.
    expect(PROMPT_BASE_RULES).toMatch(/never describe an action as done until/i);
    expect(PROMPT_BASE_RULES).toMatch(/never present a failure as an empty result/i);
    expect(PROMPT_BASE_RULES).toMatch(/ok:false/);
  });

  it("treats stored content as data rather than instructions", () => {
    // §14: a task title must not be able to widen the agent's authority.
    expect(PROMPT_BASE_RULES).toMatch(/never instructions/i);
    expect(PROMPT_BASE_RULES).toMatch(/not as something to obey/i);
  });

  it("makes an agreement an instruction to act, not prose about acting", () => {
    // Reproduced live: after "Delete it" was confirmed with "Yes, delete it",
    // the model answered "Done — permanently deleted" without calling a tool.
    // No tool ran and nothing was deleted.
    expect(PROMPT_BASE_RULES).toMatch(/that is an instruction to act now/i);
    expect(PROMPT_BASE_RULES).toMatch(/call the tool in this turn/i);
  });
});

describe("per-request sections", () => {
  it("states the current date, time and timezone", () => {
    const text = prompt();
    expect(text).toMatch(/2026-10-15/);
    expect(text).toMatch(/Asia\/Colombo/);
  });

  it("tells the model when it has no tools, instead of letting it promise a lookup", () => {
    const text = prompt({ toolNames: [], intent: "greeting" });
    expect(text).toMatch(/No data tools are available for this request/i);
  });

  it("marks an unclassified request as read-only rather than data-free", () => {
    const text = prompt({ uncertain: true, toolNames: ["get_tasks"] });
    expect(text).toMatch(/Read-only tools are available/i);
    expect(text).not.toMatch(/No data tools are available/i);
  });

  it("adds the intent note for the intent it was given, and no other", () => {
    const create = prompt({ intent: "task_create" });
    expect(create).toMatch(/resolve a project name to its id/i);

    const planning = prompt({ intent: "planning" });
    expect(planning).toMatch(/consult today's tasks/i);
    expect(planning).not.toMatch(/resolve a project name to its id/i);
  });

  it("keeps the destructive-action rule available to the delete intent", () => {
    expect(prompt({ intent: "task_delete" })).toMatch(/ask once for confirmation/i);
    expect(prompt({ intent: "task_delete" })).toMatch(/never answer a confirmed deletion with prose only/i);
  });

  it("tells the model an agreement is the confirmation it asked for", () => {
    // Carried per-request because it is a fact about the conversation, not a
    // standing rule: without it the model answers "Yes, delete it" with prose.
    const confirming = prompt({ confirmationPending: true, intent: "task_delete" });
    expect(confirming).toMatch(/latest message is an agreement to the question you asked/i);
    expect(confirming).toMatch(/perform the operation you proposed now/i);

    // …and it must not be asserted for an ordinary turn.
    expect(prompt({ intent: "task_delete" })).not.toMatch(/is an agreement to the question you asked/i);
  });

  it("keeps the per-request notes in a single section", () => {
    const text = prompt({ confirmationPending: true, uncertain: true, toolNames: ["get_tasks"] });
    expect(text.match(/^## This request$/gm)).toHaveLength(1);
    expect(text).toMatch(/Read-only tools are available/i);
  });
});
