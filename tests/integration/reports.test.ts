import ExcelJS from "exceljs";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReportDataset, DETAIL_LEVELS, PRESENTATIONS, reportSettingsSchema, type ReportDataset } from "@/domain/report";
import type { Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { readFileForViewer } from "@/server/services/files";
import { applyPlanOps, getPlanView } from "@/server/services/plans";
import { generateReport, listReports, recordSubmission, savePreset, submissionChecks } from "@/server/services/reports";
import { saveArea, savePhase } from "@/server/services/structure";
import { revokeProjectAccess } from "@/server/services/users";
import { closeBrowser } from "@/reporting/pdf";
import { reportHtml } from "@/reporting/html";
import { renderReports } from "@/worker/handlers/report-render";
import { makeProject, makeUser, noProgress, refreshViewer } from "./helpers";

const WEEK = "2027-06-07";

async function generate(viewer: Viewer, projectId: string, planId: string, settings: Record<string, unknown>) {
  const res = await generateReport(viewer, { projectId, source: { kind: "plan", planId }, settings: reportSettingsSchema.parse(settings) });
  await renderReports({ snapshotId: res.snapshotId, reportIds: res.reportIds }, noProgress);
  const reports = await prisma.generatedReport.findMany({ where: { id: { in: res.reportIds } } });
  return { ...res, reports };
}

async function workbook(viewer: Viewer, fileId: string) {
  const { bytes } = await readFileForViewer(viewer, fileId);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

function sheetRows(ws: ExcelJS.Worksheet, firstHeader: string) {
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (!headerRow && row.getCell(1).value === firstHeader) headerRow = n;
  });
  const headers = (ws.getRow(headerRow).values as unknown[]).slice(1).map(String);
  const rows: Record<string, unknown>[] = [];
  for (let n = headerRow + 1; n <= ws.rowCount; n++) {
    const values = (ws.getRow(n).values as unknown[]).slice(1);
    if (values.every((v) => v === null || v === undefined || v === "")) continue;
    rows.push(Object.fromEntries(headers.map((h, i) => [h, values[i]])));
  }
  return rows;
}

