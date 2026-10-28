import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

/**
 * Integration tests run against a real, disposable PostgreSQL database named
 * by TEST_DATABASE_URL. It is wiped and migrated before every run; the
 * development or production database is never touched.
 */
export default async function setup() {
  config({ quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests (a separate, disposable PostgreSQL database).");
  for (const other of [process.env.DATABASE_URL, process.env.DIRECT_DATABASE_URL]) {
    if (other && new URL(other).pathname === new URL(url).pathname && new URL(other).host === new URL(url).host) throw new Error("TEST_DATABASE_URL must name a different database than DATABASE_URL; integration tests erase it.");
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
  const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "pipe", env });
  await rm(path.resolve(".data/test-storage"), { recursive: true, force: true });
  // The production seed: workspace and CMH139 configuration.
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], { stdio: "pipe", env: { ...env, STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.resolve(".data/test-storage") } });
}
