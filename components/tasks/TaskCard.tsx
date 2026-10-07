"use client";

import { Task, Priority } from "@/types/task";
import { Check, Clock, Calendar, Edit3, Trash2, Folder } from "lucide-react";
import { toggleTaskAction, removeTaskAction } from "@/app/actions";
import { useTransition } from "react";
import { motion } from "framer-motion";

export function TaskCard({ task, onEdit, compact = false, projectName }: { task: Task; onEdit?: (task: Task) => void, compact?: boolean, projectName?: string }) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(() => {
      toggleTaskAction(task.id, task.completed === 0);
    });
  };

  const priorityColors: Record<Priority, string> = {
    low: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
    medium: "text-amber-500 bg-amber-50 dark:bg-amber-900/20",
    high: "text-red-500 bg-red-50 dark:bg-red-900/20",
  };

  return (
    <motion.div layout className={`flex gap-3 ${compact ? 'p-3' : 'p-4'} bg-white dark:bg-zinc-800 rounded-2xl border ${task.completed ? "border-gray-100 dark:border-zinc-800/50 opacity-60" : "border-gray-200 dark:border-zinc-700"} transition-all`}>
      <button
        onClick={handleToggle}
        disabled={isPending}
        className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${task.completed
          ? "bg-blue-500 border-blue-500 text-white"
          : "border-gray-300 dark:border-zinc-500 hover:border-blue-500 dark:hover:border-blue-400 text-transparent"
          }`}
      >
        <Check size={14} strokeWidth={3} />
      </button>

      <div className="flex-1 min-w-0">
        <h3 className={`font-medium truncate ${task.completed ? "line-through text-gray-500 dark:text-zinc-500" : "text-gray-900 dark:text-zinc-100"}`}>
          {task.title}
        </h3>

        {task.description && !compact && (
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1 line-clamp-2">
            {task.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-3 text-xs font-medium">
          {projectName && !compact && (
            <div className="flex items-center gap-1 text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-700/50 px-2 py-0.5 rounded-md border border-gray-100 dark:border-zinc-600/50">
              <Folder size={12} />
              <span>{projectName}</span>
            </div>
          )}

          {task.scheduled_time && (
            <div className="flex items-center gap-1 text-gray-500 dark:text-zinc-400">
              <Clock size={12} />
              <span>{task.scheduled_time}</span>
            </div>
          )}

          <div className={`px-2 py-0.5 rounded-md ${priorityColors[task.priority]}`}>
            {task.priority.toUpperCase()}
          </div>

          {task.category && (
            <div className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300">
              {task.category}
            </div>
          )}
        </div>
      </div>

      {onEdit && (
        <div className="flex flex-col gap-2 shrink-0 opacity-0 md:opacity-100 transition-opacity group-hover:opacity-100" style={{ opacity: 1 /* override for mobile touch */ }}>
          <button onClick={() => onEdit(task)} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg">
            <Edit3 size={16} />
          </button>
        </div>
      )}
    </motion.div>
  );
}
