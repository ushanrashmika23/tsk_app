"use client";

import { Project } from "@/types/project";
import { Task } from "@/types/task";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle, Circle, Clock, Folder, Plus, Activity } from "lucide-react";
import Link from "next/link";
import { PageTransition, FadeIn, StaggerContainer, StaggerItem, MagnetButton } from "@/components/motion/Primitives";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskForm } from "@/components/tasks/TaskForm";
import { AnimatePresence, motion } from "framer-motion";

export default function ProjectDetailClient({ project, initialTasks }: { project: Project, initialTasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks); // In a real app we might rely on router.refresh(), but we keep simple state or just rely on server props and refresh.
  // Actually, since tasks can be edited in TaskCard, we should let TaskCard trigger a refresh or just use router.refresh().
  // Since we don't have router here, we'll just use initialTasks and expect page reload or we can use useRouter.
  // Wait, let's use useRouter for refresh.
  
  const [isAddingTask, setIsAddingTask] = useState(false);

  const completedTasks = initialTasks.filter(t => t.completed);
  const pendingTasks = initialTasks.filter(t => !t.completed);
  
  const progress = initialTasks.length === 0 ? 0 : Math.round((completedTasks.length / initialTasks.length) * 100);

  // Group by priority
  const highPriority = pendingTasks.filter(t => t.priority === 'high');
  const medPriority = pendingTasks.filter(t => t.priority === 'medium');
  const lowPriority = pendingTasks.filter(t => t.priority === 'low');

  return (
    <PageTransition className="pb-32">
      <div className="max-w-4xl mx-auto pt-6 px-4">
        <div className="mb-8">
          <FadeIn>
            <Link href="/projects" className="inline-flex items-center text-sm text-gray-500 hover:text-blue-500 transition-colors mb-4">
              <ArrowLeft size={16} className="mr-1" /> Back to Projects
            </Link>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gray-50 dark:bg-zinc-800/50 flex items-center justify-center border border-gray-100 dark:border-zinc-700/50" style={project.color ? { backgroundColor: `${project.color}20`, borderColor: `${project.color}40`, color: project.color } : {}}>
                <Folder size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-zinc-100">{project.name}</h1>
                {project.description && (
                  <p className="text-gray-500 dark:text-zinc-400 mt-1">{project.description}</p>
                )}
              </div>
            </div>
          </FadeIn>
        </div>

        {/* Dashboard Stats */}
        <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StaggerItem className="bg-white dark:bg-zinc-800/80 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700 flex flex-col gap-2">
            <span className="text-gray-500 dark:text-zinc-400 text-sm font-medium flex items-center gap-2"><Activity size={16}/> Progress</span>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{progress}%</span>
            <div className="w-full bg-gray-100 dark:bg-zinc-700 h-1.5 rounded-full mt-1 overflow-hidden">
              <motion.div 
                initial={{ width: 0 }} 
                animate={{ width: `${progress}%` }} 
                transition={{ duration: 1, ease: "easeOut" }}
                className="h-full bg-blue-500 rounded-full" 
                style={project.color ? { backgroundColor: project.color } : {}}
              />
            </div>
          </StaggerItem>
          <StaggerItem className="bg-white dark:bg-zinc-800/80 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700 flex flex-col gap-2">
            <span className="text-gray-500 dark:text-zinc-400 text-sm font-medium flex items-center gap-2"><Circle size={16}/> Total Tasks</span>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{initialTasks.length}</span>
          </StaggerItem>
          <StaggerItem className="bg-white dark:bg-zinc-800/80 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700 flex flex-col gap-2">
            <span className="text-gray-500 dark:text-zinc-400 text-sm font-medium flex items-center gap-2"><Clock size={16}/> Pending</span>
            <span className="text-3xl font-bold text-amber-500">{pendingTasks.length}</span>
          </StaggerItem>
          <StaggerItem className="bg-white dark:bg-zinc-800/80 p-5 rounded-2xl border border-gray-100 dark:border-zinc-700 flex flex-col gap-2">
            <span className="text-gray-500 dark:text-zinc-400 text-sm font-medium flex items-center gap-2"><CheckCircle size={16}/> Completed</span>
            <span className="text-3xl font-bold text-green-500">{completedTasks.length}</span>
          </StaggerItem>
        </StaggerContainer>

        {/* Tasks Organization */}
        <div className="space-y-10">
          
          {/* Pending tasks grouped by priority */}
          {pendingTasks.length > 0 && (
            <FadeIn>
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-6">In Progress</h2>
              <div className="space-y-6">
                
                {highPriority.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-red-500 uppercase tracking-wider mb-3">High Priority</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {highPriority.map(task => (
                        <TaskCard key={task.id} task={task} compact />
                      ))}
                    </div>
                  </div>
                )}

                {medPriority.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider mb-3">Medium Priority</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {medPriority.map(task => (
                        <TaskCard key={task.id} task={task} compact />
                      ))}
                    </div>
                  </div>
                )}

                {lowPriority.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-blue-500 uppercase tracking-wider mb-3">Low Priority</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {lowPriority.map(task => (
                        <TaskCard key={task.id} task={task} compact />
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </FadeIn>
          )}

          {/* Completed Tasks */}
          {completedTasks.length > 0 && (
            <FadeIn>
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-6 flex items-center gap-2">
                Done <span className="text-sm font-normal text-gray-400">({completedTasks.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
                {completedTasks.map(task => (
                  <TaskCard key={task.id} task={task} compact />
                ))}
              </div>
            </FadeIn>
          )}

          {initialTasks.length === 0 && (
            <FadeIn className="text-center py-20 bg-gray-50 dark:bg-zinc-800/30 rounded-3xl border border-gray-100 dark:border-zinc-700/50">
              <Folder size={48} className="mx-auto text-gray-300 dark:text-zinc-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">This project is empty</h3>
              <p className="text-gray-500 dark:text-zinc-400 mt-2 max-w-sm mx-auto">
                Break down your project into manageable tasks and start making progress.
              </p>
              <button
                onClick={() => setIsAddingTask(true)}
                className="mt-6 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/20"
              >
                <Plus size={18} /> Add First Task
              </button>
            </FadeIn>
          )}

        </div>
      </div>

      <MagnetButton className="fixed bottom-24 md:bottom-8 right-6 md:right-8 z-40" strength={40}>
        <button
          onClick={() => setIsAddingTask(true)}
          className="w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-blue-600/30 transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={28} />
        </button>
      </MagnetButton>

      <AnimatePresence>
        {isAddingTask && (
          <TaskForm
            onClose={() => setIsAddingTask(false)}
            initialData={{ project_id: project.id } as any}
          />
        )}
      </AnimatePresence>

    </PageTransition>
  );
}
