import ExcelJS from "exceljs";
import type { ISODate } from "@/domain/dates";
import type { ReportDataset } from "@/domain/report";
import { DETAIL_LEVELS, PRESENTATIONS } from "@/domain/report";

/**
 * .xlsx workbook from the same report dataset as the PDF. Dates are typed
 * Excel dates, counts and hours are numbers, and user text is written as text
 * (never formulas; text cells use the "@" format so edits stay text).
 */

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EAEC" } };
const DATE_FMT = "dd mmm yyyy";

function xlDate(d: ISODate | null): Date | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** Plain text cell value; formulas are never produced from user text. */
function text(v: string | null | undefined): string {
  return v ?? "";
}

type Col = { header: string; key: string; width: number; type: "text" | "date" | "int" | "dec" };

function table(ws: ExcelJS.Worksheet, cols: Col[], rows: Record<string, string | number | Date | null>[], startRow = 1) {
  const header = ws.getRow(startRow);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin", color: { argb: "FF9EA3AA" } } };
    cell.alignment = { vertical: "bottom", wrapText: true };
    ws.getColumn(i + 1).width = c.width;
  });
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = r[c.key];
      cell.value = v === undefined ? null : v;
      if (c.type === "date") cell.numFmt = DATE_FMT;
      else if (c.type === "int") cell.numFmt = "0";
      else if (c.type === "dec") cell.numFmt = "0.0#";
      else if (c.type === "text") {
        cell.numFmt = "@";
        cell.alignment = { wrapText: true, vertical: "top" };
      }
    });
  });
  ws.views = [{ state: "frozen", ySplit: startRow, xSplit: 1 }];
}

