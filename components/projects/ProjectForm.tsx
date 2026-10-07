"use client";

import { useState, useTransition } from "react";
import { X, Folder } from "lucide-react";
import { submitProjectAction, editProjectAction } from "@/app/projects/actions";
import { Project } from "@/types/project";
import { motion } from "framer-motion";

interface ProjectFormProps {
  onClose: () => void;
  initialData?: Project;
}

const COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // green
  "#f59e0b", // yellow
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#6366f1", // indigo
  "#14b8a6", // teal
];

export function ProjectForm({ onClose, initialData }: ProjectFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(initialData?.color || COLORS[0]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const status = formData.get("status") as any;

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    startTransition(async () => {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        color: selectedColor,
        status: status || 'active',
      };

      const result = initialData
        ? await editProjectAction(initialData.id, input)
        : await submitProjectAction(input);

      if (result.success) {
        onClose();
      } else {
        setError(result.error || "Failed to save project");
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
            <Folder size={24} className="text-blue-500" />
            {initialData ? 'Edit Project' : 'New Project'}
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
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Project Name *
              </label>
              <input
                autoFocus
                id="name"
                name="name"
                type="text"
                required
                placeholder="e.g. LifeOS Redesign"
                defaultValue={initialData?.name}
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
                placeholder="Details about this project..."
                defaultValue={initialData?.description || ""}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 dark:text-white resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Color
              </label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${selectedColor === c ? 'scale-110 border-gray-800 dark:border-white' : 'border-transparent hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {initialData && (
              <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={initialData.status}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            )}
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
              {isPending ? "Saving..." : initialData ? "Save Changes" : "Create Project"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
