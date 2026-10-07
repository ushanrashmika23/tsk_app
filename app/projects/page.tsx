import { getProjects } from "@/lib/db/projects";
import ProjectsClient from "./ProjectsClient";

export const metadata = {
  title: 'Projects | Task & Schedule Manager',
  description: 'Manage your projects',
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <ProjectsClient initialProjects={projects} />;
}
