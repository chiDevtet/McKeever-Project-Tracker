import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { z } from "zod";
import { isISODate } from "@/domain/dates";

/**
 * Extraction boundary. The Python extractor and spreadsheet parser both
 * produce `ExtractedSchedule`, validated here before anything is stored.
 * Extracted text is data: it is never interpreted as instructions.
 */

const dateCell = z
  .object({ raw: z.string().max(80), date: z.string().refine(isISODate).nullable(), actual: z.boolean(), constraint: z.boolean() })
  .nullable();

export const extractedRowSchema = z.object({
  page: z.number().int().nullable(),
  kind: z.enum(["ACTIVITY", "MILESTONE", "WBS"]),
  level: z.number().int().min(0).max(50),
  externalId: z.string().max(80).nullable(),
  name: z.string().max(1000),
  od: z.string().max(40).nullable(),
  rd: z.string().max(40).nullable(),
  start: dateCell,
  finish: dateCell,
  wbsPath: z.array(z.string().max(400)).max(50),
  embeddedDates: z.array(z.string()).max(20),
  emphasized: z.boolean().optional(),
  sourceRow: z.number().int().optional(),
});
export type ExtractedRow = z.infer<typeof extractedRowSchema>;

export const extractedScheduleSchema = z.object({
  schema: z.literal(1),
  pageCount: z.number().int().min(0),
  meta: z.object({ title: z.string().max(400).optional(), runDate: z.string().max(60).optional(), dataDate: z.string().max(40).optional() }).passthrough(),
  pages: z.array(z.object({ number: z.number().int(), width: z.number(), height: z.number(), chars: z.number().int(), rows: z.number().int(), headerFound: z.boolean(), columns: z.record(z.string(), z.array(z.number())).optional() })).max(5000),
  rows: z.array(extractedRowSchema).max(100_000),
  issues: z.array(z.object({ page: z.number().int().nullable(), kind: z.string().max(40), message: z.string().max(1000), externalId: z.string().max(80).optional(), text: z.string().max(400).optional() })).max(20_000),
});
export type ExtractedSchedule = z.infer<typeof extractedScheduleSchema>;

const MAX_OUTPUT = 80 * 1024 * 1024;

