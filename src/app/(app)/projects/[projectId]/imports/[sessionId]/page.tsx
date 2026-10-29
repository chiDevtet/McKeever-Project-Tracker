import { notFound } from "next/navigation";
import { ImportReview } from "@/components/imports/import-review";
import { canEdit } from "@/server/authz";
import { prisma } from "@/server/db";
import { requirePageViewer } from "@/server/next-session";
import { getImport } from "@/server/services/imports";

export const metadata = { title: "Review import" };

export default async function ImportSessionPage({ params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  const { projectId, sessionId } = await params;
  const viewer = await requirePageViewer();
  const view = await getImport(viewer, { sessionId });
  if (view.session.projectId !== projectId) notFound();
  const [phases, areas, systems] = await Promise.all([
    prisma.phase.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.area.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.system.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sourceAliases: true } }),
  ]);
  return <ImportReview key={view.session.id} initial={view} structure={{ phases, areas, systems }} canEdit={canEdit(viewer, projectId)} />;
}
