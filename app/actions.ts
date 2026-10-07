"use server";

import { revalidatePath } from "next/cache";
import { createTask, updateTask, toggleTaskCompletion, deleteTask } from "@/lib/db/tasks";
import { TaskInput } from "@/types/task";

export async function submitTaskAction(input: TaskInput) {
  try {
    await createTask(input);
    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/schedule");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function editTaskAction(id: string, input: Partial<TaskInput>) {
  try {
    await updateTask(id, input);
    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/schedule");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function toggleTaskAction(id: string, completed: boolean) {
  try {
    await toggleTaskCompletion(id, completed);
    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/schedule");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function removeTaskAction(id: string) {
  try {
    await deleteTask(id);
    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/schedule");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
