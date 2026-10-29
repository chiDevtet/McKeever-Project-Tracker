import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getAuth } from "@/server/auth";
import { prisma } from "@/server/db";

/**
 * Test-only: create the browser-test administrator and viewer in the
 * disposable test database. Passwords come from the environment set by the
 * Playwright global setup; nothing here runs against a real database.
 */
async function main() {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("e2e-users only runs against TEST_DATABASE_URL");
  const ws = await prisma.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const project = await prisma.project.findFirstOrThrow({ where: { workspaceId: ws.id, code: "CMH139" } });
  const ctx = await getAuth().$context;
  const users = [
    { email: "e2e.admin@example.com", name: "E2E Administrator", password: process.env.E2E_ADMIN_PASSWORD!, role: "ADMINISTRATOR" as const, grant: null },
    { email: "e2e.viewer@example.com", name: "E2E Viewer", password: process.env.E2E_VIEWER_PASSWORD!, role: "MEMBER" as const, grant: "INTERNAL_VIEWER" as const },
    // Used only by the password-reset test; its initial password is never known.
    { email: "e2e.reset@example.com", name: "E2E Reset", password: randomUUID(), role: "MEMBER" as const, grant: "FOREMAN_VIEWER" as const },
  ];
  for (const u of users) {
    const id = randomUUID();
    await prisma.user.create({ data: { id, email: u.email, name: u.name, emailVerified: true } });
    await prisma.account.create({ data: { id: randomUUID(), userId: id, providerId: "credential", accountId: id, password: await ctx.password.hash(u.password) } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: id, role: u.role } });
    if (u.grant) await prisma.projectMembership.create({ data: { projectId: project.id, userId: id, role: u.grant } });
  }
  console.log("[e2e] users ready");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
