import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3210);

/**
 * Browser tests against a production build (`next start`) and the worker,
 * both started by e2e/global-setup.ts on a disposable database
 * (TEST_DATABASE_URL). Set E2E_SKIP_BUILD=1 to reuse an existing build.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results/e2e-report" }]],
  outputDir: "test-results/e2e-artifacts",
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 950 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
});
