"use client";

import { Project } from "@/types/project";
import { useState, useMemo } from "react";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { Plus, Folder } from "lucide-react";
import { PageTransition, StaggerContainer, StaggerItem, FadeIn, MagnetButton } from "@/components/motion/Primitives";
import { AnimatePresence } from "framer-motion";

export default function ProjectsClient({ initialProjects }: { initialProjects: Project[] }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const activeProjects = useMemo(() => initialProjects.filter(p => p.status === 'active'), [initialProjects]);
  const archivedProjects = useMemo(() => initialProjects.filter(p => p.status === 'archived'), [initialProjects]);

  return (
    <PageTransition className="pb-32">
      <div className="max-w-3xl mx-auto pt-6 px-4">
        
        <div className="mb-10">
          <FadeIn>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-zinc-100 flex items-center gap-3">
              <Folder className="text-blue-500" size={32} />
              Projects
            </h1>
            <p className="text-gray-500 dark:text-zinc-400 mt-2">
              Group related tasks together.
            </p>
          </FadeIn>
        </div>

        <div className="space-y-12">
          {/* Active Projects */}
          <section>
            <FadeIn>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Active Projects
                <span className="text-sm font-normal text-gray-400 ml-2">({activeProjects.length})</span>
              </h2>
            </FadeIn>
            
            {activeProjects.length === 0 ? (
              <FadeIn className="text-center py-12 text-gray-500 bg-white/50 dark:bg-zinc-800/30 rounded-3xl border border-gray-100 dark:border-zinc-800/50 backdrop-blur-sm">
                <p>No active projects.</p>
                <button
                  onClick={() => setIsAdding(true)}
                  className="mt-4 text-blue-600 font-medium hover:underline"
                >
                  + Create your first project
                </button>
              </FadeIn>
            ) : (
              <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeProjects.map(project => (
                  <StaggerItem key={project.id}>
                    <ProjectCard project={project} onEdit={setEditingProject} />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            )}
          </section>

          {/* Archived Projects */}
          {archivedProjects.length > 0 && (
            <section>
              <FadeIn>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                  Archived Projects
                  <span className="text-sm font-normal text-gray-400 ml-2">({archivedProjects.length})</span>
                </h2>
              </FadeIn>
              
              <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-75">
                {archivedProjects.map(project => (
                  <StaggerItem key={project.id}>
                    <ProjectCard project={project} onEdit={setEditingProject} />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </section>
          )}
        </div>
      </div>

      {/* Floating Action Button */}
      <MagnetButton className="fixed bottom-24 md:bottom-8 right-6 md:right-8 z-40" strength={40}>
        <button
          onClick={() => setIsAdding(true)}
          className="w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-blue-600/30 transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={28} />
        </button>
      </MagnetButton>

      {/* Form Modal */}
      <AnimatePresence>
        {(isAdding || editingProject) && (
          <ProjectForm
            initialData={editingProject || undefined}
            onClose={() => {
              setIsAdding(false);
              setEditingProject(null);
            }}
          />
        )}
      </AnimatePresence>
    </PageTransition>
  );
}
