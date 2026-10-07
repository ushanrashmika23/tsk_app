"use client";

import { useState, useMemo } from "react";
import { Task } from "@/types/task";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskForm } from "@/components/tasks/TaskForm";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";

export function ScheduleClient({ initialTasks }: { initialTasks: Task[] }) {
  const [currentDate, setCurrentDate] = useState(() => {
    return new Date().toLocaleDateString('en-CA');
  });
  
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Generate 7 days starting from today
  const weekDays = useMemo(() => {
    const days = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // We want to show a 7 day window around the current date, or just 7 days from today.
    // For a simple schedule view, let's show a rolling 7-day strip.
    const start = new Date(currentDate + "T00:00:00");
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push({
        dateStr: d.toLocaleDateString('en-CA'),
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: d.getDate(),
        isToday: d.getTime() === today.getTime()
      });
    }
    return days;
  }, [currentDate]);

  const tasksForDay = useMemo(() => {
    return initialTasks.filter(t => t.scheduled_date === currentDate);
  }, [initialTasks, currentDate]);

  const changeWeek = (offset: number) => {
    const d = new Date(currentDate + "T00:00:00");
    d.setDate(d.getDate() + offset * 7);
    setCurrentDate(d.toLocaleDateString('en-CA'));
  };

  const setToday = () => {
    setCurrentDate(new Date().toLocaleDateString('en-CA'));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-gray-900 dark:text-zinc-100">
          {new Date(currentDate + "T00:00:00").toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={setToday} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 dark:bg-zinc-800 rounded-lg mr-2 hover:bg-gray-200">
            Today
          </button>
          <button onClick={() => changeWeek(-1)} className="p-1.5 bg-gray-100 dark:bg-zinc-800 rounded-lg hover:bg-gray-200">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => changeWeek(1)} className="p-1.5 bg-gray-100 dark:bg-zinc-800 rounded-lg hover:bg-gray-200">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex justify-between gap-1 mb-8 overflow-x-auto scrollbar-hide pb-2">
        {weekDays.map(day => {
          const isSelected = day.dateStr === currentDate;
          return (
            <button
              key={day.dateStr}
              onClick={() => setCurrentDate(day.dateStr)}
              className={`flex flex-col items-center flex-1 min-w-[3rem] py-3 rounded-2xl transition-colors ${
                isSelected
                  ? "bg-blue-600 text-white shadow-md"
                  : day.isToday
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                    : "hover:bg-gray-100 dark:hover:bg-zinc-800"
              }`}
            >
              <span className={`text-[10px] font-semibold tracking-wide uppercase ${isSelected ? "text-blue-200" : "text-gray-500"}`}>
                {day.dayName}
              </span>
              <span className={`text-lg font-bold mt-1 ${isSelected ? "text-white" : "text-gray-900 dark:text-zinc-100"}`}>
                {day.dayNum}
              </span>
              {isSelected && day.isToday && (
                <span className="w-1 h-1 bg-white rounded-full mt-1" />
              )}
              {!isSelected && day.isToday && (
                <span className="w-1 h-1 bg-blue-600 rounded-full mt-1" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-gray-500 tracking-wider mb-2">
          {tasksForDay.length} Tasks Scheduled
        </h3>

        {tasksForDay.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white dark:bg-zinc-800 rounded-2xl border border-gray-100 dark:border-zinc-800/50">
            <p>Your schedule is clear.</p>
            <button 
              onClick={() => setIsAdding(true)}
              className="mt-4 text-blue-600 font-medium hover:underline"
            >
              + Add a task
            </button>
          </div>
        ) : (
          tasksForDay.map(task => (
            <TaskCard key={task.id} task={task} onEdit={setEditingTask} />
          ))
        )}
      </div>

      <button
        onClick={() => setIsAdding(true)}
        className="fixed md:absolute bottom-24 md:bottom-8 right-6 md:right-8 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 z-40"
      >
        <Plus size={28} />
      </button>

      {(isAdding || editingTask) && (
        <TaskForm 
          initialData={editingTask || undefined} 
          defaultDate={currentDate}
          onClose={() => {
            setIsAdding(false);
            setEditingTask(null);
          }} 
        />
      )}
    </>
  );
}
