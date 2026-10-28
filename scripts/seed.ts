import "dotenv/config";
import { prisma } from "@/server/db";
import { seedCmh139 } from "@/server/seed/cmh139";

/** pnpm db:seed — production seed: CMH139 configuration and reviewed candidates only. */
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
