import type { ModelRole } from "./config";
import { isConfirmationReply } from "./messages";
import { ALL_TOOL_NAMES } from "./tools";
import type { AIMessage } from "./types";

/**
 * Intent routing.
 *
 * The router decides which *tool groups* a request may use. It is deliberately
 * deterministic: a classifier call would cost tokens on every message, and the
 * failure mode of keyword routing (a data question arriving with an empty tool
 * list, so the model invents an answer) is far worse than exposing a few extra
 * read tools.
 *
 * Two rules keep that failure mode impossible:
 *
 *  1. A write intent always also grants the read tools needed to resolve the
 *     record before mutating it.
 *  2. When classification is uncertain, the router grants read-only tools
 *     rather than none.
 */

export type AIIntent =
  | "greeting"
  | "task_query"
  | "task_create"
  | "task_modify"
  | "task_complete"
  | "task_delete"
  | "schedule_query"
  | "summary"
  | "planning"
  | "project_management"
  | "goal_management"
  | "project_delete"
  | "goal_delete"
  | "diagnostics"
  | "unknown";

export type ToolGroup =
  | "tasks_read"
  | "schedule_read"
  | "tasks_write"
  | "task_delete"
  | "projects_read"
  | "projects_write"
  | "project_delete"
  | "goals_read"
  | "goals_write"
  | "goal_delete"
  | "diagnostics";

/**
 * Group → tool names. Every group is read/write coherent so granting a write
 * intent never implies data access the model should not have.
 */
const GROUP_TOOLS: Record<ToolGroup, string[]> = {
  tasks_read: ["get_tasks", "get_task", "find_task", "get_today_tasks", "get_next_task", "get_task_summary"],
  schedule_read: ["get_schedule", "get_today_tasks", "get_next_task", "get_tasks"],
  tasks_write: ["create_task", "update_task", "complete_task", "reopen_task"],
  task_delete: ["delete_task"],
  projects_read: ["get_projects", "get_project", "find_project", "get_project_tasks"],
  projects_write: ["create_project", "update_project"],
  project_delete: ["delete_project"],
  goals_read: ["get_goals", "get_goal", "find_goal", "get_goal_progress"],
  goals_write: ["create_goal", "update_goal", "complete_goal", "reopen_goal"],
  goal_delete: ["delete_goal"],
  diagnostics: ["get_system_status"],
};

export interface RoutingDecision {
  intent: AIIntent;
  groups: ToolGroup[];
  modelRole: ModelRole;
  toolNames: string[];
  /** Short, loggable explanation of why this intent was chosen. */
  reason: string;
  /** True when no strong signal was found and read-only tools were granted. */
  uncertain: boolean;
}

/* ------------------------------------------------------------------ */
/* Lexicons                                                            */
/* ------------------------------------------------------------------ */

