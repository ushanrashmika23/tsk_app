"use client";

import { useState, useMemo } from "react";
import { Task } from "@/types/task";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskForm } from "@/components/tasks/TaskForm";
import { Plus, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";

export function ScheduleClient({ initialTasks }: { initialTasks: Task[] }) {
  // We use currentMonth to track which month's calendar is being displayed
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // If a date is selected, we show the day details view instead of the calendar
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Calendar generation logic
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday, 1 = Monday...
    const totalDays = lastDayOfMonth.getDate();

    const days = [];

    // Padding for previous month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ isPadding: true, dateStr: "" });
    }

    // Days of the current month
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(year, month, i);
      const dateStr = d.toLocaleDateString('en-CA');
      days.push({
        isPadding: false,
        dateStr,
        dayNum: i,
        isToday: dateStr === new Date().toLocaleDateString('en-CA')
      });
    }

    return days;
  }, [currentMonth]);

  const changeMonth = (offset: number) => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev);
      newMonth.setMonth(prev.getMonth() + offset);
      return newMonth;
    });
  };

  const tasksForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return initialTasks.filter(t => t.scheduled_date === selectedDate);
  }, [initialTasks, selectedDate]);

  return (
    <>
      {!selectedDate ? (
        // --- CALENDAR VIEW ---
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={() => {
                const d = new Date();
                d.setDate(1);
                setCurrentMonth(d);
              }} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 dark:bg-zinc-800 rounded-lg hover:bg-gray-200">
                Today
              </button>
              <button onClick={() => changeMonth(-1)} className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-lg hover:bg-gray-200">
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => changeMonth(1)} className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-lg hover:bg-gray-200">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs font-bold text-gray-500 uppercase tracking-wider py-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2 md:gap-3">
            {calendarDays.map((day, idx) => {
              if (day.isPadding) {
                return <div key={`pad-${idx}`} className="h-24 md:h-32 rounded-xl bg-transparent"></div>;
              }

              const dayTasks = initialTasks.filter(t => t.scheduled_date === day.dateStr);

              return (
                <button
                  key={day.dateStr}
                  onClick={() => setSelectedDate(day.dateStr)}
                  className={`h-24 md:h-32 flex flex-col p-2 md:p-3 rounded-xl border text-left transition-all hover:border-blue-400 hover:shadow-md ${day.isToday
                    ? "bg-blue-50/50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-900"
                    : "bg-white border-gray-100 dark:bg-zinc-900 dark:border-zinc-800"
                    }`}
                >
                  <span className={`text-sm font-bold mb-1 ${day.isToday ? "text-blue-600" : "text-gray-700 dark:text-gray-300"}`}>
                    {day.dayNum}
                  </span>

                  <div className="flex-1 overflow-hidden flex flex-col gap-1 w-full mt-1">
                    {dayTasks.slice(0, 3).map(task => (
                      <div key={task.id} className="text-[10px] md:text-xs truncate px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300">
                        {task.completed ? <span className="line-through opacity-70">{task.title}</span> : task.title}
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <div className="text-[10px] text-gray-400 font-medium pl-1">
                        +{dayTasks.length - 3} more
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        // --- DAY DETAILS VIEW ---
        <div className="flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
          <button
            onClick={() => setSelectedDate(null)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:hover:text-white mb-6 font-medium w-fit transition-colors"
          >
            <ArrowLeft size={18} />
            Back to Calendar
          </button>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100">
              {new Date(selectedDate + "T00:00:00").toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>
            <p className="text-gray-500 mt-1">
              {tasksForSelectedDate.length} {tasksForSelectedDate.length === 1 ? 'task' : 'tasks'} scheduled
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {tasksForSelectedDate.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-white dark:bg-zinc-800 rounded-2xl border border-gray-100 dark:border-zinc-800/50">
                <p>Your schedule is clear for this day.</p>
                <button
                  onClick={() => setIsAdding(true)}
                  className="mt-4 text-blue-600 font-medium hover:underline"
                >
                  + Add a task
                </button>
              </div>
            ) : (
              tasksForSelectedDate.map(task => (
                <TaskCard key={task.id} task={task} onEdit={setEditingTask} />
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating Action Button (Always available) */}
      <button
        onClick={() => setIsAdding(true)}
        className="fixed bottom-24 md:bottom-8 right-6 md:right-8 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 z-40"
      >
        <Plus size={28} />
      </button>

      {/* Task Form Modal */}
      {(isAdding || editingTask) && (
        <TaskForm
          initialData={editingTask || undefined}
          defaultDate={selectedDate || new Date().toLocaleDateString('en-CA')}
          onClose={() => {
            setIsAdding(false);
            setEditingTask(null);
          }}
        />
      )}
    </>
  );
}
