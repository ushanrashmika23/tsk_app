import { z } from "zod";
import {
  getProjects,
  getProject,
  findProjectById,
  findProjectsByName,
  createProject,
  patchProject,
  deleteProject,
} from "@/lib/db/projects";
import { getTasksByProject } from "@/lib/db/tasks";
import { ok, fail, guard, clarification, toProjectView, toTaskView, isToolFailure, loadProjectNames } from "./shared";
import type { AgentTool, ToolExecutionContext } from "../types";
import type { Project } from "@/types/project";

async function presentTasks(tasks: Awaited<ReturnType<typeof getTasksByProject>>, ctx: ToolExecutionContext) {
  const names = await loadProjectNames(tasks.map((t) => t.project_id));
  return tasks.map((task) => toTaskView(task, { today: ctx.today, projectNames: names }));
}

const getProjectsSchema = z.object({
  status: z.enum(["active", "archived"]).optional().describe("Filter by status. Omit for all projects."),
});

const getProjectsTool: AgentTool<typeof getProjectsSchema> = {
  name: "get_projects",
  kind: "read",
  description: "List projects with their ids. Call this before assigning a task to a project.",
  schema: getProjectsSchema,
  handler: (args) =>
    guard(async () => {
      const projects = await getProjects(args.status);
      return ok({ count: projects.length, projects: projects.map(toProjectView) });
    }),
};

const getProjectSchema = z.object({
  id: z.string().min(1).describe("Exact project id."),
});

const getProjectTool: AgentTool<typeof getProjectSchema> = {
  name: "get_project",
  kind: "read",
  description: "Retrieve one project by its exact id.",
  schema: getProjectSchema,
  handler: (args) =>
    guard(async () => {
      const project = await findProjectById(args.id);
      if (!project) return fail("NOT_FOUND", `No project exists with id "${args.id}".`, { id: args.id });
      return ok({ project: toProjectView(project) });
    }),
};

const findProjectSchema = z.object({
  name: z.string().min(1).describe('Project name as the user said it, e.g. "TKS-App".'),
});

/**
 * Resolves a project name without ever substituting a lookalike. When a name
 * does not exist the real project list is returned so the agent can offer it.
 */
const findProjectTool: AgentTool<typeof findProjectSchema> = {
  name: "find_project",
  kind: "read",
  description:
    "Resolve a project name to its exact id. Reports `ambiguous` when several projects match and lists the real projects when none do. Never assume a similar name is the intended project.",
  schema: findProjectSchema,
  handler: (args) =>
    guard(async () => {
      const candidates: Project[] = await findProjectsByName(args.name);

      if (candidates.length === 0) {
        const all = await getProjects();
        return ok({
          query: args.name,
          found: false,
          ambiguous: false,
          candidates: [],
          availableProjects: all.map(toProjectView),
          instruction:
            "No project has that name. Tell the user it does not exist and list the real projects; do not attach the task to a different project.",
        });
      }

      if (candidates.length > 1) {
        return ok({
          query: args.name,
          found: true,
          ambiguous: true,
          candidates: candidates.map(toProjectView),
          instruction: "Several projects match. Ask the user which one they mean before using an id.",
        });
      }

      return ok({
        query: args.name,
        found: true,
        ambiguous: false,
        project: toProjectView(candidates[0]),
        candidates: candidates.map(toProjectView),
      });
    }),
};

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional().describe("Optional hex colour such as #3b82f6."),
  status: z.enum(["active", "archived"]).optional(),
});

const createProjectTool: AgentTool<typeof createProjectSchema> = {
  name: "create_project",
  kind: "write",
  description: "Create a new project. Only call this when the user explicitly asks for a project to be created.",
  schema: createProjectSchema,
  handler: (args) =>
    guard(async () => {
      const existing = await findProjectsByName(args.name);
      if (existing.length > 0) {
        return fail("AMBIGUOUS_MATCH", `A project named "${args.name}" already exists. Ask whether to use it.`, {
          existingProjects: existing.map(toProjectView),
        });
      }
      const project = await createProject({
        name: args.name,
        description: args.description,
        color: args.color,
        status: args.status,
      });
      return ok({ project: toProjectView(project), verified: true });
    }),
};