/** Run python/extract_schedule.py on PDF bytes in an isolated temp dir with a timeout. */
export async function runPdfExtractor(bytes: Uint8Array, onProgress?: (done: number, total: number) => void, timeoutMs = 10 * 60_000): Promise<ExtractedSchedule> {
  const dir = await mkdtemp(path.join(tmpdir(), "fieldops-extract-"));
  const file = path.join(dir, "source.pdf");
  await writeFile(file, bytes, { mode: 0o600 });
  const script = path.resolve(process.cwd(), "python/extract_schedule.py");
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      // Minimal environment: the extractor needs no secrets or database access.
      const childEnv = { PATH: process.env.PATH ?? "", ...(process.env.FIELDOPS_PDF_PROCESSES ? { FIELDOPS_PDF_PROCESSES: process.env.FIELDOPS_PDF_PROCESSES } : {}) } as unknown as NodeJS.ProcessEnv;
      const child = spawn(process.env.PYTHON_BIN || "python3", ["-I", script, file], { cwd: dir, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let size = 0;
      let errText = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`PDF extraction timed out after ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      child.stdout.on("data", (b: Buffer) => {
        size += b.length;
        if (size > MAX_OUTPUT) {
          child.kill("SIGKILL");
          reject(new Error("Extractor output exceeded the size limit"));
          return;
        }
        out.push(b);
      });
      child.stderr.on("data", (b: Buffer) => {
        const s = b.toString();
        for (const m of s.matchAll(/PROGRESS (\d+)\/(\d+)/g)) onProgress?.(Number(m[1]), Number(m[2]));
        errText = (errText + s).slice(-4000);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`Could not start the PDF extractor (${e.message}). Install Python 3 with pdfplumber (see README).`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const text = Buffer.concat(out).toString("utf8");
        if (code !== 0) {
          let message = `PDF extractor exited with code ${code}`;
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
    return extractedScheduleSchema.parse(JSON.parse(stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Spreadsheets --------------------------------------------------------------------

export const columnMappingSchema = z.object({
  sheet: z.string().max(120).nullable().default(null),
  headerRow: z.number().int().min(1).max(200).default(1),
  dateFormat: z.enum(["auto", "ISO", "MDY", "DMY", "DMonYY"]).default("auto"),
  columns: z.object({
    externalId: z.number().int().min(1).nullable(),
    name: z.number().int().min(1),
    start: z.number().int().min(1).nullable(),
    finish: z.number().int().min(1).nullable(),
    originalDuration: z.number().int().min(1).nullable().default(null),
    remainingDuration: z.number().int().min(1).nullable().default(null),
    wbs: z.number().int().min(1).nullable().default(null),
  }),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas, quotes, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoFrom(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isISODate(s) ? s : null;
}

/** Parse a date cell; markers " A" (actual) and "*" (constraint) are kept as metadata. */
export function parseDateValue(value: unknown, format: ColumnMapping["dateFormat"]): z.infer<typeof dateCell> {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const raw = value.toISOString().slice(0, 10);
    return { raw, date: isISODate(raw) ? raw : null, actual: false, constraint: false };
  }
  let raw = String(value).trim();
  if (!raw) return null;
  const actual = /\sA$/.test(raw);
  const constraint = raw.includes("*");
  const core = raw.replace(/\sA$/, "").replace(/\*/g, "").trim();
  raw = raw.slice(0, 80);
  let date: string | null = null;
  let m: RegExpExecArray | null;
  if ((format === "auto" || format === "ISO") && (m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(core))) date = isoFrom(+m[1], +m[2], +m[3]);
  else if ((format === "auto" || format === "DMonYY") && (m = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2}|\d{4})$/.exec(core))) {
    const mo = MON.indexOf(m[2].toLowerCase()) + 1;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    date = mo ? isoFrom(y, mo, +m[1]) : null;
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(core))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    date = format === "DMY" ? isoFrom(y, +m[2], +m[1]) : isoFrom(y, +m[1], +m[2]);
  }
  return { raw, date, actual, constraint };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
    return "";
  }
  return String(v);
}

/** Rows of raw cell values from CSV or XLSX (dates in XLSX stay Date objects). */
export async function readSheet(bytes: Uint8Array, format: "CSV" | "XLSX", sheet: string | null): Promise<{ sheets: string[]; rows: unknown[][] }> {
  if (format === "CSV") return { sheets: ["CSV"], rows: parseCsv(new TextDecoder("utf-8").decode(bytes)) };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  const sheets = wb.worksheets.map((w) => w.name);
  const ws = (sheet ? wb.getWorksheet(sheet) : undefined) ?? wb.worksheets[0];
  const rows: unknown[][] = [];
  ws?.eachRow({ includeEmpty: false }, (row) => {
    const vals: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value;
      vals[col - 1] = v instanceof Date ? v : typeof v === "object" && v !== null && "result" in v && (v as { result: unknown }).result instanceof Date ? (v as { result: Date }).result : typeof v === "number" ? v : cellText(v);
    });
    rows.push(vals);
  });
  return { sheets, rows };
}

/** Apply a column mapping to sheet rows, producing extraction rows. */
export function mapSheetRows(rows: unknown[][], mapping: ColumnMapping): ExtractedSchedule {
  const out: ExtractedSchedule = { schema: 1, pageCount: 0, meta: {}, pages: [], rows: [], issues: [] };
  const c = mapping.columns;
  const at = (r: unknown[], col: number | null) => (col ? r[col - 1] : null);
  rows.slice(mapping.headerRow).forEach((r, i) => {
    const sourceRow = mapping.headerRow + i + 1;
    const name = cellText(at(r, c.name)).trim();
    const id = cellText(at(r, c.externalId)).trim() || null;
    if (!name && !id) return;
    const start = parseDateValue(at(r, c.start), mapping.dateFormat);
    const finish = parseDateValue(at(r, c.finish), mapping.dateFormat);
    const od = cellText(at(r, c.originalDuration)).trim() || null;
    const rd = cellText(at(r, c.remainingDuration)).trim() || null;
    const wbs = cellText(at(r, c.wbs)).trim();
    for (const [k, v] of [["start", start], ["finish", finish]] as const) {
      if (v && !v.date) out.issues.push({ page: null, kind: "bad-date", externalId: id ?? undefined, message: `Row ${sourceRow}${id ? ` ${id}` : ""}: ${k} value "${v.raw}" is not a recognized date` });
    }
    const kind = od !== null && Number(od) === 0 ? "MILESTONE" : "ACTIVITY";
    out.rows.push({ page: null, sourceRow, kind, level: 0, externalId: id, name: name.slice(0, 1000), od, rd, start, finish, wbsPath: wbs ? wbs.split(/\s*[>/|]\s*/).filter(Boolean).slice(0, 50) : [], embeddedDates: [] });
  });
  if (!out.rows.length) out.issues.push({ page: null, kind: "empty", message: "No rows were found with the selected header row and columns. Check the mapping." });
  return out;
}
