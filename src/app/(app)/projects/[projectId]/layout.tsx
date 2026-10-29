import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProjectTabs } from "@/components/project/project-tabs";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/format";
import { assertProjectAccess, canEdit } from "@/server/authz";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { requirePageViewer } from "@/server/next-session";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const viewer = await requirePageViewer();
  try {
    await assertProjectAccess(viewer, projectId, "read");
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { parties: { include: { organization: true } } } });
  const party = (role: string) => project.parties.find((p) => p.role === role)?.organization.name;
  const parties = [
    party("CUSTOMER") && `${party("CUSTOMER")} (customer)`,
    party("GENERAL_CONTRACTOR") && `${party("GENERAL_CONTRACTOR")} (GC)`,
    party("OWNER") && `${party("OWNER")} (owner)`,
  ].filter(Boolean);
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b bg-background px-4 pt-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {project.code} <span className="font-normal text-muted-foreground">· {project.name}</span>
          </h1>
          <Badge variant="outline">{STATUS_LABELS[project.status]}</Badge>
          {!canEdit(viewer, projectId) ? <Badge variant="secondary">Read-only access</Badge> : null}
        </div>
        {parties.length ? <div className="text-xs text-muted-foreground">{parties.join(" · ")}</div> : null}
        <Suspense>
          <ProjectTabs projectId={projectId} />
        </Suspense>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