const updateProjectSchema = z.object({
  id: z.string().min(1).describe("Exact project id."),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const updateProjectTool: AgentTool<typeof updateProjectSchema> = {
  name: "update_project",
  kind: "write",
  description: "Update selected fields of one project. Omitted fields are preserved.",
  schema: updateProjectSchema,
  handler: (args) =>
    guard(async () => {
      const before = await findProjectById(args.id);
      if (!before) return fail("NOT_FOUND", `No project exists with id "${args.id}".`, { id: args.id });

      const patch: Parameters<typeof patchProject>[1] = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.description !== undefined) patch.description = args.description;
      if (args.color !== undefined) patch.color = args.color;
      if (args.status !== undefined) patch.status = args.status;

      if (Object.keys(patch).length === 0) {
        return clarification("What would you like to change about this project?");
      }

      const project = await patchProject(args.id, patch);
      return ok({ project: toProjectView(project), previous: toProjectView(before), verified: true });
    }),
};

const deleteProjectSchema = z.object({
  id: z.string().min(1),
  confirm: z.boolean().optional().describe("Must be true. Only after the user has explicitly confirmed."),
});

const deleteProjectTool: AgentTool<typeof deleteProjectSchema> = {
  name: "delete_project",
  kind: "write",
  description:
    "Delete a project. Tasks in the project are kept and simply detached, which is reported back. Requires explicit user confirmation.",
  schema: deleteProjectSchema,
  handler: (args) =>
    guard(async () => {
      const project = await findProjectById(args.id);
      if (!project) return fail("NOT_FOUND", `No project exists with id "${args.id}".`, { id: args.id });

      if (args.confirm !== true) {
        const taskCount = (await getTasksByProject(args.id)).length;
        return fail(
          "CONFIRMATION_REQUIRED",
          `Deleting the project "${project.name}" cannot be undone. Its ${taskCount} task(s) would be kept but detached. Confirm with the user first.`,
          { project: toProjectView(project), taskCount }
        );
      }

      const result = await deleteProject(args.id);
      const stillThere = await findProjectById(args.id);
      if (stillThere) {
        return fail("TOOL_ERROR", "The delete did not take effect; the project is still stored.", { id: args.id });
      }
      return ok({ ...result, project: toProjectView(project), verified: true });
    }),
};

const getProjectTasksSchema = z.object({
  id: z.string().min(1).describe("Exact project id."),
  includeCompleted: z.boolean().optional().describe("Include completed tasks. Defaults to true."),
});

const getProjectTasksTool: AgentTool<typeof getProjectTasksSchema> = {
  name: "get_project_tasks",
  kind: "read",
  description: "List the tasks assigned to one project, with counts of what is still outstanding.",
  schema: getProjectTasksSchema,
  handler: (args, ctx) =>
    guard(async () => {
      const project = await findProjectById(args.id);
      if (!project) return fail("NOT_FOUND", `No project exists with id "${args.id}".`, { id: args.id });

      const all = await getTasksByProject(args.id);
      const visible = args.includeCompleted === false ? all.filter((t) => !t.completed) : all;
      const tasks = await presentTasks(visible, ctx);

      return ok({
        project: toProjectView(project),
        counts: {
          total: all.length,
          remaining: all.filter((t) => !t.completed).length,
          completed: all.filter((t) => t.completed).length,
        },
        tasks,
      });
    }),
};

export const PROJECT_TOOLS = [
  getProjectsTool,
  getProjectTool,
  findProjectTool,
  createProjectTool,
  updateProjectTool,
  deleteProjectTool,
  getProjectTasksTool,
] as unknown as AgentTool[];
