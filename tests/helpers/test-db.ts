import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/**
 * Wipe and migrate the disposable test database named by TEST_DATABASE_URL,
 * clear test file storage, and apply the production seed. Refuses to run
 * against the database in DATABASE_URL.
 */
export async function resetTestDatabase(storageDir: string): Promise<string> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required (a separate, disposable PostgreSQL database).");
  for (const other of [process.env.DATABASE_URL, process.env.DIRECT_DATABASE_URL]) {
    if (other && new URL(other).pathname === new URL(url).pathname && new URL(other).host === new URL(url).host) throw new Error("TEST_DATABASE_URL must name a different database than DATABASE_URL; tests erase it.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url, STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.resolve(storageDir) };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "pipe", env });
  await rm(path.resolve(storageDir), { recursive: true, force: true });
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], { stdio: "pipe", env });
  return url;
}
