import { describe, expect, it } from "vitest";
import { ALL_TOOL_NAMES } from "@/lib/ai/tools";
import { routeRequest, type RoutingDecision } from "@/lib/ai/router";
import type { AIMessage } from "@/lib/ai/types";

/**
 * Intent routing and tool availability (§4, §8).
 *
 * The defect being guarded against: a schedule question arriving with an empty
 * tool list, which left the model no way to read the data and no choice but to
 * say it could not see the calendar.
 */

function user(text: string): AIMessage {
  return { role: "user", content: text };
}

function route(text: string): RoutingDecision {
  return routeRequest([user(text)]);
}

function expectToolsFor(text: string, expected: string[]): RoutingDecision {
  const decision = route(text);
  for (const name of expected) {
    expect(decision.toolNames, `"${text}" (${decision.intent}) is missing ${name}`).toContain(name);
  }
  return decision;
}

describe("schedule questions always reach the internal schedule", () => {
  // §15 case 1 and case 14.
  const scheduleQuestions = [
    "What do I have today?",
    "What's on my schedule?",
    "Show me my calendar",
    "What's coming up this week?",
    "Do I have anything tomorrow?",
    "What's on my agenda for tonight?",
    "Am I free this weekend?",
  ];

  for (const question of scheduleQuestions) {
    it(`grants schedule-reading tools for: ${question}`, () => {
      const decision = expectToolsFor(question, ["get_today_tasks", "get_schedule", "get_tasks"]);
      expect(decision.toolNames.length).toBeGreaterThan(0);
      expect(decision.groups).toContain("schedule_read");
    });
  }

  it("never asks the model to classify, so the decision is deterministic and free", () => {
    const first = route("What do I have today?");
    const second = route("What do I have today?");
    expect(second).toEqual(first);
  });

  it("grants internal schedule tools even for the word 'calendar', which has no integration behind it", () => {
    const decision = route("check my calendar for tomorrow");
    expect(decision.toolNames).toContain("get_today_tasks");
    expect(decision.toolNames).toContain("get_tasks");
  });
});

describe("writes always come with the reads needed to resolve the record", () => {
  it("adds creation plus lookup tools for a new task", () => {
    // §15 case 4.
    expectToolsFor("Add a task to study DSA tomorrow at 7 PM", [
      "create_task",
      "get_tasks",
      "find_task",
      "get_today_tasks",
      "get_projects",
    ]);
  });

  it("adds lookup tools for a move request", () => {
    // §15 case 5.
    expectToolsFor("Move my DSA task to Friday", ["update_task", "find_task", "get_tasks"]);
  });

  it("adds lookup tools for a completion request", () => {
    // §15 case 6.
    expectToolsFor("Mark my DSA task as complete", ["complete_task", "find_task", "get_tasks"]);
  });

  it("adds lookup tools before a delete", () => {
    expectToolsFor("Delete the DSA task", ["delete_task", "find_task", "get_tasks"]);
  });

  it("routes a project delete to project tools, not task tools", () => {
    const decision = expectToolsFor("Delete the TKS-App project", ["delete_project", "find_project", "get_projects"]);
    expect(decision.intent).toBe("project_delete");
  });

  it("routes a goal delete to goal tools", () => {
    const decision = expectToolsFor("Remove my fitness goal", ["delete_goal", "get_goals", "find_goal"]);
    expect(decision.intent).toBe("goal_delete");
  });
});

describe("combined and multi-step requests", () => {
  it("grants every tool a two-part request needs", () => {
    // §15 case 13: the model must be able to run both halves.
    expectToolsFor("Add a task to study DSA tomorrow at 7 PM and then tell me what my day looks like", [
      "create_task",
      "get_today_tasks",
      "get_tasks",
    ]);
  });

  it("routes a summary to the tools that can produce real counts", () => {
    // §15 case 2.
    const decision = expectToolsFor("Give me a summary of my day", [
      "get_task_summary",
      "get_today_tasks",
      "get_tasks",
    ]);
    expect(decision.intent).toBe("summary");
  });

  it("routes a prioritisation question to stored task and goal data", () => {
    // §15 case 3.
    const decision = expectToolsFor("What should I focus on?", ["get_today_tasks", "get_next_task", "get_goals"]);
    expect(decision.intent).toBe("planning");
    expect(decision.groups).toContain("goals_read");
  });

  it("routes project-aware planning to project and task reads", () => {
    expectToolsFor("How should I plan my work on the TKS-App project?", ["get_projects", "get_project_tasks"]);
  });
});

