import { expect, test, type Page } from "@playwright/test";
import { ADMIN, openProject, signIn } from "./helpers";

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));

/**
 * Text contrast of visible text elements against their effective background.
 * Returns the elements below `min` (WCAG AA for normal text is 4.5:1).
 */
async function lowContrast(page: Page, min = 4.5) {
  return page.evaluate((min) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element | null): { r: number; g: number; b: number } => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0.5) return c;
      }
      return { r: 255, g: 255, b: 255 };
    };
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("h1, h2, h3, p, label, th, td, a, button, li, span, dt, dd, input, select, textarea")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
      if (!own) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || Number(cs.opacity) < 1 || el.closest("[aria-hidden=true], :disabled, [data-disabled]") || (el as HTMLInputElement).disabled) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const large = parseFloat(cs.fontSize) >= 18.66 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : min)) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || (el as HTMLInputElement).value || "").trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
    }
    return out;
  }, min);
}

test("first visit with no saved preference renders soft dark from the server, with no flash or hydration warnings", async ({ page, request }) => {
  const html = await (await request.get("/login")).text();
  expect(html).toMatch(/<html[^>]*class="dark"/);
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (/hydrat|did not match|didn't match/i.test(m.text())) warnings.push(m.text().slice(0, 200));
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  expect(await isDark(page)).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(36, 42, 49)");
  await signIn(page, ADMIN);
  expect(await isDark(page)).toBe(true);
  expect(warnings).toEqual([]);
});

test("an explicit Light or Dark choice persists across reloads, navigation, and new sessions", async ({ page, browser, request }) => {
  await signIn(page, ADMIN);
  await page.getByRole("group", { name: "Color theme" }).first().getByRole("button", { name: "Light" }).click();
  expect(await isDark(page)).toBe(false);
  await expect(page.getByRole("group", { name: "Color theme" }).first().getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  expect(await isDark(page)).toBe(false);
  await page.goto("/settings");
  expect(await isDark(page)).toBe(false);
  // The server renders the saved choice, so there is no dark flash for a light user.
  const cookies = await page.context().cookies();
  const pref = cookies.find((c) => c.name === "fieldops_theme");
  expect(pref?.value).toBe("light");
  expect(await (await request.get("/login", { headers: { cookie: "fieldops_theme=light" } })).text()).not.toMatch(/<html[^>]*class="dark"/);
  // A new session in the same browser profile keeps it (cookie and localStorage).
  const state = await page.context().storageState();
  const next = await browser.newContext({ storageState: state });
  const p2 = await next.newPage();
  await p2.goto("/login", { waitUntil: "domcontentloaded" });
  expect(await isDark(p2)).toBe(false);
  // If only localStorage survives, the boot script restores Light before paint.
  await next.clearCookies();
  await p2.goto("/login", { waitUntil: "domcontentloaded" });
  expect(await isDark(p2)).toBe(false);
  expect((await next.cookies()).find((c) => c.name === "fieldops_theme")?.value).toBe("light");
  await next.close();

  await page.getByRole("button", { name: "Dark" }).first().click();
  expect(await isDark(page)).toBe(true);
  await page.reload();
  expect(await isDark(page)).toBe(true);
});

for (const theme of ["dark", "light"] as const) {
  test(`key surfaces are readable in ${theme} mode`, async ({ page, context }) => {
    await context.addCookies([{ name: "fieldops_theme", value: theme, url: "http://localhost" + ":" + (process.env.E2E_PORT ?? "3210") }]);
    await signIn(page, ADMIN);
    expect(await isDark(page)).toBe(theme === "dark");
    const projectId = await openProject(page, "CMH139", "manpower");
    const problems: string[] = [];
    for (const p of ["/", "/settings", "/people", `/projects/${projectId}/manpower`, `/projects/${projectId}/schedule`, `/projects/${projectId}/setup`, `/projects/${projectId}/reports`]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      for (const f of await lowContrast(page)) problems.push(`${p}: ${f}`);
    }
    // A dialog and a toast use the themed popover surface.
    await page.goto(`/projects/${projectId}/plans`);
    await page.getByRole("button", { name: "Capture baseline" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    for (const f of await lowContrast(page)) problems.push(`dialog: ${f}`);
    expect(problems).toEqual([]);
  });
}
