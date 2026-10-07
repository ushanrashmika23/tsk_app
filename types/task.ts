export type Priority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time: string | null; // HH:MM
  priority: Priority;
  category: string | null;
  completed: number; // 0 or 1 for SQLite
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  scheduled_date: string;
  scheduled_time?: string;
  priority?: Priority;
  category?: string;
}
