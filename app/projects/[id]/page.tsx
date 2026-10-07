import { getProject } from "@/lib/db/projects";
import { getTasksByProject } from "@/lib/db/tasks";
import ProjectDetailClient from "./ProjectDetailClient";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const project = await getProject(params.id);
    const tasks = await getTasksByProject(params.id);

    return <ProjectDetailClient project={project} initialTasks={tasks} />;
  } catch (error) {
    notFound();
  }
}
