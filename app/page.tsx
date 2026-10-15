import { getTasksForDate } from "@/lib/db/tasks";
import { PageClient } from "./PageClient";
import { DynamicGreeting } from "@/components/DynamicGreeting";
import { getZonedParts, todayISO, APP_TIMEZONE } from "@/lib/dates";
import { formatGreetingDate } from "@/lib/greetings";

export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const zoned = getZonedParts(now, APP_TIMEZONE);
  const today = todayISO(APP_TIMEZONE, now);

  const tasks = await getTasksForDate(today);

  const remaining = tasks.filter((t) => t.completed === 0).length;
  const completed = tasks.filter((t) => t.completed === 1).length;

  return (
    <div className="flex flex-col gap-6">
      <DynamicGreeting
        remaining={remaining}
        completed={completed}
        serverHour={zoned.hour}
        serverDateStr={formatGreetingDate(now)}
      />

      <div className="flex gap-4">
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-2xl flex-1 border border-gray-100 dark:border-zinc-800/50 shadow-sm">
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{remaining}</div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mt-1">Remaining</div>
        </div>
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-2xl flex-1 border border-gray-100 dark:border-zinc-800/50 shadow-sm">
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">{completed}</div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mt-1">Completed</div>
        </div>
      </div>

      <PageClient initialTasks={tasks} todayDate={today} />
    </div>
  );
}

