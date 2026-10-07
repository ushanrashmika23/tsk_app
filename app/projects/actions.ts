"use server";

import { revalidatePath } from "next/cache";
import { createProject, updateProject, deleteProject, getProjects } from "@/lib/db/projects";
import { ProjectInput, Project } from "@/types/project";

export async function getProjectsAction(): Promise<Project[]> {
  return getProjects();
}

export async function submitProjectAction(input: ProjectInput) {
  try {
    await createProject(input);
    revalidatePath("/projects");
    revalidatePath("/tasks");
    revalidatePath("/");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function editProjectAction(id: string, input: Partial<ProjectInput>) {
  try {
    await updateProject(id, input);
    revalidatePath("/projects");
    revalidatePath("/tasks");
    revalidatePath("/");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function removeProjectAction(id: string) {
  try {
    await deleteProject(id);
    revalidatePath("/projects");
    revalidatePath("/tasks");
    revalidatePath("/");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
