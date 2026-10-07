import { getDb } from "./client";
import { Task, TaskInput } from "@/types/task";

export async function getTasksForDate(date: string): Promise<Task[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM tasks WHERE scheduled_date = ? ORDER BY completed ASC, priority DESC, scheduled_time ASC"
  ).bind(date).all<Task>();
  return result.results || [];
}

export async function getAllTasks(): Promise<Task[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM tasks ORDER BY scheduled_date ASC, completed ASC, priority DESC"
  ).all<Task>();
  return result.results || [];
}

export async function getUpcomingTasks(fromDate: string): Promise<Task[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM tasks WHERE scheduled_date >= ? ORDER BY scheduled_date ASC, completed ASC, priority DESC"
  ).bind(fromDate).all<Task>();
  return result.results || [];
}

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? ORDER BY completed ASC, scheduled_date ASC, priority DESC"
  ).bind(projectId).all<Task>();
  return result.results || [];
}

export async function getTasksWithoutProject(): Promise<Task[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM tasks WHERE project_id IS NULL ORDER BY completed ASC, scheduled_date ASC, priority DESC"
  ).all<Task>();
  return result.results || [];
}

export async function createTask(input: TaskInput): Promise<Task> {
  const db = getDb();
  const now = new Date().toISOString();
  
  // If no uuid library, we use crypto.randomUUID()
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO tasks (id, title, description, project_id, scheduled_date, scheduled_time, priority, category, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.title,
    input.description || null,
    input.project_id || null,
    input.scheduled_date,
    input.scheduled_time || null,
    input.priority || 'medium',
    input.category || null,
    now,
    now
  ).run();

  return getTask(id);
}

export async function getTask(id: string): Promise<Task> {
  const db = getDb();
  const result = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Task>();
  if (!result) throw new Error("Task not found");
  return result;
}

export async function updateTask(id: string, updates: Partial<TaskInput>): Promise<Task> {
  const db = getDb();
  const now = new Date().toISOString();
  
  const current = await getTask(id);
  
  await db.prepare(`
    UPDATE tasks 
    SET title = ?, description = ?, project_id = ?, scheduled_date = ?, scheduled_time = ?, priority = ?, category = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    updates.title ?? current.title,
    updates.description !== undefined ? updates.description : current.description,
    updates.project_id !== undefined ? updates.project_id : current.project_id,
    updates.scheduled_date ?? current.scheduled_date,
    updates.scheduled_time !== undefined ? updates.scheduled_time : current.scheduled_time,
    updates.priority ?? current.priority,
    updates.category !== undefined ? updates.category : current.category,
    now,
    id
  ).run();

  return getTask(id);
}

export async function toggleTaskCompletion(id: string, completed: boolean): Promise<Task> {
  const db = getDb();
  const now = new Date().toISOString();
  const completed_at = completed ? now : null;
  const completedNum = completed ? 1 : 0;
  
  await db.prepare(`
    UPDATE tasks SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?
  `).bind(completedNum, completed_at, now, id).run();
  
  return getTask(id);
}

export async function deleteTask(id: string): Promise<void> {
  const db = getDb();
  await db.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
}
