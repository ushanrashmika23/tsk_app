export type GoalStatus = 'active' | 'completed' | 'archived';

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  progress: number;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
}

export interface GoalInput {
  title: string;
  description?: string | null;
  target_date?: string | null;
  progress?: number;
  status?: GoalStatus;
}
