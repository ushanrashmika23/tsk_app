import { getAllTasks } from "@/lib/db/tasks";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const tasks = await getAllTasks();
  
  return (
    <div className="flex flex-col gap-6">
      <header className="pt-4 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
      </header>

      <TasksClient initialTasks={tasks} />
    </div>
  );
}
