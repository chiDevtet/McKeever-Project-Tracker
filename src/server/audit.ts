import type { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/server/authz";
import type { Tx } from "@/server/db";

export interface AuditInput {
  projectId?: string | null;
  planId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** Append-only history of material changes (actor, timestamp, before/after). */
export async function audit(tx: Tx, viewer: Viewer | null, input: AuditInput & { workspaceId?: string }): Promise<void> {
  const workspaceId = input.workspaceId ?? viewer?.workspaceId;
  if (!workspaceId) throw new Error("audit requires a workspace");
  await tx.auditEvent.create({
    data: {
      workspaceId,
      projectId: input.projectId ?? null,
      planId: input.planId ?? null,
      actorId: viewer?.userId ?? null,
      actorName: viewer?.name ?? "system",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary.slice(0, 4000),
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
