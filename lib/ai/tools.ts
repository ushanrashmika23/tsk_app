import { z } from "zod";
import { AITool } from "./types";
import { getAllTasks, getTasksForDate, getUpcomingTasks, createTask, updateTask, toggleTaskCompletion, deleteTask, getTask } from "@/lib/db/tasks";
import { getActiveGoals, createGoal, updateGoal } from "@/lib/db/goals";
import { getProjects } from "@/lib/db/projects";

// Tool Schemas definition
export const getTasksSchema = z.object({
  startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
  endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
  completed: z.boolean().optional().describe("Filter by completion status"),
});

export const createTaskSchema = z.object({
  title: z.string().describe("Title of the task"),
  description: z.string().nullable().optional().describe("Optional detailed description"),
  scheduledDate: z.string().describe("Date for the task in YYYY-MM-DD format"),
  scheduledTime: z.string().nullable().optional().describe("Optional time in HH:MM format"),
  priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority level"),
  category: z.string().nullable().optional().describe("Optional category label"),
  projectId: z.string().nullable().optional().describe("Optional project ID if the task belongs to a project"),
});

export const updateTaskSchema = z.object({
  id: z.string().describe("The ID of the task to update"),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  category: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

export const completeTaskSchema = z.object({
  id: z.string().describe("The ID of the task to complete"),
});

export const createGoalSchema = z.object({
  title: z.string().describe("Title of the goal"),
  description: z.string().nullable().optional().describe("Optional description"),
  targetDate: z.string().nullable().optional().describe("Date in YYYY-MM-DD format"),
});

export const updateGoalSchema = z.object({
  id: z.string().describe("The ID of the goal to update"),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  progress: z.number().min(0).max(100).optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

export const completeGoalSchema = z.object({
  id: z.string().describe("The ID of the goal to complete"),
});

// AITool Definitions for LLM
export const toolsDefinition: Record<string, AITool> = {
  get_tasks: {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Get tasks by date or completion.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          completed: { type: "boolean" }
        }
      }
    }
  },
  get_schedule: {
    type: "function",
    function: {
      name: "get_schedule",
      description: "Get upcoming schedule.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "YYYY-MM-DD" }
        },
        required: ["startDate"]
      }
    }
  },
  create_task: {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          scheduledDate: { type: "string", description: "YYYY-MM-DD" },
          scheduledTime: { type: "string", description: "HH:MM" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          projectId: { type: "string", description: "ID of the project" }
        },
        required: ["title", "scheduledDate"]
      }
    }
  },
  update_task: {
    type: "function",
    function: {
      name: "update_task",
      description: "Update an existing task.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          scheduledDate: { type: "string", description: "YYYY-MM-DD" },
          scheduledTime: { type: "string", description: "HH:MM" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          projectId: { type: "string", description: "ID of the project" }
        },
        required: ["id"]
      }
    }
  },
  complete_task: {
    type: "function",
    function: {
      name: "complete_task",
      description: "Complete a task by ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" }
        },
        required: ["id"]
      }
    }
  },
  get_goals: {
    type: "function",
    function: {
      name: "get_goals",
      description: "Retrieve active goals.",
      parameters: { type: "object", properties: {} }
    }
  },
  get_projects: {
    type: "function",
    function: {
      name: "get_projects",
      description: "Retrieve all available projects.",
      parameters: { type: "object", properties: {} }
    }
  },
  create_goal: {
    type: "function",
    function: {
      name: "create_goal",
      description: "Create a new goal.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          targetDate: { type: "string", description: "YYYY-MM-DD" }
        },
        required: ["title"]
      }
    }
  },
  update_goal: {
    type: "function",
    function: {
      name: "update_goal",
      description: "Update a goal.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          targetDate: { type: "string" },
          progress: { type: "number", description: "0-100" },
          status: { type: "string", enum: ["active", "completed", "archived"] }
        },
        required: ["id"]
      }
    }
  },
  complete_goal: {
    type: "function",
    function: {
      name: "complete_goal",
      description: "Complete a goal.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" }
        },
        required: ["id"]
      }
    }
  }
};

