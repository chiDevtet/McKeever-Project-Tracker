import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { resetTestDatabase } from "../tests/helpers/test-db";

async function waitFor(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function start(cmd: string, args: string[], env: NodeJS.ProcessEnv, log: string): ChildProcess {
  const out = openSync(log, "w");
  return spawn(cmd, args, { env, stdio: ["ignore", out, out], detached: true });
}

/** Reset the test database, create test users, then start the web server and worker in that order. */
export default async function globalSetup() {
  config({ quiet: true });
  const port = Number(process.env.E2E_PORT ?? 3210);
  const storage = path.resolve(".data/e2e-storage");
  const url = await resetTestDatabase(storage);
  process.env.E2E_ADMIN_PASSWORD = randomBytes(18).toString("base64url");
  process.env.E2E_VIEWER_PASSWORD = randomBytes(18).toString("base64url");
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url, APP_URL: `http://localhost:${port}`, APP_ENV: "test", STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: storage, MAIL_TRANSPORT: "outbox", WORKER_HEALTH_PORT: String(port + 1) };
  execFileSync("pnpm", ["exec", "tsx", "scripts/e2e-users.ts"], { env, stdio: "pipe" });
  if (!process.env.E2E_SKIP_BUILD) execFileSync("pnpm", ["build"], { stdio: "inherit" });
  mkdirSync("test-results", { recursive: true });
  const web = start("pnpm", ["exec", "next", "start", "-p", String(port)], env, "test-results/e2e-web.log");
  const worker = start("pnpm", ["exec", "tsx", "src/worker/index.ts"], env, "test-results/e2e-worker.log");
  const stop = () => {
    for (const p of [web, worker]) {
      try {
        if (p.pid) process.kill(-p.pid, "SIGTERM");
      } catch {
        // already exited
      }
    }
  };
  try {
    await waitFor(`http://localhost:${port}/login`, 120_000);
    await waitFor(`http://localhost:${port + 1}/healthz`, 60_000);
  } catch (err) {
    stop();
    throw err;
  }
  return stop;
}
