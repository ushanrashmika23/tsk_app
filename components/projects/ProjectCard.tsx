"use client";

import { Project } from "@/types/project";
import { Edit, Trash2, Folder } from "lucide-react";
import { removeProjectAction } from "@/app/projects/actions";
import { useTransition } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

export function ProjectCard({ project, onEdit }: { project: Project; onEdit: (project: Project) => void }) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm("Are you sure you want to delete this project? Tasks in this project will become unassigned.")) {
      startTransition(async () => {
        await removeProjectAction(project.id);
      });
    }
  };

  const isArchived = project.status === 'archived';

  return (
    <motion.div
      layout
      className={`group relative bg-white dark:bg-zinc-800/80 p-5 rounded-2xl border transition-all h-full flex flex-col ${
        isArchived
          ? "border-gray-200 dark:border-zinc-700 opacity-60"
          : "border-gray-100 dark:border-zinc-700 hover:border-gray-200 dark:hover:border-zinc-600 hover:shadow-lg hover:shadow-gray-100/50 dark:hover:shadow-black/20"
      }`}
    >
      <Link href={`/projects/${project.id}`} className="absolute inset-0 z-0" aria-label={`View project ${project.name}`} />
      
      <div className="relative z-10 flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-zinc-700/50 flex items-center justify-center border border-gray-100 dark:border-zinc-600/50" style={project.color ? { backgroundColor: `${project.color}20`, borderColor: `${project.color}40`, color: project.color } : {}}>
            <Folder size={20} />
          </div>
          <h3 className={`font-semibold text-lg ${isArchived ? "text-gray-500" : "text-gray-800 dark:text-zinc-100"}`}>
            {project.name}
          </h3>
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); onEdit(project); }}
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

      <div className="relative z-10 flex-1">
        {project.description ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
            {project.description}
          </p>
        ) : (
          <p className="text-sm text-gray-400 dark:text-zinc-500 italic">No description provided.</p>
        )}
      </div>

    </motion.div>
  );
}
