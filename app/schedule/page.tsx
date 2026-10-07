import { getUpcomingTasks } from "@/lib/db/tasks";
import { ScheduleClient } from "./ScheduleClient";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const today = new Date().toLocaleDateString('en-CA');
  const tasks = await getUpcomingTasks(today);
  
  return (
    <div className="flex flex-col gap-6">
      <header className="pt-4 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
      </header>

      <ScheduleClient initialTasks={tasks} />
    </div>
  );
}
