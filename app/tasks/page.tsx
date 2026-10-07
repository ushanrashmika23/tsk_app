import { getAllTasks } from "@/lib/db/tasks";
import { getProjects } from "@/lib/db/projects";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TasksPage() {
  const tasks = await getAllTasks();
  const projects = await getProjects();

  return (
    <div className="flex flex-col gap-6">
      <header className="pt-4 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
      </header>

      <TasksClient initialTasks={tasks} projects={projects} />
    </div>
  );
}