describe("exports and frozen submissions (A01, A03, A19, A20, A21)", () => {
  let admin: Viewer;
  let projectId: string;
  let planId: string;
  let faId: string;

  beforeAll(async () => {
    admin = await makeUser({ admin: true, name: "Report Admin" });
    projectId = (await makeProject(admin)).id;
    admin = await refreshViewer(admin);
    const view = await getPlanView(admin, projectId);
    planId = view.data.plan.id;
    faId = view.data.systems.find((s) => s.name === "Fire alarm")!.id;
    const romp = await saveArea(admin, { projectId, kind: "ROMP", name: "ROMP 1" });
    const phase = await savePhase(admin, { projectId, name: "Phase 1", areaIds: [romp.id] });
    const pool = view.data.nodes.find((n) => n.kind === "POOL")!.key;
    // A03: eight installers, one PM, one foreman, five eight-hour days; no phase allocations (A01).
    await applyPlanOps(admin, {
      planId,
      expectedRevision: view.data.plan.revision,
      ops: [
        { type: "setPhaseWindow", phaseId: phase.id, start: WEEK, finish: "2027-06-11", note: null },
        { type: "addActivity", activity: { key: "rough", code: "", name: "Rough-in", phaseId: phase.id, areaId: romp.id, systemId: faId, calendarKey: null, plannedStart: WEEK, plannedFinish: "2027-06-11", notes: "Coordinate with ACE", sortOrder: 0, archived: false } },
        { type: "setWeeks", nodeKey: pool, values: [{ week: WEEK, headcount: 8 }] },
        ...(["Project manager", "Main foreman"] as const).map((role, i) => ({
          type: "upsertLeadership" as const,
          assignment: { key: `lead-${i}`, personId: null, personName: role === "Project manager" ? "Test PM" : "Test foreman", role, responsibilitySystemIds: [], responsibilityPhaseIds: [], responsibilityNote: null, startDate: WEEK, endDate: "2027-06-11", onsiteMode: "PROJECT_CALENDAR" as const, onsiteWeekdays: [], onsiteHours: null, onsiteStart: null, offsiteHoursPerWeek: role === "Project manager" ? 12 : null, dayOverrides: [], notes: null, sortOrder: i },
        })),
      ],
    });
  });

  afterAll(async () => {
    await closeBrowser();
  });

  it("PDF and Excel come from one snapshot and agree with the application dataset", { timeout: 120_000 }, async () => {
    const out = await generate(admin, projectId, planId, { title: "Phase overview", detail: "PHASE_OVERVIEW", presentation: "COMBINED", formats: ["PDF", "XLSX"] });
    expect(out.reports.map((r) => r.status)).toEqual(["READY", "READY"]);
    // Same snapshot and the same dataset hash for both formats.
    expect(new Set(out.reports.map((r) => r.snapshotId)).size).toBe(1);
    expect(new Set(out.reports.map((r) => r.datasetHash)).size).toBe(1);

    const pdf = out.reports.find((r) => r.format === "PDF")!;
    const { bytes } = await readFileForViewer(admin, pdf.fileId!);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const xlsx = out.reports.find((r) => r.format === "XLSX")!;
    const wb = await workbook(admin, xlsx.fileId!);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(["Summary", "Weekly data", "Phases", "Leadership", "Report basis"]));
    const week = sheetRows(wb.getWorksheet("Weekly data")!, "Week of (Mon)").find((r) => r["Week of (Mon)"] instanceof Date && (r["Week of (Mon)"] as Date).toISOString().startsWith(WEEK))!;
    // A03 numbers, stored as numbers and dates rather than text.
    expect(week).toMatchObject({ "Installers peak": 8, "Leadership peak": 2, "Total onsite peak": 10, "Installer hours": 320, "Leadership hours": 80, "Total onsite hours": 400 });
    expect(week["Week of (Mon)"]).toBeInstanceOf(Date);

    const snap = await prisma.planSnapshot.findUniqueOrThrow({ where: { id: out.snapshotId } });
    const ds: ReportDataset = buildReportDataset((snap.data as unknown as { plan: Parameters<typeof buildReportDataset>[0] }).plan, reportSettingsSchema.parse({ title: "Phase overview" }), { companyName: "x", preparedBy: "Test", generatedAt: new Date().toISOString(), snapshotId: snap.id, snapshotName: null, sources: [] });
    expect(ds.totals).toMatchObject({ peakTotal: 10, installerHours: 320, leadershipHours: 80, totalHours: 400 });
    // A01: phase dates appear; phase manpower is not invented when nothing is allocated to the phase.
    const phase = ds.phases.find((p) => p.name === "Phase 1")!;
    expect(phase.window).toEqual({ start: WEEK, finish: "2027-06-11" });
    expect(phase.labor).toBeNull();
    const phases = sheetRows(wb.getWorksheet("Phases")!, "Phase");
    expect(String(phases[0]["Phase"])).toBe("Phase 1");
    // Leadership roster with offsite hours kept separate from onsite headcount (A10).
    const lead = sheetRows(wb.getWorksheet("Leadership")!, "Name");
    expect(lead.map((r) => r["Role"]).sort()).toEqual(["Main foreman", "Project manager"]);
  });

  it("a system with no allocated labor reports not allocated rather than zero demand (A20)", async () => {
    const snapView = (await getPlanView(admin, projectId)).data;
    const ds = buildReportDataset(snapView, reportSettingsSchema.parse({ filters: { systemIds: [faId] } }), { companyName: "x", preparedBy: "Test", generatedAt: new Date().toISOString(), snapshotId: "preview", snapshotName: null, sources: [] });
    expect(ds.isAllocationView).toBe(true);
    expect(ds.allocationEmpty).toBe(true);
    expect(ds.allocationNote).toMatch(/not allocated/i);
  });

  it("an issued submission and its files stay frozen while the plan, calendar, and preset change (A21)", { timeout: 120_000 }, async () => {
    // An open planning item (leadership dates not selected) that a submission must acknowledge.
    const v0 = (await getPlanView(admin, projectId)).data;
    await applyPlanOps(admin, { planId, expectedRevision: v0.plan.revision, ops: [{ type: "upsertLeadership", assignment: { ...v0.leadership[0], key: "lead-undated", personName: "Second foreman", role: "Foreman", startDate: null, endDate: null } }] });
    const preset = await savePreset(admin, { projectId, scope: "project", name: "ACE weekly", settings: reportSettingsSchema.parse({ title: "ACE weekly" }) });
    const first = await generate(admin, projectId, planId, { title: "ACE weekly", formats: ["PDF", "XLSX"] });
    const checks = await submissionChecks(admin, { projectId, snapshotId: first.snapshotId });
    expect(checks.issues.map((i) => i.category)).toContain("leadership-dates");
    await expect(recordSubmission(admin, { projectId, snapshotId: first.snapshotId, reportIds: first.reportIds, issueDate: "2026-10-28", recipientLabel: "ACE Electric" })).rejects.toThrow(/Acknowledge every open planning item/);
    const sub1 = await recordSubmission(admin, { projectId, snapshotId: first.snapshotId, reportIds: first.reportIds, issueDate: "2026-10-28", recipientLabel: "ACE Electric", acknowledgedIssueIds: checks.issues.map((i: { id: string }) => i.id) });
    expect(sub1.sequence).toBe(1);
    const snapBefore = await prisma.planSnapshot.findUniqueOrThrow({ where: { id: first.snapshotId } });
    const filesBefore = await Promise.all(first.reports.map((r) => readFileForViewer(admin, r.fileId!)));

    // Edit the working schedule, the calendar, and the preset.
    const view = (await getPlanView(admin, projectId)).data;
    const cal = view.calendars[0];
    await applyPlanOps(admin, {
      planId,
      expectedRevision: view.plan.revision,
      ops: [
        { type: "setActivityDates", key: "rough", start: "2027-06-14", finish: "2027-06-18" },
        { type: "setCalendar", calendar: { ...cal, definition: { ...cal.definition, exceptions: [...cal.definition.exceptions, { id: "test-closure", date: "2027-06-09", kind: "closed" as const, hours: null, start: null, label: "Test closure" }] } } },
      ],
    });
    await savePreset(admin, { projectId, scope: "project", id: preset.id, name: "ACE weekly (edited)", settings: reportSettingsSchema.parse({ title: "Changed" }) });

    const snapAfter = await prisma.planSnapshot.findUniqueOrThrow({ where: { id: first.snapshotId } });
    expect(snapAfter.dataHash).toBe(snapBefore.dataHash);
    expect(JSON.stringify(snapAfter.data)).toBe(JSON.stringify(snapBefore.data));
    const filesAfter = await Promise.all(first.reports.map((r) => readFileForViewer(admin, r.fileId!)));
    expect(filesAfter.map((f) => Buffer.from(f.bytes).equals(Buffer.from(filesBefore[filesAfter.indexOf(f)].bytes)))).toEqual([true, true]);

    // The database itself refuses to alter issued records.
    await expect(prisma.$executeRawUnsafe(`UPDATE "PlanSnapshot" SET "dataHash" = 'tampered' WHERE id = '${first.snapshotId}'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "Submission" SET "recipientLabel" = 'Someone else' WHERE id = '${sub1.id}'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "StoredFile" SET "sha256" = 'x' WHERE id = '${first.reports[0].fileId}'`)).rejects.toThrow();

    const second = await generate(admin, projectId, planId, { title: "ACE weekly", formats: ["PDF"] });
    const checks2 = await submissionChecks(admin, { projectId, snapshotId: second.snapshotId });
    const sub2 = await recordSubmission(admin, { projectId, snapshotId: second.snapshotId, reportIds: second.reportIds, issueDate: "2026-10-29", recipientLabel: "ACE Electric", acknowledgedIssueIds: checks2.issues.map((i: { id: string }) => i.id) });
    expect(sub2.sequence).toBe(2);
    const subs = await prisma.submission.findMany({ where: { projectId }, orderBy: { sequence: "asc" } });
    expect(subs[0].snapshotId).not.toBe(subs[1].snapshotId);
    expect(subs[1].createdAt.getTime()).toBeGreaterThan(subs[0].createdAt.getTime());
    // Revision recorded with each submission's snapshot.
    const snaps = await prisma.planSnapshot.findMany({ where: { id: { in: subs.map((s) => s.snapshotId) } } });
    expect(new Set(snaps.map((s) => s.planRevision)).size).toBe(2);
  });

  it("a scenario export cannot be recorded as a formal submission", { timeout: 120_000 }, async () => {
    const { createScenario } = await import("@/server/services/history");
    const sc = await createScenario(admin, { projectId, name: "What-if" });
    const out = await generate(admin, projectId, sc.id, { title: "What-if", formats: ["PDF"] });
    expect(out.reports[0].exploratory).toBe(true);
    await expect(recordSubmission(admin, { projectId, snapshotId: out.snapshotId, reportIds: out.reportIds, issueDate: "2026-10-29", recipientLabel: "ACE" })).rejects.toThrow(/exploratory scenario/);
  });

  it("revoking access also blocks report files and exports (A22)", async () => {
    const viewer = await makeUser({ grants: [[projectId, "INTERNAL_VIEWER"]] });
    const list = await listReports(viewer, projectId);
    const fileId = list.reports.find((r) => r.fileId)!.fileId!;
    expect((await readFileForViewer(viewer, fileId)).bytes.byteLength).toBeGreaterThan(0);
    await expect(generateReport(viewer, { projectId, source: { kind: "plan", planId }, settings: reportSettingsSchema.parse({}) })).rejects.toThrow();
    await revokeProjectAccess(admin, { projectId, userId: viewer.userId });
    const revoked = await refreshViewer(viewer);
    await expect(readFileForViewer(revoked, fileId)).rejects.toThrow(/not found/i);
    await expect(listReports(revoked, projectId)).rejects.toThrow(/not found/i);
  });
});

