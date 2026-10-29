import { expect, type Page } from "@playwright/test";
import pg from "pg";

export const ADMIN = { email: "e2e.admin@example.com", password: () => process.env.E2E_ADMIN_PASSWORD! };
export const VIEWER = { email: "e2e.viewer@example.com", password: () => process.env.E2E_VIEWER_PASSWORD! };

export async function signIn(page: Page, who: { email: string; password: () => string }) {
  await page.goto("/login");
  await page.fill("#email", who.email);
  await page.fill("#password", who.password());
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/$/);
}

export async function openProject(page: Page, code: string, section: string) {
  await page.goto("/projects");
  await page.getByRole("link", { name: new RegExp(code) }).first().click();
  await expect(page).toHaveURL(/\/manpower/);
  if (section !== "manpower") await page.goto(page.url().replace(/\/manpower.*/, `/${section}`));
  return page.url().split("/projects/")[1].split("/")[0];
}

/** Query the disposable test database directly (for example to read the mail outbox). */
export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}
