import { createHash } from "node:crypto";
import { formatDate, dateFromDb } from "@/domain/dates";
import type { PlanData } from "@/domain/plan";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import { loadPlanData } from "@/server/plan-store";

/** Frozen, self-contained copy of a plan with the provenance reports print. */
export interface SnapshotData {
  schemaVersion: 1;
  capturedAt: string;
  companyName: string;
  sources: { label: string; detail: string }[];
  plan: PlanData;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

export const hashJson = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export async function sourceSummary(db: Tx, projectId: string): Promise<{ label: string; detail: string }[]> {
  const lineages = await db.sourceLineage.findMany({ where: { projectId }, include: { versions: { orderBy: { versionNumber: "asc" } } }, orderBy: { name: "asc" } });
  return lineages.map((l) => {
    const latest = l.versions.at(-1);
    const detail = !latest
      ? "No version committed"
      : `${l.versions.length} version(s); latest v${latest.versionNumber} “${latest.label}”${latest.sourceDate ? ` dated ${formatDate(dateFromDb(latest.sourceDate))}` : ""}${latest.dataDate ? `, data date ${formatDate(dateFromDb(latest.dataDate))}` : ""}`;
    return { label: l.name, detail };
  });
}

export async function captureSnapshotData(db: Tx, planId: string): Promise<SnapshotData> {
  const plan = await loadPlanData(db, planId);
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), companyName: plan.project.workspaceName, sources: await sourceSummary(db, plan.project.id), plan };
}

/** Freeze a plan. Pass `plan` to snapshot data already loaded in the same transaction (for example the state before a promotion). */
export async function createSnapshot(db: Tx, input: { planId: string; kind: "BASELINE" | "REPORT" | "REVISION_BACKUP"; name: string; description?: string | null; createdById: string | null; plan?: PlanData }) {
  const data: SnapshotData = input.plan
    ? { schemaVersion: 1, capturedAt: new Date().toISOString(), companyName: input.plan.project.workspaceName, sources: await sourceSummary(db, input.plan.project.id), plan: input.plan }
    : await captureSnapshotData(db, input.planId);
  return db.planSnapshot.create({
    data: {
      projectId: data.plan.project.id,
      planId: input.planId,
      planKind: data.plan.plan.kind,
      planName: data.plan.plan.name,
      planRevision: data.plan.plan.revision,
      kind: input.kind,
      name: input.name,
      description: input.description ?? null,
      data: data as unknown as Prisma.InputJsonValue,
      dataHash: hashJson(data),
      createdById: input.createdById,
    },
  });
}

export function snapshotFromRow(row: { data: unknown }): SnapshotData {
  return row.data as SnapshotData;
}
