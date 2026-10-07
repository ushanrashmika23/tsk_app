import { getGoals } from "@/lib/db/goals";
import GoalsClient from "./GoalsClient";

export const metadata = {
  title: 'Goals | Task & Schedule Manager',
  description: 'Manage your personal goals',
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GoalsPage() {
  const goals = await getGoals();
  return <GoalsClient initialGoals={goals} />;
}
