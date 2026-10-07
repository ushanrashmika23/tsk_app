"use client";

import { useState } from "react";
import { Task } from "@/types/task";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskForm } from "@/components/tasks/TaskForm";
import { Plus } from "lucide-react";

export function PageClient({ initialTasks, todayDate }: { initialTasks: Task[], todayDate: string }) {
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  return (
    <>
      <div className="flex justify-between items-center mt-2">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Today's Tasks</h2>
      </div>

      <div className="flex flex-col gap-3">
        {initialTasks.length === 0 ? (
          <div className="bg-white dark:bg-zinc-800 p-8 rounded-2xl border border-gray-100 dark:border-zinc-800/50 text-center">
            <p className="text-gray-500 font-medium">You're all caught up.</p>
            <button
              onClick={() => setIsAdding(true)}
              className="mt-4 text-blue-600 dark:text-blue-400 font-medium hover:underline"
            >
              + Add a task for today
            </button>
          </div>
        ) : (
          initialTasks.map(task => (
            <TaskCard key={task.id} task={task} onEdit={setEditingTask} />
          ))
        )}
      </div>

      <button
        onClick={() => setIsAdding(true)}
        className="fixed bottom-24 md:bottom-8 right-6 md:right-8 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 z-40"
      >
        <Plus size={28} />
      </button>

      {(isAdding || editingTask) && (
        <TaskForm
          initialData={editingTask || undefined}
          defaultDate={todayDate}
          onClose={() => {
            setIsAdding(false);
            setEditingTask(null);
          }}
        />
      )}
    </>
  );
}