const RE_DELETE = /\b(delete|remove|discard|drop|erase|trash|get rid of)\b/i;
const RE_COMPLETE = /\b(complete|completed|finish|finished|done|tick off|mark(?:ed)? (?:it )?(?:as )?(?:done|complete)|check off)\b/i;
const RE_CREATE = /\b(add|create|new|schedule|remind|book|set up|setup|log|jot down|put (?:it|this) (?:in|on))\b/i;
const RE_MODIFY = /\b(move|reschedule|reschedule|change|update|edit|rename|postpone|push|shift|bump|reprioriti[sz]e|set|adjust|make it)\b/i;
const RE_GOAL = /\b(goal|goals|objective|objectives|milestone|milestones|target|targets)\b/i;
const RE_PROJECT = /\b(project|projects|assignment|assignments)\b/i;
const RE_SCHEDULE = /\b(schedule|calendar|agenda|upcoming|next task|what'?s next|today|tomorrow|tonight|this week|next week|weekend|this month|morning|afternoon|evening|due)\b/i;
const RE_SUMMARY = /\b(summar(?:y|ise|ize)|overview|briefing|brief me|report|recap|how(?:'s| is| are) (?:my|the) (?:day|week|going)|status)\b/i;
const RE_PLANNING = /\b(focus|prioriti[sz]e|plan|planning|should i (?:do|work on|start)|what should|recommend|suggest|first)\b/i;
const RE_TASK_NOUN = /\b(task|tasks|to-?do|todos|item|items|thing|things|reminder|reminders)\b/i;
const RE_DIAGNOSTIC = /\b(why (?:can'?t|can not|don'?t) you|not working|error|broken|diagnos|debug|is the (?:database|db|calendar) (?:up|working|connected))\b/i;

/**
 * Question shapes that are only ever asked about the user's own workload.
 *
 * "What should I focus on?" carries no data noun, so the planning guard below
 * used to reject it and it fell through to a task-only route with no goal
 * tools. Phrased this way it is never a question about anything except stored
 * work, so the phrase alone justifies granting the read tools.
 */
const RE_PLANNING_SELF_EVIDENT =
  /\bwhat should i (?:focus|do|work|start|prioriti[sz]e|tackle|pick)|what'?s (?:next|most important)|where should i start\b/i;

/** Messages that are unambiguously conversational and need no stored data. */
const RE_SMALL_TALK =
  /^(hi|hey|hello|yo|sup|good (?:morning|afternoon|evening)|thanks|thank you|ty|cheers|ok|okay|cool|nice|great|bye|goodbye|see ya|who are you|what can you do|help|what do you do)\b[\s!.?]*$/i;

/** Words that, if present, mean the message is about stored data. */
const RE_ANY_DATA_NOUN =
  /\b(task|tasks|to-?do|todos|item|items|thing|things|reminder|reminders|goal|goals|objective|objectives|milestone|milestones|target|targets|project|projects|assignment|assignments|schedule|calendar|agenda|day|week|month|today|tomorrow|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|due|overdue|next|upcoming)\b/i;

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

interface Signal {
  intent: AIIntent;
  groups: ToolGroup[];
  modelRole: ModelRole;
  reason: string;
  uncertain?: boolean;
}

function classify(text: string, hasHistory: boolean): Signal {
  const trimmed = text.trim();

  // 0. Diagnostics are explicit and rare.
  if (RE_DIAGNOSTIC.test(trimmed)) {
    return {
      intent: "diagnostics",
      groups: ["diagnostics", "tasks_read", "schedule_read"],
      modelRole: "tool",
      reason: "matched a diagnostic phrase",
    };
  }

  const wantsDelete = RE_DELETE.test(trimmed);
  const wantsComplete = RE_COMPLETE.test(trimmed);
  const wantsCreate = RE_CREATE.test(trimmed);
  const wantsModify = RE_MODIFY.test(trimmed);
  const mentionsGoal = RE_GOAL.test(trimmed);
  const mentionsProject = RE_PROJECT.test(trimmed);
  const mentionsSchedule = RE_SCHEDULE.test(trimmed);
  const mentionsTask = RE_TASK_NOUN.test(trimmed);

  // 1. Destructive operations. Never grant a delete tool without the reads
  //    required to identify the exact record first.
  if (wantsDelete) {
    if (mentionsGoal) {
      return {
        intent: "goal_delete",
        groups: ["goals_read", "goal_delete"],
        modelRole: "tool",
        reason: "delete verb + goal noun",
      };
    }
    if (mentionsProject) {
      return {
        intent: "project_delete",
        groups: ["projects_read", "project_delete"],
        modelRole: "tool",
        reason: "delete verb + project noun",
      };
    }
    return {
      intent: "task_delete",
      groups: ["tasks_read", "task_delete"],
      modelRole: "tool",
      reason: "delete verb",
    };
  }

  // 2. Completion. "What have I completed today?" is a query, so a completion
  //    verb only means a mutation when the message also reads like a request.
  if (wantsComplete && !isCompletionQuery(trimmed)) {
    if (mentionsGoal) {
      return {
        intent: "goal_management",
        groups: ["goals_read", "goals_write"],
        modelRole: "tool",
        reason: "completion verb + goal noun",
      };
    }
    return {
      intent: "task_complete",
      groups: ["tasks_read", "tasks_write"],
      modelRole: "tool",
      reason: "completion verb",
    };
  }

  // 3. Goal management (reads always included so the goal can be resolved).
  if (mentionsGoal && (wantsCreate || wantsModify || wantsComplete)) {
    return {
      intent: "goal_management",
      groups: ["goals_read", "goals_write"],
      modelRole: "tool",
      reason: "goal noun with a write verb",
    };
  }
  if (mentionsGoal && !mentionsTask && !mentionsSchedule) {
    return {
      intent: "goal_management",
      groups: ["goals_read"],
      modelRole: "tool",
      reason: "goal noun without a write verb",
    };
  }

  // 4. Project management.
  if (mentionsProject && (wantsCreate || wantsModify)) {
    return {
      intent: "project_management",
      groups: ["projects_read", "projects_write", "tasks_read"],
      modelRole: "tool",
      reason: "project noun with a write verb",
    };
  }
  if (mentionsProject && !wantsCreate && !wantsModify && !mentionsTask) {
    return {
      intent: "project_management",
      groups: ["projects_read"],
      modelRole: "tool",
      reason: "project noun",
    };
  }

  // 5. Task creation. Grabs project + task reads so the model can resolve a
  //    project name, check for duplicates and detect conflicts.
  if (wantsCreate) {
    return {
      intent: "task_create",
      groups: ["tasks_read", "tasks_write", "schedule_read", "projects_read"],
      modelRole: "tool",
      reason: "creation verb",
    };
  }

  // 6. Task modification: lookup tools are always present.
  if (wantsModify) {
    return {
      intent: "task_modify",
      groups: ["tasks_read", "tasks_write", "schedule_read", "projects_read"],
      modelRole: "tool",
      reason: "modification verb",
    };
  }

  // 7. Combined planning / prioritisation requests.
  if (
    RE_PLANNING.test(trimmed) &&
    (mentionsTask || mentionsGoal || mentionsSchedule || mentionsProject || hasHistory || RE_PLANNING_SELF_EVIDENT.test(trimmed))
  ) {
    return {
      intent: "planning",
      groups: ["tasks_read", "schedule_read", "goals_read", "projects_read"],
      modelRole: "planning",
      reason: "planning phrase",
    };
  }

  // 8. Summaries and briefings.
  if (RE_SUMMARY.test(trimmed)) {
    return {
      intent: "summary",
      groups: ["tasks_read", "schedule_read", "goals_read"],
      modelRole: "summary",
      reason: "summary phrase",
    };
  }

  // 9. Schedule questions.
  if (mentionsSchedule) {
    return {
      intent: "schedule_query",
      groups: ["schedule_read", "tasks_read", "goals_read"],
      modelRole: "tool",
      reason: "schedule or date phrase",
    };
  }

  // 10. Task questions.
  if (mentionsTask || /\b(show|list|find|what|which|how many|do i have|have i)\b/i.test(trimmed)) {
    return {
      intent: "task_query",
      groups: ["tasks_read", "schedule_read"],
      modelRole: "tool",
      reason: "task question",
    };
  }

  // 11. Short, clearly conversational message.
  if (RE_SMALL_TALK.test(trimmed) && !RE_ANY_DATA_NOUN.test(trimmed)) {
    return {
      intent: "greeting",
      groups: [],
      modelRole: "simple",
      reason: "short conversational message with no data reference",
    };
  }

  // 12. Uncertain: grant read-only tools. Never nothing.
  return {
    intent: "unknown",
    groups: ["tasks_read", "schedule_read", "projects_read", "goals_read"],
    modelRole: "tool",
    reason: "no strong signal; defaulting to read-only tools",
    uncertain: true,
  };
}

/** Distinguishes "what have I completed?" from "complete my task". */
function isCompletionQuery(text: string): boolean {
  if (/\b(what|which|how many|list|show|give me|any)\b/i.test(text)) return true;
  if (/\b(i|my|the)\b.*\b(task|tasks|to-?do|item|thing|reminder|goal|project)\b/i.test(text)) return false;
  // "done" on its own is far more often a question ("is it done?") than a
  // command; require an imperative shape to treat it as a mutation.
  return true;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Last user-authored message in the conversation. */
export function lastUserMessage(messages: AIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

/**
 * The user turn before the last one.
 *
 * Needed because a bare agreement carries no verbs of its own: "yes" answers
 * the assistant's question about the *previous* request, so that request is
 * what says whether a task has to be moved, completed or deleted.
 */
function previousUserMessage(messages: AIMessage[]): string {
  let seenLast = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user" || typeof message.content !== "string") continue;
    if (seenLast) return message.content;
    seenLast = true;
  }
  return "";
}

/** True when a tool message is present, i.e. the model is mid-task. */
function hasToolContext(messages: AIMessage[]): boolean {
  return messages.some((message) => message.role === "tool" || (message.role === "assistant" && message.tool_calls?.length));
}

/**
 * Decides which tools a request may use. Deterministic by design; see the
 * module comment for the reasoning.
 */
export function routeRequest(messages: AIMessage[]): RoutingDecision {
  const inToolLoop = hasToolContext(messages);

  // An agreement is routed as the request it agrees with. "Yes" on its own has
  // no verbs, so classifying it left the run with read-only tools and the
  // operation the user had just confirmed could not be carried out at all.
  const agreeing = !inToolLoop && isConfirmationReply(messages);
  const agreeingWith = agreeing ? previousUserMessage(messages) : "";
  const text = agreeingWith || lastUserMessage(messages);

  // Once tools have been used in this conversation the request is demonstrably
  // data-dependent, so never strip tool access mid-thread.
  const signal = inToolLoop
    ? {
        intent: "unknown" as AIIntent,
        groups: ["tasks_read", "tasks_write", "schedule_read", "projects_read", "goals_read", "goals_write"] as ToolGroup[],
        modelRole: "tool" as ModelRole,
        reason: "conversation already used tools",
        uncertain: false,
      }
    : classify(text, messages.some((m) => m.role === "assistant"));

  const toolNames = dedupe(signal.groups.flatMap((group) => GROUP_TOOLS[group] ?? [])).filter((name) =>
    ALL_TOOL_NAMES.includes(name)
  );

  return {
    intent: signal.intent,
    groups: signal.groups,
    modelRole: signal.modelRole,
    toolNames,
    reason: agreeingWith ? `agreement with the previous request; ${signal.reason}` : signal.reason,
    uncertain: signal.uncertain ?? false,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Tool names for one group; used by tests and diagnostics. */
export function toolsForGroup(group: ToolGroup): string[] {
  return GROUP_TOOLS[group] ?? [];
}

/** Backwards-compatible helper: the tool names a request may use. */
export function getRequiredToolsForIntent(messages: AIMessage[]): string[] {
  return routeRequest(messages).toolNames;
}
