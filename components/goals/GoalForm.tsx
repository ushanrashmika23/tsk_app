"use client";

import { useState, useTransition } from "react";
import { X, Target } from "lucide-react";
import { submitGoalAction, editGoalAction } from "@/app/goals/actions";
import { Goal } from "@/types/goal";
import { motion } from "framer-motion";

interface GoalFormProps {
  onClose: () => void;
  initialData?: Goal;
}

export function GoalForm({ onClose, initialData }: GoalFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const target_date = formData.get("target_date") as string;
    const progressStr = formData.get("progress") as string;
    const progress = parseInt(progressStr || '0', 10);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (progress < 0 || progress > 100) {
      setError("Progress must be between 0 and 100");
      return;
    }

    startTransition(async () => {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        target_date: target_date || null,
        progress,
        status: initialData ? initialData.status : 'active' as const,
      };

      const result = initialData
        ? await editGoalAction(initialData.id, input)
        : await submitGoalAction(input);

      if (result.success) {
        onClose();
      } else {
        setError(result.error || "Failed to save goal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white dark:bg-zinc-900 rounded-3xl w-full max-w-lg shadow-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
            <Target size={24} className="text-blue-500" />
            {initialData ? 'Edit Goal' : 'New Goal'}
          </h2>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-5">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Goal Title *
              </label>
              <input
                autoFocus
                id="title"
                name="title"
                type="text"
                required
                placeholder="e.g. Learn Software Architecture"
                defaultValue={initialData?.title}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                placeholder="Details about this goal..."
                defaultValue={initialData?.description || ""}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 dark:text-white resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="target_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Target Date
                </label>
                <input
                  id="target_date"
                  name="target_date"
                  type="date"
                  defaultValue={initialData?.target_date || ""}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label htmlFor="progress" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Progress (%)
                </label>
                <input
                  id="progress"
                  name="progress"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={initialData?.progress ?? 0}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 text-sm rounded-xl">
              {error}
            </div>
          )}

          <div className="mt-8 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-zinc-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-blue-600/20"
            >
              {isPending ? "Saving..." : initialData ? "Save Changes" : "Create Goal"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
