import { chromium, type Browser } from "playwright";

/**
 * Chromium rendering for trusted report templates only. JavaScript is
 * disabled and every network request is aborted, so the renderer never
 * browses a URL; it prints the HTML string it was given.
 */
let browserPromise: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--disable-dev-shm-usage"] });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

async function withPage<T>(fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
  const b = await browser();
  const context = await b.newContext({ javaScriptEnabled: false, offline: true });
  await context.route("**/*", (route) => route.abort());
  try {
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close();
  }
}

export async function renderPdf(html: string, orientation: "portrait" | "landscape"): Promise<Uint8Array> {
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "Letter", landscape: orientation === "landscape", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return new Uint8Array(pdf);
  });
}

/** PNG of an SVG chart (for embedding in Excel). */
export async function renderSvgPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  return withPage(async (page) => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,sans-serif">${svg}</body></html>`, { waitUntil: "load" });
    const el = await page.$("svg");
    const png = await (el ?? page).screenshot({ type: "png" });
    return new Uint8Array(png);
  });
}
