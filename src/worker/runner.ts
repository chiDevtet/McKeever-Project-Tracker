import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

/** One heavy PDF job (extraction or rendering) at a time by default. */
export function semaphore(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export type Progress = (percent: number, message: string) => Promise<void>;

/**
 * Run a persisted job. A job that already succeeded is not repeated (safe
 * queue retries); failures record details and rethrow so the queue retries
 * until attempts are exhausted.
 */
export async function runJob<T>(jobId: string, fn: (payload: Record<string, unknown>, progress: Progress) => Promise<T>): Promise<T | null> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Unknown job ${jobId}`);
  if (job.status === "SUCCEEDED" || job.status === "CANCELED") return null;
  const attempt = job.attempts + 1;
  await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "RUNNING", attempts: attempt, startedAt: new Date(), message: `Attempt ${attempt}`, error: null } });
  const progress: Progress = async (percent, message) => {
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { progress: Math.max(0, Math.min(100, Math.round(percent))), message } });
  };
  try {
    const result = await fn(job.payload as Record<string, unknown>, progress);
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", progress: 100, message: "Done", result: (result ?? null) as Prisma.InputJsonValue, finishedAt: new Date() } });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = attempt >= job.maxAttempts;
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: final ? "FAILED" : "QUEUED", error: message.slice(0, 4000), message: final ? "Failed" : `Attempt ${attempt} failed; will retry`, finishedAt: final ? new Date() : null } });
    throw err;
  }
}
