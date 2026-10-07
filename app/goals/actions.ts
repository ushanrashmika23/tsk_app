"use server";

import { revalidatePath } from "next/cache";
import { createGoal, updateGoal, deleteGoal } from "@/lib/db/goals";
import { GoalInput } from "@/types/goal";

export async function submitGoalAction(input: GoalInput) {
  try {
    await createGoal(input);
    revalidatePath("/goals");
    revalidatePath("/");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function editGoalAction(id: string, input: Partial<GoalInput>) {
  try {
    await updateGoal(id, input);
    revalidatePath("/goals");
    revalidatePath("/");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function removeGoalAction(id: string) {
  try {
    await deleteGoal(id);
    revalidatePath("/goals");
    revalidatePath("/");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
