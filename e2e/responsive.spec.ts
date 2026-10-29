import { expect, test } from "@playwright/test";
import { ADMIN, openProject, signIn } from "./helpers";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
];

for (const vp of VIEWPORTS) {
  test(`key pages have no horizontal page overflow on a ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn(page, ADMIN);
    const projectId = await openProject(page, "CMH139", "manpower");
    const paths = ["/", "/projects", "/people", "/settings", ...["manpower", "schedule", "progress", "imports", "reports", "plans", "setup"].map((s) => `/projects/${projectId}/${s}`)];
    const overflowing: string[] = [];
    for (const p of paths) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
      if (scroll > width + 1) overflowing.push(`${p} (${scroll}px > ${width}px)`);
      await page.screenshot({ path: `test-results/responsive/${vp.name}${p.replace(/\//g, "_") || "_home"}.png` });
    }
    expect(overflowing).toEqual([]);
  });
}
