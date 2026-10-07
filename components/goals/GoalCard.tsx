"use client";

import { Goal } from "@/types/goal";
import { CheckCircle2, Circle, Edit, Trash2, Target } from "lucide-react";
import { editGoalAction, removeGoalAction } from "@/app/goals/actions";
import { useState, useTransition } from "react";
import { motion } from "framer-motion";

export function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: (goal: Goal) => void }) {
  const [isPending, startTransition] = useTransition();
  const [isCompleting, setIsCompleting] = useState(false);

  const handleToggleComplete = () => {
    setIsCompleting(true);
    const newStatus = goal.status === 'completed' ? 'active' : 'completed';
    // When completed, max progress. Otherwise, if it was completed and now active, keep progress as is (or max it, up to you).
    const newProgress = newStatus === 'completed' ? 100 : goal.progress;
    
    startTransition(async () => {
      await editGoalAction(goal.id, { status: newStatus, progress: newProgress });
      setIsCompleting(false);
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this goal?")) {
      startTransition(async () => {
        await removeGoalAction(goal.id);
      });
    }
  };

  const isCompleted = goal.status === 'completed';

  return (
    <motion.div
      layout
      className={`group relative bg-white dark:bg-zinc-800/80 p-5 rounded-2xl border transition-all ${
        isCompleted
          ? "border-green-100 dark:border-green-900/30 opacity-70"
          : "border-gray-100 dark:border-zinc-700 hover:border-gray-200 dark:hover:border-zinc-600 hover:shadow-lg hover:shadow-gray-100/50 dark:hover:shadow-black/20"
      }`}
    >
      <div className="flex gap-4">
        <button
          onClick={handleToggleComplete}
          disabled={isPending || isCompleting}
          className={`mt-1 flex-shrink-0 focus:outline-none transition-transform hover:scale-110 active:scale-90 ${(isPending || isCompleting) ? "opacity-50" : ""}`}
        >
          {isCompleted ? (
            <CheckCircle2 className="text-green-500 fill-green-50" size={24} />
          ) : (
            <Circle className="text-gray-300 dark:text-zinc-600 hover:text-green-500 transition-colors" size={24} />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-4">
            <h3
              className={`font-semibold text-lg truncate transition-all ${
                isCompleted ? "text-gray-400 dark:text-gray-500 line-through" : "text-gray-800 dark:text-zinc-100"
              }`}
            >
              {goal.title}
            </h3>
            
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onEdit(goal)}
                disabled={isPending}
                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
              >
                <Edit size={16} />
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {goal.description && (
            <p className={`text-sm mt-1.5 line-clamp-2 ${
              isCompleted ? "text-gray-400 dark:text-gray-600" : "text-gray-600 dark:text-gray-400"
            }`}>
              {goal.description}
            </p>
          )}

          <div className="mt-4 flex items-center gap-4 text-xs">
            <div className="flex-1 bg-gray-100 dark:bg-zinc-700 h-2.5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${goal.progress}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className={`h-full rounded-full ${
                  isCompleted ? "bg-green-500" : "bg-blue-500"
                }`}
              />
            </div>
            <span className="font-medium min-w-[3ch] text-right text-gray-500 dark:text-gray-400">
              {goal.progress}%
            </span>
          </div>

          {goal.target_date && (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-500 bg-gray-50 dark:bg-zinc-800/50 w-fit px-2 py-1 rounded-md border border-gray-100 dark:border-zinc-700/50">
              <Target size={14} />
              Target: {new Date(goal.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
