import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrate, seed) uses the direct, non-pooled connection.
// The application runtime uses DATABASE_URL through @prisma/adapter-pg.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx scripts/seed.ts",
  },
  datasource: {
    url: url ?? "",
  },
});
