import "dotenv/config";
import { createHash } from "node:crypto";
import pg from "pg";
import { computeMeasures, planDateRange } from "@/domain/metrics";
import { prisma } from "@/server/db";
import { loadPlanData } from "@/server/plan-store";
import { hashJson } from "@/server/snapshots";
import { storage } from "@/server/storage/storage";

/**
 * pnpm backup:verify [--compare <source-database-url>]
 *
 * Checks a restored installation: every stored file is readable with its
 * recorded SHA-256, every snapshot still matches its data hash, and every
 * working plan reloads and computes totals. With --compare, row counts and
 * plan totals must equal the source database's.
 */
async function totals(planId: string, db: Parameters<typeof loadPlanData>[0]) {
  const data = await loadPlanData(db, planId);
  const range = planDateRange(data);
  return { revision: data.plan.revision, totals: range ? computeMeasures(data, range.start, range.end).totals : null };
}

async function main() {
  const compareIdx = process.argv.indexOf("--compare");
  const sourceUrl = compareIdx > 0 ? process.argv[compareIdx + 1] : null;
  const problems: string[] = [];

  const files = await prisma.storedFile.findMany();
  for (const f of files) {
    try {
      const bytes = await storage().get(f.storageKey);
      if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) problems.push(`file ${f.id} (${f.filename}) checksum differs`);
    } catch {
      problems.push(`file ${f.id} (${f.filename}) missing from storage`);
    }
  }
  const snapshots = await prisma.planSnapshot.findMany();
  for (const s of snapshots) if (hashJson(s.data) !== s.dataHash) problems.push(`snapshot ${s.id} data hash differs`);
  const plans = await prisma.plan.findMany({ where: { kind: "WORKING" } });
  const restoredTotals = new Map<string, unknown>();
  for (const p of plans) restoredTotals.set(p.id, await totals(p.id, prisma));

  if (sourceUrl) {
    const tables = (await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`)).map((t) => t.tablename);
    const src = new pg.Client({ connectionString: sourceUrl });
    await src.connect();
    try {
      for (const t of tables) {
        const [a] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`);
        const b = await src.query(`SELECT count(*)::bigint AS n FROM "${t}"`);
        if (String(a.n) !== String(b.rows[0].n)) problems.push(`table ${t}: restored ${a.n} rows, source ${b.rows[0].n}`);
      }
    } finally {
      await src.end();
    }
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@/generated/prisma/client");
    const source = new PrismaClient({ adapter: new PrismaPg({ connectionString: sourceUrl }) });
    try {
      for (const p of plans) {
        if (JSON.stringify(await totals(p.id, source)) !== JSON.stringify(restoredTotals.get(p.id))) problems.push(`plan ${p.id} totals differ from source`);
      }
    } finally {
      await source.$disconnect();
    }
  }
  console.log(`[verify] ${files.length} files, ${snapshots.length} snapshots, ${plans.length} working plans checked${sourceUrl ? " against the source database" : ""}`);
  for (const [id, t] of restoredTotals) console.log(`[verify] plan ${id}: ${JSON.stringify(t)}`);
  if (problems.length) {
    for (const p of problems) console.error(`[verify] PROBLEM: ${p}`);
    process.exitCode = 1;
  } else console.log("[verify] OK");
}

main()
  .catch((err) => {
    console.error(`[verify] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
