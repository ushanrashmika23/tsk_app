import { getTasksForDate } from "@/lib/db/tasks";
import { TaskCard } from "@/components/tasks/TaskCard";
import { Plus } from "lucide-react";
import { PageClient } from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Use today's date in local YYYY-MM-DD
  // Since this is a server component, we need to be careful with timezones.
  // We'll use a simple approach: just get the current date string on the server.
  // Ideally, we'd pass the client timezone, but for simplicity we'll use server date or let client fetch it.
  // For this app, let's just use the server's current date.
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  
  const tasks = await getTasksForDate(today);
  
  const remaining = tasks.filter(t => t.completed === 0).length;
  const completed = tasks.filter(t => t.completed === 1).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="pt-4 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Good morning</h1>
        <p className="text-gray-500 dark:text-zinc-400 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        
        <div className="flex gap-4 mt-6">
          <div className="bg-white dark:bg-zinc-800 p-4 rounded-2xl flex-1 border border-gray-100 dark:border-zinc-800/50 shadow-sm">
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{remaining}</div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mt-1">Remaining</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 p-4 rounded-2xl flex-1 border border-gray-100 dark:border-zinc-800/50 shadow-sm">
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">{completed}</div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mt-1">Completed</div>
          </div>
        </div>
      </header>

      <PageClient initialTasks={tasks} todayDate={today} />
    </div>
  );
}
