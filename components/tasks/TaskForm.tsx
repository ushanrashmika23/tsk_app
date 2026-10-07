"use client";

import { useState, useEffect } from "react";
import { submitTaskAction, editTaskAction, removeTaskAction } from "@/app/actions";
import { getProjectsAction } from "@/app/projects/actions";
import { Task, TaskInput, Priority } from "@/types/task";
import { Project } from "@/types/project";
import { X, Trash2, Folder } from "lucide-react";

interface TaskFormProps {
  initialData?: Task;
  onClose: () => void;
  defaultDate?: string;
}

export function TaskForm({ initialData, onClose, defaultDate }: TaskFormProps) {
  const [title, setTitle] = useState(initialData?.title || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [date, setDate] = useState(initialData?.scheduled_date || defaultDate || new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(initialData?.scheduled_time || "");
  const [priority, setPriority] = useState<Priority>(initialData?.priority || "medium");
  const [category, setCategory] = useState(initialData?.category || "");
  const [projectId, setProjectId] = useState(initialData?.project_id || "");
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    getProjectsAction().then(setProjects);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    const input: TaskInput = {
      title,
      description,
      project_id: projectId || null,
      scheduled_date: date,
      scheduled_time: time || undefined,
      priority,
      category,
    };

    let result;
    if (initialData) {
      result = await editTaskAction(initialData.id, input);
    } else {
      result = await submitTaskAction(input);
    }

    setLoading(false);
    if (result.success) {
      onClose();
    } else {
      alert("Error: " + result.error);
    }
  };

  const handleDelete = async () => {
    if (!initialData || !confirm("Delete this task?")) return;
    setLoading(true);
    const result = await removeTaskAction(initialData.id);
    if (result.success) onClose();
    else {
      alert("Error: " + result.error);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
      <div className="bg-white dark:bg-zinc-900 w-full md:w-[400px] rounded-t-3xl md:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom-10 md:zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">{initialData ? "Edit Task" : "New Task"}</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <input
              autoFocus
              type="text"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-lg font-medium px-0 py-2 border-b-2 border-transparent focus:border-blue-500 bg-transparent outline-none transition-colors placeholder:text-gray-400"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <textarea
              placeholder="Notes (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="px-4 py-3 bg-gray-50 dark:bg-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/50 resize-none h-20 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-4 py-3 bg-gray-50 dark:bg-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Time (Opt)</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="px-4 py-3 bg-gray-50 dark:bg-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1"><Folder size={12}/> Project (Opt)</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="px-4 py-3 bg-gray-50 dark:bg-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
            >
              <option value="">No Project</option>
              {projects.filter(p => p.status === 'active').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${priority === p
                    ? p === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900/50"
                      : p === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50"
                    : "bg-gray-50 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border border-transparent hover:bg-gray-100 dark:hover:bg-zinc-700"
                    }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center mt-4">
            {initialData ? (
              <button
                type="button"
                onClick={handleDelete}
                className="p-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors flex items-center justify-center"
              >
                <Trash2 size={20} />
              </button>
            ) : <div />}
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
