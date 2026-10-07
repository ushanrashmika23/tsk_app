"use client";

import { Goal } from "@/types/goal";
import { useState, useMemo } from "react";
import { GoalCard } from "@/components/goals/GoalCard";
import { GoalForm } from "@/components/goals/GoalForm";
import { Plus, Target } from "lucide-react";
import { PageTransition, StaggerContainer, StaggerItem, FadeIn, MagnetButton } from "@/components/motion/Primitives";
import { AnimatePresence } from "framer-motion";

export default function GoalsClient({ initialGoals }: { initialGoals: Goal[] }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  const activeGoals = useMemo(() => initialGoals.filter(g => g.status === 'active'), [initialGoals]);
  const completedGoals = useMemo(() => initialGoals.filter(g => g.status === 'completed'), [initialGoals]);

  return (
    <PageTransition className="pb-32">
      <div className="max-w-3xl mx-auto pt-6 px-4">
        
        <div className="mb-10">
          <FadeIn>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-zinc-100 flex items-center gap-3">
              <Target className="text-blue-500" size={32} />
              Goals
            </h1>
            <p className="text-gray-500 dark:text-zinc-400 mt-2">
              What you ultimately want to achieve.
            </p>
          </FadeIn>
        </div>

        <div className="space-y-12">
          {/* Active Goals */}
          <section>
            <FadeIn>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Active Goals
                <span className="text-sm font-normal text-gray-400 ml-2">({activeGoals.length})</span>
              </h2>
            </FadeIn>
            
            {activeGoals.length === 0 ? (
              <FadeIn className="text-center py-12 text-gray-500 bg-white/50 dark:bg-zinc-800/30 rounded-3xl border border-gray-100 dark:border-zinc-800/50 backdrop-blur-sm">
                <p>No active goals.</p>
                <button
                  onClick={() => setIsAdding(true)}
                  className="mt-4 text-blue-600 font-medium hover:underline"
                >
                  + Add your first goal
                </button>
              </FadeIn>
            ) : (
              <StaggerContainer className="flex flex-col gap-4">
                {activeGoals.map(goal => (
                  <StaggerItem key={goal.id}>
                    <GoalCard goal={goal} onEdit={setEditingGoal} />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            )}
          </section>

          {/* Completed Goals */}
          {completedGoals.length > 0 && (
            <section>
              <FadeIn>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Completed Goals
                  <span className="text-sm font-normal text-gray-400 ml-2">({completedGoals.length})</span>
                </h2>
              </FadeIn>
              
              <StaggerContainer className="flex flex-col gap-4">
                {completedGoals.map(goal => (
                  <StaggerItem key={goal.id}>
                    <GoalCard goal={goal} onEdit={setEditingGoal} />
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
        {(isAdding || editingGoal) && (
          <GoalForm
            initialData={editingGoal || undefined}
            onClose={() => {
              setIsAdding(false);
              setEditingGoal(null);
            }}
          />
        )}
      </AnimatePresence>
    </PageTransition>
  );
}