describe("tool access is never emptied for a data-dependent request", () => {
  const dataDependent = [
    "what do I have today",
    "summarise my week",
    "what should I focus on",
    "add a task for tomorrow",
    "move it to Friday",
    "complete my DSA task",
    "how is my fitness goal going",
    "delete that task",
    "which project is behind",
    "what did I finish yesterday",
    "am I behind on anything",
    "tell me about my tasks",
    "xyzzy plugh",
  ];

  for (const message of dataDependent) {
    it(`grants at least one tool for: ${message}`, () => {
      const decision = route(message);
      expect(decision.toolNames.length).toBeGreaterThan(0);
      // A routing mistake must never remove the ability to read the data.
      expect(decision.toolNames.some((name) => name.startsWith("get_") || name.startsWith("find_"))).toBe(true);
    });
  }

  it("defaults to read-only tools when nothing is certain", () => {
    const decision = route("xyzzy plugh");
    expect(decision.intent).toBe("unknown");
    expect(decision.uncertain).toBe(true);
    expect(decision.groups).toEqual(["tasks_read", "schedule_read", "projects_read", "goals_read"]);
    expect(decision.toolNames).not.toContain("delete_task");
  });
});

describe("conversational messages", () => {
  it("keeps data tools out of a plain greeting", () => {
    const decision = route("hi");
    expect(decision.intent).toBe("greeting");
    expect(decision.groups).toEqual([]);
    expect(decision.toolNames).toEqual([]);
    expect(decision.modelRole).toBe("simple");
  });

  it("still grants tools when a greeting mentions stored data", () => {
    const decision = route("hello, what do I have today?");
    expect(decision.toolNames.length).toBeGreaterThan(0);
  });

  it("does not drop tools mid-conversation once tools have been used", () => {
    // §13.10: "move it to Friday" is only meaningful with the earlier turn.
    const messages: AIMessage[] = [
      user("what's on my schedule"),
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "get_today_tasks", arguments: "{}" } }],
      },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "call_1", name: "get_today_tasks" },
      { role: "assistant", content: "You have a DSA task at 19:00." },
      user("move it to Friday"),
    ];

    const decision = routeRequest(messages);
    expect(decision.reason).toBe("conversation already used tools");
    expect(decision.toolNames).toContain("update_task");
    expect(decision.toolNames).toContain("find_task");
  });
});

describe("routing output", () => {
  const samples = [
    "hi",
    "what do I have today?",
    "add a task tomorrow",
    "move my DSA task to Friday",
    "complete the report",
    "delete the old task",
    "summarise my week",
    "what should I focus on?",
    "how are my goals doing",
    "create a project called Atlas",
    "why can't you see my calendar",
    "xyzzy",
  ];

  it("never returns a duplicate tool name", () => {
    for (const sample of samples) {
      const names = route(sample).toolNames;
      expect(new Set(names).size, `duplicates in "${sample}"`).toBe(names.length);
    }
  });

  it("only ever names tools that exist in the registry", () => {
    for (const sample of samples) {
      for (const name of route(sample).toolNames) {
        expect(ALL_TOOL_NAMES, `"${sample}" routed to unknown tool ${name}`).toContain(name);
      }
    }
  });

  it("explains itself for the log line", () => {
    for (const sample of samples) {
      expect(route(sample).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("diagnostics", () => {
  it("grants the status tool plus data reads when the user reports a problem", () => {
    const decision = route("why can't you see my calendar?");
    expect(decision.intent).toBe("diagnostics");
    expect(decision.toolNames).toContain("get_system_status");
    expect(decision.toolNames).toContain("get_today_tasks");
  });
});

describe("a bare agreement is routed as the request it agrees with", () => {
  function conversation(previous: string, question: string, reply: string): RoutingDecision {
    return routeRequest([
      user(previous),
      { role: "assistant", content: question },
      user(reply),
    ]);
  }

  it("grants the write tools the hinted operation needs", () => {
    // "yes" carries no verbs of its own. Classified alone it fell through to
    // read-only tools, so the move the user had just confirmed could not run.
    const decision = conversation(
      "Move my DSA task to Friday",
      'Move "Study DSA" to Friday, Oct 16?',
      "yes"
    );
    expect(decision.intent).toBe("task_modify");
    expect(decision.toolNames).toContain("update_task");
    expect(decision.toolNames).toContain("find_task");
  });

  it("still resolves a deletion confirmation", () => {
    const decision = conversation("Delete my DSA task", 'Delete "Study DSA"?', "Yes, delete it");
    expect(decision.intent).toBe("task_delete");
    expect(decision.toolNames).toContain("delete_task");
  });

  it("classifies from the current message when the previous turn asked nothing", () => {
    // "ok" after a statement is an acknowledgement, not consent to anything —
    // and nothing in it needs stored data.
    const decision = conversation("What do I have today?", "Nothing scheduled.", "ok");
    expect(decision.intent).toBe("greeting");
    expect(decision.toolNames).toEqual([]);
  });

  it("routes an agreement to a read request to the reads it needs", () => {
    const decision = conversation("Show me next week", "Shall I list next week's tasks?", "yes");
    expect(decision.intent).toBe("schedule_query");
    expect(decision.toolNames).toContain("get_schedule");
  });

  it("falls back to the message itself when there is no previous user turn", () => {
    const decision = route("yes");
    expect(decision.intent).toBe("unknown");
    expect(decision.uncertain).toBe(true);
    // Never empty: an unclassifiable message still gets reads.
    expect(decision.toolNames.length).toBeGreaterThan(0);
  });
});