const compressTask = (t: any) => ({
  id: t.id,
  title: t.title,
  date: t.scheduled_date,
  time: t.scheduled_time || undefined,
  priority: t.priority,
  completed: Boolean(t.completed)
});

const compressGoal = (g: any) => ({
  id: g.id,
  title: g.title,
  progress: g.progress,
  targetDate: g.target_date || undefined,
  status: g.status
});

// Tool Executor
export async function executeTool(name: string, argsStr: string): Promise<string> {
  try {
    const args = JSON.parse(argsStr);

    switch (name) {
      case "get_tasks": {
        const parsed = getTasksSchema.parse(args);
        let tasks = [];
        if (parsed.startDate && parsed.startDate === parsed.endDate) {
          tasks = await getTasksForDate(parsed.startDate);
        } else {
          tasks = await getAllTasks();
          if (parsed.startDate) {
            tasks = tasks.filter(t => t.scheduled_date >= parsed.startDate!);
          }
          if (parsed.endDate) {
            tasks = tasks.filter(t => t.scheduled_date <= parsed.endDate!);
          }
        }
        
        if (parsed.completed !== undefined) {
          tasks = tasks.filter(t => Boolean(t.completed) === parsed.completed);
        }
        return JSON.stringify({ tasks: tasks.map(compressTask) });
      }
      
      case "get_schedule": {
        const startDate = args.startDate;
        if (!startDate) return JSON.stringify({ error: "startDate required" });
        const tasks = await getUpcomingTasks(startDate);
        return JSON.stringify({ tasks: tasks.map(compressTask) });
      }
      
      case "create_task": {
        const parsed = createTaskSchema.parse(args);
        const task = await createTask({
          title: parsed.title,
          description: parsed.description || undefined,
          scheduled_date: parsed.scheduledDate,
          scheduled_time: parsed.scheduledTime || undefined,
          priority: parsed.priority || "medium",
          category: parsed.category || undefined,
          project_id: parsed.projectId || undefined,
        });
        return JSON.stringify({ success: true, task: compressTask(task) });
      }

      case "update_task": {
        const parsed = updateTaskSchema.parse(args);
        const task = await updateTask(parsed.id, {
          title: parsed.title,
          description: parsed.description ?? undefined,
          scheduled_date: parsed.scheduledDate,
          scheduled_time: parsed.scheduledTime ?? undefined,
          priority: parsed.priority,
          category: parsed.category ?? undefined,
          project_id: parsed.projectId,
        });
        return JSON.stringify({ success: true, task: compressTask(task) });
      }
      
      case "complete_task": {
        const parsed = completeTaskSchema.parse(args);
        const task = await toggleTaskCompletion(parsed.id, true);
        return JSON.stringify({ success: true, task: compressTask(task) });
      }

      case "get_goals": {
        const goals = await getActiveGoals();
        return JSON.stringify({ goals: goals.map(compressGoal) });
      }

      case "get_projects": {
        const projects = await getProjects();
        return JSON.stringify({ projects: projects.map(p => ({ id: p.id, name: p.name })) });
      }

      case "create_goal": {
        const parsed = createGoalSchema.parse(args);
        const goal = await createGoal({
          title: parsed.title,
          description: parsed.description || undefined,
          target_date: parsed.targetDate || undefined
        });
        return JSON.stringify({ success: true, goal: compressGoal(goal) });
      }

      case "update_goal": {
        const parsed = updateGoalSchema.parse(args);
        const goal = await updateGoal(parsed.id, {
          title: parsed.title,
          description: parsed.description,
          target_date: parsed.targetDate,
          progress: parsed.progress,
          status: parsed.status as any
        });
        return JSON.stringify({ success: true, goal: compressGoal(goal) });
      }

      case "complete_goal": {
        const parsed = completeGoalSchema.parse(args);
        const goal = await updateGoal(parsed.id, { status: "completed", progress: 100 });
        return JSON.stringify({ success: true, goal: compressGoal(goal) });
      }
      
      default:
        return JSON.stringify({ error: "Tool not found" });
    }
  } catch (error: any) {
    return JSON.stringify({ error: error.message || "Tool error" });
  }
}
