import { expect, test } from "@playwright/test";
import { ADMIN, query, signIn } from "./helpers";

test("signed-out visitors are sent to sign-in, and a wrong password is refused", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("#email", ADMIN.email);
  await page.fill("#password", "not the right password");
  await page.click("button[type=submit]");
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  // Self sign-up is disabled: the auth API refuses a new account.
  const res = await page.request.post("/api/auth/sign-up/email", { data: { email: "intruder@example.com", password: "a long enough password", name: "x" } });
  expect(res.ok()).toBe(false);
});

test("an administrator signs in and reaches the division dashboard", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Division dashboard" })).toBeVisible();
  await expect(page.getByText("Live working plans only")).toBeVisible();
});

test("password reset works end to end through the mail transport", async ({ page }) => {
  await page.goto("/forgot-password");
  const email = "e2e.reset@example.com";
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await expect(page.getByText("Check your email")).toBeVisible();
  let link: string | undefined;
  for (let i = 0; i < 20 && !link; i++) {
    const rows = await query<{ text: string }>(`SELECT text FROM "MailOutbox" WHERE "toAddress" = $1 AND kind = 'password-reset' ORDER BY "createdAt" DESC LIMIT 1`, [email]);
    link = rows[0]?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) await page.waitForTimeout(250);
  }
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/reset-password/);
  const next = `reset-${Date.now()}-password`;
  await page.fill("#password", next);
  await page.fill("#confirm", next);
  await page.click("button[type=submit]");
  await expect(page.getByText(/password (has been|was) (reset|changed)|sign in/i).first()).toBeVisible();
  await signIn(page, { email, password: () => next });
});