describe("every export style paginates without overflow (A26)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  });
  afterAll(async () => {
    await browser.close();
  });

  it("renders all detail levels and presentations with page content inside each page", { timeout: 180_000 }, async () => {
    // A long, realistic plan: the CMH139 seed project with many activities added.
    const admin = await makeUser({ admin: true });
    const project = await makeProject(admin, { code: `PG${Date.now().toString(36)}` });
    const v = await refreshViewer(admin);
    const view = (await getPlanView(v, project.id)).data;
    const pool = view.nodes.find((n) => n.kind === "POOL")!.key;
    const phases = [];
    for (let i = 1; i <= 6; i++) phases.push(await savePhase(v, { projectId: project.id, name: `Phase ${i}` }));
    const ops = [];
    for (let i = 0; i < 140; i++) {
      const start = new Date(Date.UTC(2027, 2, 1 + i * 2)).toISOString().slice(0, 10);
      const finish = new Date(Date.UTC(2027, 2, 6 + i * 2)).toISOString().slice(0, 10);
      ops.push({ type: "addActivity" as const, activity: { key: `a${i}`, code: "", name: `Phase ${(i % 6) + 1} / Building ${String.fromCharCode(65 + (i % 4))} — fire alarm device installation and testing segment ${i + 1}`, phaseId: phases[i % 6].id, areaId: null, systemId: null, calendarKey: null, plannedStart: start, plannedFinish: finish, notes: i % 7 === 0 ? "Coordinate access with the GC; ceiling grid must be complete before devices." : null, sortOrder: i, archived: false } });
    }
    ops.push({ type: "setWeeks" as const, nodeKey: pool, values: Array.from({ length: 50 }, (_, i) => ({ week: new Date(Date.UTC(2027, 2, 1 + i * 7)).toISOString().slice(0, 10), headcount: 4 + (i % 7) })) });
    const res = await applyPlanOps(v, { planId: view.plan.id, expectedRevision: view.plan.revision, ops });
    const page = await browser.newPage();
    const problems: string[] = [];
    let pagesChecked = 0;
    for (const detail of Object.keys(DETAIL_LEVELS)) {
      for (const presentation of Object.keys(PRESENTATIONS)) {
        for (const orientation of ["AUTO", "PORTRAIT"]) {
          const ds = buildReportDataset(res.data, reportSettingsSchema.parse({ detail, presentation, orientation, contents: { notes: true, averageEquivalent: true } }), { companyName: "McKeever & Niekamp Electric", preparedBy: "Test", generatedAt: "2026-10-29T12:00:00.000Z", snapshotId: "test", snapshotName: null, sources: [{ label: "Gray master schedule", detail: "v1" }] });
          await page.setContent(reportHtml(ds), { waitUntil: "load" });
          const result = await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>("section.page")].map((p, i) => {
              const box = p.getBoundingClientRect();
              const overflowing = [...p.querySelectorAll<HTMLElement>("*")].filter((el) => {
                const r = el.getBoundingClientRect();
                return r.height > 0 && (r.bottom > box.bottom + 1 || r.right > box.right + 1);
              }).length;
              const tables = [...p.querySelectorAll("table:not(.kv)")];
              return { i, overflowing, scroll: p.scrollHeight > p.clientHeight + 1, tablesWithoutHeader: tables.filter((t) => !t.querySelector("thead")).length, footer: /Page \d+ of \d+/.test(p.textContent ?? "") };
            }),
          );
          pagesChecked += result.length;
          for (const r of result) {
            if (r.overflowing || r.scroll) problems.push(`${detail}/${presentation}/${orientation} page ${r.i + 1}: ${r.overflowing} element(s) overflow`);
            if (r.tablesWithoutHeader) problems.push(`${detail}/${presentation}/${orientation} page ${r.i + 1}: table without a header row`);
            if (!r.footer) problems.push(`${detail}/${presentation}/${orientation} page ${r.i + 1}: no page number`);
          }
        }
      }
    }
    if (problems.length) console.log(problems.join("\n"));
    expect(problems).toEqual([]);
    expect(pagesChecked).toBeGreaterThan(64);
  });
});
