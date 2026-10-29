import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { extractedScheduleSchema, type ExtractedSchedule } from "./extraction";

/*
 * Worker-only: runs the Python helpers in python/. The web server never
 * imports this module, so it neither needs Python nor bundles these paths.
 */

const MAX_OUTPUT = 80 * 1024 * 1024;

/**
 * Run a script from python/ in an isolated temp dir with a minimal environment
 * (no secrets or database access), a timeout, and an output size limit.
 * PROGRESS n/m lines on stderr are reported through onProgress.
 */
async function runPython(script: string, args: string[], cwd: string, opts: { timeoutMs: number; onProgress?: (done: number, total: number) => void; label: string }): Promise<string> {
  const file = path.resolve(process.cwd(), "python", script);
  return new Promise<string>((resolve, reject) => {
    const childEnv = { PATH: process.env.PATH ?? "", ...(process.env.FIELDOPS_PDF_PROCESSES ? { FIELDOPS_PDF_PROCESSES: process.env.FIELDOPS_PDF_PROCESSES } : {}) } as unknown as NodeJS.ProcessEnv;
    const child = spawn(process.env.PYTHON_BIN || "python3", ["-I", file, ...args], { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let size = 0;
    let errText = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${opts.label} timed out after ${Math.round(opts.timeoutMs / 1000)} s`));
    }, opts.timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > MAX_OUTPUT) {
        child.kill("SIGKILL");
        reject(new Error(`${opts.label} output exceeded the size limit`));
        return;
      }
      out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString();
      for (const m of s.matchAll(/PROGRESS (\d+)\/(\d+)/g)) opts.onProgress?.(Number(m[1]), Number(m[2]));
      errText = (errText + s).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the ${opts.label.toLowerCase()} (${e.message}). Install Python 3 with pdfplumber (see README).`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString("utf8");
      if (code !== 0) {
        let message = `${opts.label} exited with code ${code}`;
        try {
          message = (JSON.parse(text) as { error?: string }).error ?? message;
        } catch {
          if (errText.trim()) message += `: ${errText.trim().split("\n").filter((l) => !l.startsWith("PROGRESS")).slice(-3).join(" ")}`;
        }
        reject(new Error(message));
        return;
      }
      resolve(text);
    });
  });
}

/** Run python/extract_schedule.py on PDF bytes. */
export async function runPdfExtractor(bytes: Uint8Array, onProgress?: (done: number, total: number) => void, timeoutMs = 10 * 60_000): Promise<ExtractedSchedule> {
  const dir = await mkdtemp(path.join(tmpdir(), "fieldops-extract-"));
  try {
    await writeFile(path.join(dir, "source.pdf"), bytes, { mode: 0o600 });
    const stdout = await runPython("extract_schedule.py", ["source.pdf"], dir, { timeoutMs, onProgress, label: "PDF extractor" });
    return extractedScheduleSchema.parse(JSON.parse(stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Render every PDF page to a grayscale PNG for the import review preview. */
export async function renderPdfPages(bytes: Uint8Array, onPage: (page: number, png: Uint8Array) => Promise<void>, timeoutMs = 10 * 60_000): Promise<{ pages: number; scale: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "fieldops-render-"));
  try {
    await writeFile(path.join(dir, "source.pdf"), bytes, { mode: 0o600 });
    await mkdir(path.join(dir, "out"), { mode: 0o700 });
    const stdout = await runPython("render_pages.py", ["source.pdf", "out", String(PREVIEW_SCALE)], dir, { timeoutMs, label: "PDF page renderer" });
    const result = z.object({ pages: z.number().int().min(0).max(5000), scale: z.number() }).parse(JSON.parse(stdout));
    for (let n = 1; n <= result.pages; n++) await onPage(n, new Uint8Array(await readFile(path.join(dir, "out", `page-${n}.png`))));
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const PREVIEW_SCALE = 1.25;