export async function buildWorkbook(ds: ReportDataset, chartPng?: Uint8Array): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const id = ds.identity;
  wb.creator = `${id.company} — M&N FieldOps`;
  wb.created = new Date(id.generatedAt);
  wb.title = `${id.projectCode} ${id.title}`;

  // Summary
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF2A78D6" } } });
  sum.getColumn(1).width = 30;
  sum.getColumn(2).width = 70;
  const info: [string, string | number | Date | null][] = [
    ["Company", id.company],
    ["Report", id.title],
    ["Project", `${id.projectCode} · ${id.projectName}`],
    ["Customer", id.customer],
    ["General contractor", id.generalContractor],
    ["Owner", id.owner],
    ["Prepared by", id.preparedBy],
    ["Generated", new Date(id.generatedAt)],
    ["Reporting period start", xlDate(id.period.from)],
    ["Reporting period end", xlDate(id.period.to)],
    ["Plan", id.planLabel],
    ["Snapshot", id.snapshotId ?? "Preview (not frozen)"],
    ["Detail", DETAIL_LEVELS[ds.settings.detail]],
    ["Presentation", PRESENTATIONS[ds.settings.presentation]],
    ["Scope", ds.filterDescription],
    ["Exploratory scenario", id.exploratory ? "Yes — not a formal submission" : "No"],
    ["Peak concurrent onsite", ds.allocationEmpty ? null : ds.totals.peakTotal],
    ["Peak installers", ds.allocationEmpty ? null : ds.totals.peakInstallers],
    ["Peak leadership", ds.totals.peakLeadership],
    ["Installer hours", ds.allocationEmpty ? null : ds.totals.installerHours],
    ["Leadership hours", ds.totals.leadershipHours],
    ["Total onsite hours", ds.allocationEmpty ? null : ds.totals.totalHours],
  ];
  sum.getCell("A1").value = `${id.company} — ${id.title}`;
  sum.getCell("A1").font = { bold: true, size: 14 };
  info.forEach(([k, v], i) => {
    const r = sum.getRow(3 + i);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true };
    const c = r.getCell(2);
    c.value = typeof v === "string" ? text(v) : v;
    if (v instanceof Date) c.numFmt = k === "Generated" ? "dd mmm yyyy hh:mm" : DATE_FMT;
    else if (typeof v === "number") c.numFmt = Number.isInteger(v) ? "0" : "0.0#";
    else c.numFmt = "@";
  });
  let next = 4 + info.length;
  if (ds.allocationNote) {
    sum.getCell(`A${next}`).value = "Allocation view";
    sum.getCell(`B${next}`).value = ds.allocationNote;
    sum.getCell(`B${next}`).alignment = { wrapText: true };
    next += 2;
  }
  if (ds.allocationEmpty) {
    sum.getCell(`A${next}`).value = "Not allocated";
    sum.getCell(`B${next}`).value = `No installer labor is allocated to ${ds.filterDescription}. Blank values mean not allocated, not zero demand.`;
    next += 2;
  }
  if (chartPng) {
    const img = wb.addImage({ buffer: Buffer.from(chartPng) as unknown as ExcelJS.Buffer, extension: "png" });
    sum.addImage(img, { tl: { col: 0, row: next }, ext: { width: 960, height: 260 } });
  }

  // Weekly data
  const wk = wb.addWorksheet("Weekly data");
  table(
    wk,
    [
      { header: "Week of (Mon)", key: "week", width: 14, type: "date" },
      { header: "Week end (Sun)", key: "end", width: 14, type: "date" },
      { header: "Open days", key: "openDays", width: 9, type: "int" },
      { header: "Calendar hours", key: "calendarHours", width: 10, type: "dec" },
      { header: "Installers peak", key: "installerPeak", width: 10, type: "int" },
      { header: "Leadership peak", key: "leadershipPeak", width: 10, type: "int" },
      { header: "Total onsite peak", key: "totalPeak", width: 10, type: "int" },
      { header: "Installers at total peak", key: "installersAtPeak", width: 12, type: "int" },
      { header: "Leadership at total peak", key: "leadershipAtPeak", width: 12, type: "int" },
      { header: "Installer hours", key: "installerHours", width: 10, type: "dec" },
      { header: "Leadership hours", key: "leadershipHours", width: 10, type: "dec" },
      { header: "Total onsite hours", key: "totalHours", width: 10, type: "dec" },
      { header: "Avg equivalent staffing", key: "avg", width: 12, type: "dec" },
      { header: "Avg note", key: "avgNote", width: 18, type: "text" },
    ],
    ds.weeks.map((w) => ({
      week: xlDate(w.week),
      end: xlDate(w.end),
      openDays: w.openDays,
      calendarHours: w.calendarHours,
      installerPeak: ds.allocationEmpty ? null : w.installerPeak,
      leadershipPeak: w.leadershipPeak,
      totalPeak: ds.allocationEmpty ? null : w.totalPeak,
      installersAtPeak: ds.allocationEmpty ? null : w.installersAtPeak,
      leadershipAtPeak: w.leadershipAtPeak,
      installerHours: ds.allocationEmpty ? null : w.installerHours,
      leadershipHours: w.leadershipHours,
      totalHours: ds.allocationEmpty ? null : w.totalHours,
      avg: w.averageEquivalent,
      avgNote: w.averageEquivalent === null ? "n/a: no open calendar hours" : "",
    })),
  );

  // Phases
  const codes = [...new Set(ds.phases.flatMap((p) => p.milestones.map((m) => m.code)))];
  table(
    wb.addWorksheet("Phases"),
    [
      { header: "Phase", key: "name", width: 14, type: "text" },
      { header: "Areas", key: "areas", width: 22, type: "text" },
      { header: "Window start", key: "ws", width: 13, type: "date" },
      { header: "Window finish", key: "wf", width: 13, type: "date" },
      { header: "Scheduled start", key: "ss", width: 13, type: "date" },
      { header: "Scheduled finish", key: "sf", width: 13, type: "date" },
      ...codes.map((c) => ({ header: `${c} date`, key: `m_${c}`, width: 12, type: "date" as const })),
      ...codes.map((c) => ({ header: `${c} status`, key: `s_${c}`, width: 12, type: "text" as const })),
      { header: "Allocated peak", key: "peak", width: 10, type: "int" },
      { header: "Allocated hours", key: "hours", width: 10, type: "dec" },
      { header: "Allocation", key: "alloc", width: 16, type: "text" },
    ],
    ds.phases.map((p) => ({
      name: p.name,
      areas: p.areas.join(", "),
      ws: xlDate(p.window.start),
      wf: xlDate(p.window.finish),
      ss: xlDate(p.scheduled.start),
      sf: xlDate(p.scheduled.finish),
      ...Object.fromEntries(codes.map((c) => [`m_${c}`, xlDate(p.milestones.find((m) => m.code === c)?.date ?? null)])),
      ...Object.fromEntries(codes.map((c) => { const m = p.milestones.find((x) => x.code === c); return [`s_${c}`, !m ? "" : !m.date ? "unspecified" : m.confirmed ? "confirmed" : "candidate"]; })),
      peak: p.labor?.peak ?? null,
      hours: p.labor?.hours ?? null,
      alloc: p.labor ? "Allocated" : "Not allocated",
    })),
  );

  table(
    wb.addWorksheet("Areas"),
    [
      { header: "Area", key: "name", width: 26, type: "text" },
      { header: "Type", key: "kind", width: 12, type: "text" },
      { header: "Depth", key: "depth", width: 7, type: "int" },
      { header: "Phases", key: "phases", width: 24, type: "text" },
      { header: "Allocated peak", key: "peak", width: 10, type: "int" },
      { header: "Allocated hours", key: "hours", width: 10, type: "dec" },
      { header: "Allocation", key: "alloc", width: 16, type: "text" },
    ],
    ds.areas.map((a) => ({ name: a.name, kind: a.kind, depth: a.depth, phases: a.phases.join(", ") || "Outside every phase", peak: a.labor?.peak ?? null, hours: a.labor?.hours ?? null, alloc: a.labor ? "Allocated" : "Not allocated" })),
  );

  table(
    wb.addWorksheet("Activities"),
    [
      { header: "ID", key: "code", width: 10, type: "text" },
      { header: "Activity", key: "name", width: 44, type: "text" },
      { header: "Phase", key: "phase", width: 12, type: "text" },
      { header: "Area", key: "area", width: 14, type: "text" },
      { header: "System", key: "system", width: 18, type: "text" },
      { header: "Planned start", key: "start", width: 13, type: "date" },
      { header: "Planned finish", key: "finish", width: 13, type: "date" },
      { header: "Working days", key: "days", width: 9, type: "int" },
      { header: "Status", key: "status", width: 12, type: "text" },
      { header: "Reported %", key: "percent", width: 9, type: "dec" },
      { header: "Actual start", key: "as", width: 13, type: "date" },
      { header: "Actual finish", key: "af", width: 13, type: "date" },
      { header: "Allocated peak", key: "peak", width: 10, type: "int" },
      { header: "Allocated hours", key: "hours", width: 10, type: "dec" },
      { header: "Allocation", key: "alloc", width: 14, type: "text" },
      { header: "Source IDs", key: "source", width: 16, type: "text" },
      { header: "Cost code", key: "costCode", width: 12, type: "text" },
      { header: "Notes", key: "notes", width: 30, type: "text" },
    ],
    ds.activities.map((a) => ({ code: a.code, name: a.name, phase: a.phase ?? "", area: a.area ?? "", system: a.system, start: xlDate(a.start), finish: xlDate(a.finish), days: a.workingDays, status: a.status, percent: a.percent, as: xlDate(a.actualStart), af: xlDate(a.actualFinish), peak: a.labor?.peak ?? null, hours: a.labor?.hours ?? null, alloc: a.labor ? "Allocated" : "Not allocated", source: a.source ?? "", costCode: a.costCode ?? "", notes: a.notes ?? "" })),
  );

  table(
    wb.addWorksheet("Leadership"),
    [
      { header: "Name", key: "name", width: 20, type: "text" },
      { header: "Role", key: "role", width: 16, type: "text" },
      { header: "Responsibility", key: "resp", width: 40, type: "text" },
      { header: "Assignment dates", key: "dates", width: 26, type: "text" },
      { header: "Onsite schedule", key: "onsite", width: 36, type: "text" },
      { header: "Onsite hours in period", key: "hours", width: 12, type: "dec" },
      { header: "Offsite", key: "offsite", width: 30, type: "text" },
    ],
    ds.leadership.map((l) => ({ name: l.name, role: l.role, resp: l.responsibility, dates: l.dates, onsite: l.onsite, hours: l.onsiteHours, offsite: l.offsite })),
  );

  table(
    wb.addWorksheet("Milestones"),
    [
      { header: "Phase", key: "phase", width: 12, type: "text" },
      { header: "Code", key: "code", width: 8, type: "text" },
      { header: "Name", key: "name", width: 24, type: "text" },
      { header: "Date", key: "date", width: 13, type: "date" },
      { header: "Status", key: "status", width: 22, type: "text" },
      { header: "Source candidates", key: "sources", width: 60, type: "text" },
    ],
    ds.milestones.map((m) => ({ phase: m.phase, code: m.code, name: m.name, date: xlDate(m.date), status: m.status, sources: m.sources })),
  );

  table(
    wb.addWorksheet("Planning items"),
    [
      { header: "Severity", key: "sev", width: 10, type: "text" },
      { header: "Category", key: "cat", width: 22, type: "text" },
      { header: "Item", key: "msg", width: 100, type: "text" },
    ],
    ds.issues.map((i) => ({ sev: i.severity, cat: i.category, msg: i.message })),
  );

  const basis = wb.addWorksheet("Report basis");
  basis.getColumn(1).width = 34;
  basis.getColumn(2).width = 110;
  const basisRows: [string, string][] = [
    ...ds.basis.map((b) => [b.label, b.value] as [string, string]),
    ["Plan", id.planLabel],
    ["Snapshot", id.snapshotId ?? "Preview (not frozen)"],
    ["Sources", id.sources.map((s) => `${s.label}: ${s.detail}`).join(" | ") || "None"],
    ["Scope", ds.filterDescription],
    ["Assumptions", ds.settings.assumptions],
    ["Exclusions", ds.settings.exclusions],
    ["Dates to confirm", ds.settings.datesToConfirm],
    ["Generated", id.generatedAt],
    ["Prepared by", id.preparedBy],
  ];
  basisRows.forEach(([k, v], i) => {
    const r = basis.getRow(i + 1);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true };
    r.getCell(2).value = text(v);
    r.getCell(2).numFmt = "@";
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
