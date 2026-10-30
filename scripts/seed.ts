import "dotenv/config";
import { prisma } from "@/server/db";
import { seedCmh139 } from "@/server/seed/cmh139";

/**
 * pnpm db:seed — production seed and safe reconciliation for CMH139: configuration,
 * reviewed milestone candidates, schedule phase windows, and planned installer
 * headcount per phase. Re-running adds only what is missing; it never deletes or
 * recreates the project.
 */
async function main() {
  const { log } = await seedCmh139(process.cwd());
  for (const line of log) console.log(`[seed] ${line}`);
}

main()
  .catch((err) => {
    console.error(`[seed] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
