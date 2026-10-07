import { AIIntent, AIModelConfig, AI_CONFIG } from "./config";
import { AIMessage } from "./types";

export function determineIntent(messages: AIMessage[]): AIIntent {
  const lastUserMessage = messages.filter(m => m.role === "user").pop()?.content?.toLowerCase() || "";

  if (lastUserMessage.includes("summary") || lastUserMessage.includes("summarize")) {
    return "day_summary";
  }

  if (lastUserMessage.includes("goal") || lastUserMessage.includes("objective")) {
    return "goal_management";
  }

  if (lastUserMessage.includes("add ") || lastUserMessage.includes("create ") || lastUserMessage.includes("remind me to")) {
    return "task_creation";
  }

  if (lastUserMessage.includes("complete") || lastUserMessage.includes("done") || lastUserMessage.includes("finish")) {
    return "task_completion";
  }

  if (lastUserMessage.includes("update") || lastUserMessage.includes("change ") || lastUserMessage.includes("edit ")) {
    return "task_update";
  }

  if (lastUserMessage.includes("what do i have") || lastUserMessage.includes("schedule") || lastUserMessage.includes("next task")) {
    return "schedule_query";
  }

  if (lastUserMessage.includes("conflict") || lastUserMessage.includes("plan my week")) {
    return "complex_planning";
  }

  return "simple_chat";
}

export function selectModelConfig(intent: AIIntent): AIModelConfig {
  switch (intent) {
    case "day_summary":
      return AI_CONFIG.summary;
    case "task_creation":
    case "task_update":
    case "task_completion":
    case "schedule_query":
    case "goal_management":
      return AI_CONFIG.tool;
    case "complex_planning":
      return AI_CONFIG.reasoning;
    case "simple_chat":
    default:
      return AI_CONFIG.simple;
  }
}

export function getRequiredToolsForIntent(intent: AIIntent): string[] {
  switch (intent) {
    case "task_creation":
      return ["create_task", "get_projects"];
    case "task_update":
      return ["get_tasks", "update_task", "get_projects"];
    case "task_completion":
      return ["get_tasks", "complete_task"];
    case "schedule_query":
    case "day_summary":
      return ["get_tasks", "get_schedule", "get_goals"];
    case "complex_planning":
      return ["get_tasks", "get_schedule", "get_goals"];
    case "goal_management":
      return ["get_goals", "create_goal", "update_goal", "complete_goal"];
    case "simple_chat":
    default:
      return [];
  }
}
