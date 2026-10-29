import "dotenv/config";
import { createServer } from "node:http";
import { PgBoss } from "pg-boss";
import { prisma } from "@/server/db";
import { QUEUES, queueConnectionString } from "@/server/jobs/queue";
import { closeBrowser } from "@/reporting/pdf";
import { renderReports } from "./handlers/report-render";
import { extractImport } from "./handlers/import-extract";
import { runJob, semaphore } from "./runner";

/**
 * Background worker: schedule extraction and report rendering. Heavy PDF
 * work is serialized (WORKER_HEAVY_CONCURRENCY, default 1).
 */
async function main() {
  const heavy = semaphore(Math.max(1, Number(process.env.WORKER_HEAVY_CONCURRENCY ?? 1)));
  const boss = new PgBoss({ connectionString: queueConnectionString(), schema: "pgboss", max: 4 });
  boss.on("error", (e) => console.error("[worker] queue error:", e.message));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q, { retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 900 }).catch(() => undefined);

  let lastJobAt: string | null = null;
  const handle = (name: string, fn: (payload: Record<string, unknown>, progress: Parameters<Parameters<typeof runJob>[1]>[1]) => Promise<unknown>) =>
    boss.work<{ jobId: string }>(name, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
      lastJobAt = new Date().toISOString();
      console.log(`[worker] ${name} job ${job.data.jobId} (queue attempt ${job.retryCount + 1})`);
      await heavy(() => runJob(job.data.jobId, fn));
    });
  await handle(QUEUES.reportRender, renderReports);
  await handle(QUEUES.importExtract, extractImport);

  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3100);
  const server = createServer(async (req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, lastJobAt }));
    } catch {
      res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ ok: false }));
    }
  });
  server.listen(port, () => console.log(`[worker] ready; health on :${port}/healthz`));

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal}: finishing current job and stopping`);
    server.close();
    await boss.stop({ graceful: true, timeout: 60_000 });
    await closeBrowser();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});
