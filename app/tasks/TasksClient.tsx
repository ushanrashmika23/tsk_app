"use client";

import { useState, useMemo } from "react";
import { Task } from "@/types/task";
import { Project } from "@/types/project";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskForm } from "@/components/tasks/TaskForm";
import { Plus, Search, Folder, CheckSquare, Inbox } from "lucide-react";

type Filter = "all" | "pending" | "completed" | "high";

export function TasksClient({ initialTasks, projects = [] }: { initialTasks: Task[], projects?: Project[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all"); // "all", "unassigned", or projectId
  const [search, setSearch] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const filteredTasks = useMemo(() => {
    let result = initialTasks;

    if (projectFilter === "unassigned") result = result.filter(t => !t.project_id);
    else if (projectFilter !== "all") result = result.filter(t => t.project_id === projectFilter);

    if (filter === "pending") result = result.filter(t => t.completed === 0);
    if (filter === "completed") result = result.filter(t => t.completed === 1);
    if (filter === "high") result = result.filter(t => t.priority === "high");

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }

    return result;
  }, [initialTasks, filter, search, projectFilter]);

  const activeProjects = useMemo(() => projects.filter(p => p.status === 'active'), [projects]);
  const unassignedCount = initialTasks.filter(t => !t.project_id).length;

  const groupedTasks = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    for (const t of filteredTasks) {
      if (!groups[t.scheduled_date]) groups[t.scheduled_date] = [];
      groups[t.scheduled_date].push(t);
    }

    // Sort dates
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredTasks]);

  const formatDateLabel = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00"); // keep local
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.getTime() === today.getTime()) return "TODAY";
    if (date.getTime() === tomorrow.getTime()) return "TOMORROW";

    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Sidebar for Projects */}
      <div className="w-full md:w-64 shrink-0 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 hidden md:block">Projects</h2>
        
        <div className="flex md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
          <button
            onClick={() => setProjectFilter("all")}
            className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${projectFilter === "all" ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300"}`}
          >
            <div className="flex items-center gap-2"><CheckSquare size={16} /> All Tasks</div>
            <span className="text-xs bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full text-gray-500">{initialTasks.length}</span>
          </button>

          <button
            onClick={() => setProjectFilter("unassigned")}
            className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${projectFilter === "unassigned" ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300"}`}
          >
            <div className="flex items-center gap-2"><Inbox size={16} /> Unassigned</div>
            <span className="text-xs bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full text-gray-500">{unassignedCount}</span>
          </button>

          <div className="hidden md:block h-px bg-gray-200 dark:bg-zinc-800 my-2" />

          {activeProjects.map(p => {
            const count = initialTasks.filter(t => t.project_id === p.id).length;
            return (
              <button
                key={p.id}
                onClick={() => setProjectFilter(p.id)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${projectFilter === p.id ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300"}`}
              >
                <div className="flex items-center gap-2"><Folder size={16} style={{ color: p.color || 'currentColor' }}/> <span className="max-w-[120px] truncate">{p.name}</span></div>
                <span className="text-xs bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full text-gray-500">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Task List */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex flex-col gap-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {(["all", "pending", "completed", "high"] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filter === f
                ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
                }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} {f === "high" && "Priority"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {groupedTasks.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No tasks found.</p>
          </div>
        ) : (
          groupedTasks.map(([dateStr, tasks]) => (
            <div key={dateStr} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-bold text-gray-500 tracking-wider">
                  {formatDateLabel(dateStr)}
                </h3>
                <span className="text-xs font-medium text-gray-400">{tasks.length} tasks</span>
              </div>

              {tasks.map(task => {
                const proj = projects.find(p => p.id === task.project_id);
                return (
                  <TaskCard key={task.id} task={task} onEdit={setEditingTask} projectName={proj?.name} />
                );
              })}
            </div>
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
          onClose={() => {
            setIsAdding(false);
            setEditingTask(null);
          }}
        />
      )}
      </div>
    </div>
  );
}
