import { getDb } from "./client";
import { Goal, GoalInput } from "@/types/goal";

export async function getGoals(): Promise<Goal[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM goals ORDER BY status ASC, created_at DESC"
  ).all<Goal>();
  return result.results || [];
}

export async function getActiveGoals(): Promise<Goal[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM goals WHERE status = 'active' ORDER BY target_date ASC, created_at DESC"
  ).all<Goal>();
  return result.results || [];
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const db = getDb();
  const now = new Date().toISOString();
  
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO goals (id, title, description, target_date, progress, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.title,
    input.description || null,
    input.target_date || null,
    input.progress || 0,
    input.status || 'active',
    now,
    now
  ).run();

  return getGoal(id);
}

export async function getGoal(id: string): Promise<Goal> {
  const db = getDb();
  const result = await db.prepare("SELECT * FROM goals WHERE id = ?").bind(id).first<Goal>();
  if (!result) throw new Error("Goal not found");
  return result;
}

export async function updateGoal(id: string, updates: Partial<GoalInput>): Promise<Goal> {
  const db = getDb();
  const now = new Date().toISOString();
  
  const current = await getGoal(id);
  
  await db.prepare(`
    UPDATE goals 
    SET title = ?, description = ?, target_date = ?, progress = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    updates.title ?? current.title,
    updates.description !== undefined ? updates.description : current.description,
    updates.target_date !== undefined ? updates.target_date : current.target_date,
    updates.progress !== undefined ? updates.progress : current.progress,
    updates.status ?? current.status,
    now,
    id
  ).run();

  return getGoal(id);
}

export async function deleteGoal(id: string): Promise<void> {
  const db = getDb();
  await db.prepare("DELETE FROM goals WHERE id = ?").bind(id).run();
}
