import { getDb } from "./client";
import { Project, ProjectInput } from "@/types/project";

export async function getProjects(): Promise<Project[]> {
  const db = getDb();
  const result = await db.prepare(
    "SELECT * FROM projects ORDER BY status ASC, created_at DESC"
  ).all<Project>();
  return result.results || [];
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const db = getDb();
  const now = new Date().toISOString();
  
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO projects (id, name, description, color, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.name,
    input.description || null,
    input.color || null,
    input.status || 'active',
    now,
    now
  ).run();

  return getProject(id);
}

export async function getProject(id: string): Promise<Project> {
  const db = getDb();
  const result = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<Project>();
  if (!result) throw new Error("Project not found");
  return result;
}

export async function updateProject(id: string, updates: Partial<ProjectInput>): Promise<Project> {
  const db = getDb();
  const now = new Date().toISOString();
  
  const current = await getProject(id);
  
  await db.prepare(`
    UPDATE projects 
    SET name = ?, description = ?, color = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    updates.name ?? current.name,
    updates.description !== undefined ? updates.description : current.description,
    updates.color !== undefined ? updates.color : current.color,
    updates.status ?? current.status,
    now,
    id
  ).run();

  return getProject(id);
}

export async function deleteProject(id: string): Promise<void> {
  const db = getDb();
  
  // Update tasks that belong to this project to have no project
  await db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ?").bind(id).run();
  
  // Then delete the project
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
}
