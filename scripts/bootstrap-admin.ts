import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "@/server/db";
import { bootstrapAdministrator } from "@/server/services/users";

/**
 * pnpm admin:bootstrap --email you@company.com --name "Your Name"
 *
 * Creates the first administrator invitation and prints a one-time link to
 * this terminal only. There is no default password; the administrator sets
 * one when opening the link. Refuses if an administrator already exists
 * unless --force is given (recovery).
 */
async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, workspace: { type: "string" }, force: { type: "boolean", default: false } } });
  if (!values.email || !values.name) {
    console.error('Usage: pnpm admin:bootstrap --email you@company.com --name "Your Name" [--workspace "McKeever & Niekamp Electric"] [--force]');
    process.exitCode = 2;
    return;
  }
  const result = await bootstrapAdministrator({ email: values.email, name: values.name, workspaceName: values.workspace, force: values.force });
  console.log("Administrator invitation created. Open this one-time link to set the password (expires", result.expiresAt.toISOString(), "):");
  console.log(result.link);
}

main()
  .catch((err) => {
    console.error(`[bootstrap] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
