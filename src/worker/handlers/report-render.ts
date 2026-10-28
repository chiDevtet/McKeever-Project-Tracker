import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReportDataset, reportSettingsSchema } from "@/domain/report";
import { prisma } from "@/server/db";
import { storeFile } from "@/server/services/files";
import { hashJson, snapshotFromRow } from "@/server/snapshots";
import { resolveOrientation } from "@/reporting/document";
import { reportHtml } from "@/reporting/html";
import { ManpowerChart, type ChartMeasure } from "@/reporting/manpower-chart";
import { renderPdf, renderSvgPng } from "@/reporting/pdf";
import { buildWorkbook } from "@/reporting/xlsx";
import type { Progress } from "../runner";

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";
}

/** Render queued reports from their frozen snapshot. Already-rendered files are left as issued. */
export async function renderReports(payload: Record<string, unknown>, progress: Progress) {
  const snapshotId = String(payload.snapshotId);
  const reportIds = (payload.reportIds as string[]) ?? [];
  const snap = await prisma.planSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  const data = snapshotFromRow(snap);
  const reports = await prisma.generatedReport.findMany({ where: { id: { in: reportIds } }, orderBy: { createdAt: "asc" } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: snap.projectId } });
  // One generation timestamp for every format so PDF and Excel come from an identical dataset.
  const generatedAt = (reports[0]?.createdAt ?? new Date()).toISOString();
  const done: { id: string; fileId: string; sha256: string }[] = [];
  for (const [i, r] of reports.entries()) {
    if (r.status === "READY") continue;
    await prisma.generatedReport.update({ where: { id: r.id }, data: { status: "RENDERING", error: null } });
    try {
      const settings = reportSettingsSchema.parse(r.settings);
      const ds = buildReportDataset(data.plan, settings, { companyName: data.companyName, preparedBy: r.authorName, generatedAt, snapshotId: snap.id, snapshotName: snap.kind === "BASELINE" ? `Baseline “${snap.name}”` : null, sources: data.sources });
      const datasetHash = hashJson(ds);
      await progress((i / reports.length) * 100, `Rendering ${r.format}`);
      let bytes: Uint8Array;
      let contentType: string;
      if (r.format === "PDF") {
        bytes = await renderPdf(reportHtml(ds), resolveOrientation(ds));
        contentType = "application/pdf";
      } else {
        const svg = renderToStaticMarkup(createElement(ManpowerChart, { weeks: ds.weeks.map((w) => ({ week: w.week, installerPeak: w.installerPeak, installersAtPeak: w.installersAtPeak, leadershipAtPeak: w.leadershipAtPeak, totalPeak: w.totalPeak, installerHours: w.installerHours, leadershipHours: w.leadershipHours, calendarHours: w.calendarHours, averageEquivalent: w.averageEquivalent })), measure: settings.measure as ChartMeasure, width: 960, height: 260 }));
        const png = ds.allocationEmpty ? undefined : await renderSvgPng(svg, 960, 260);
        bytes = await buildWorkbook(ds, png);
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
      const filename = `${project.code}-${slug(settings.title)}-rev${snap.planRevision}-${generatedAt.slice(0, 10)}.${r.format === "PDF" ? "pdf" : "xlsx"}`;
      const file = await prisma.$transaction(async (tx) => {
        const f = await storeFile(tx, { workspaceId: project.workspaceId, projectId: project.id, kind: r.format === "PDF" ? "REPORT_PDF" : "REPORT_XLSX", filename, contentType, bytes, immutable: true, createdById: r.authorId });
        await tx.generatedReport.update({ where: { id: r.id }, data: { status: "READY", fileId: f.id, sizeBytes: f.sizeBytes, sha256: f.sha256, datasetHash, readyAt: new Date() } });
        return f;
      });
      done.push({ id: r.id, fileId: file.id, sha256: file.sha256 });
    } catch (err) {
      await prisma.generatedReport.update({ where: { id: r.id }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 2000) : String(err) } });
      throw err;
    }
  }
  return { rendered: done };
}
