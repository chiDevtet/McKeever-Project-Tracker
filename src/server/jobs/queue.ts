import { PgBoss } from "pg-boss";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

export const QUEUES = { importExtract: "import-extract", reportRender: "report-render" } as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * pg-boss needs session features (LISTEN/NOTIFY, advisory locks), so it uses
 * DIRECT_DATABASE_URL: on Neon that is the non-pooled endpoint.
 */
export function queueConnectionString(): string {
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required for the job queue");
  return url;
}

let senderPromise: Promise<PgBoss> | null = null;

/** Send-only queue client for the web process (no workers, no maintenance). */
async function sender(): Promise<PgBoss> {
  senderPromise ??= (async () => {
    const boss = new PgBoss({ connectionString: queueConnectionString(), schema: "pgboss", max: 2, supervise: false, schedule: false, migrate: true });
    boss.on("error", (e) => console.error("[queue] sender error", e.message));
    await boss.start();
    for (const q of Object.values(QUEUES)) await boss.createQueue(q, { retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 900 }).catch(() => undefined);
    return boss;
  })();
  return senderPromise;
}

/**
 * Persist a job record and enqueue it. The idempotency key makes retries of
 * the same request return the existing job instead of duplicating work; the
 * queue job id equals the record id, so pg-boss cannot hold two copies.
 */
export async function enqueueJob(input: { workspaceId: string; projectId: string | null; kind: QueueName; payload: Record<string, unknown>; idempotencyKey: string; createdById: string | null }) {
  const existing = await prisma.backgroundJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && existing.status !== "FAILED" && existing.status !== "CANCELED") return existing;
  const job = existing
    ? await prisma.backgroundJob.update({ where: { id: existing.id }, data: { status: "QUEUED", error: null, progress: 0, message: "Re-queued", finishedAt: null } })
    : await prisma.backgroundJob.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, kind: input.kind, payload: input.payload as Prisma.InputJsonValue, idempotencyKey: input.idempotencyKey, createdById: input.createdById, message: "Waiting for the worker" } });
  const boss = await sender();
  await boss.send(input.kind, { jobId: job.id }, { id: existing ? undefined : job.id, retryLimit: 2, retryDelay: 10, retryBackoff: true, singletonKey: job.id });
  return job;
}
