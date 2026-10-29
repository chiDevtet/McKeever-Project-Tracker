import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { buildMovePreview, defaultSelection, moveOps } from "@/domain/move";
import { computePlanningIssues } from "@/domain/issues";
import { proposeFromSource, sourceChangesFromRecords, sourceMoveRequest } from "@/domain/source-apply";
import type { Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import * as imports from "@/server/services/imports";
import { applyPlanOps, getPlanView } from "@/server/services/plans";
import { extractImport } from "@/worker/handlers/import-extract";
import { makeProject, makeUser, noProgress, refreshViewer } from "./helpers";

const PDF = "fixtures/source/CMH139_Preliminary_Schedule_2026-10-15.pdf";
const REVISED_CSV = "tests/fixtures/CMH139_schedule_revised_2026-11-02.csv";
const expected = JSON.parse(await readFile("fixtures/expected/cmh139.source-activities.json", "utf8")) as { pageCount: number; expectedActivities: { externalId: string; pageNumber: number; label: string; start: string; finish: string; printedOriginalDuration: number }[] };
const SCOPE = /fire alarm|vesda|errs|errc/i;

/** A one-page PDF with no text, as produced by a scanner without OCR. */
function blankPdf(): Uint8Array {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function planState(viewer: Viewer, projectId: string) {
  const v = await getPlanView(viewer, projectId);
  return { revision: v.data.plan.revision, activities: v.data.activities.map((a) => [a.key, a.plannedStart, a.plannedFinish]), entries: v.data.entries.length, data: v.data };
}

async function includeScope(viewer: Viewer, sessionId: string) {
  const view = await imports.getImport(viewer, { sessionId });
  const scope = view.rows.filter((r) => r.kind !== "WBS" && SCOPE.test(r.reviewed.name));
  const res = await imports.updateRows(viewer, { sessionId, expectedRevision: view.session.revision, changes: scope.map((r) => ({ rowId: r.id, include: true, reviewed: { role: "scope" as const } })) });
  return { revision: res.revision, count: scope.length };
}

describe("schedule imports (A14, A15, A16, A17)", () => {
  let admin: Viewer;
  let projectId: string;
  let lineageId: string;
  let v1Id: string;
  const linked: Record<string, string> = {};

  beforeAll(async () => {
    admin = await makeUser({ admin: true });
    projectId = (await makeProject(admin)).id;
    admin = await refreshViewer(admin);
  });

  it("extracts the supplied PDF into reviewable rows with page and external-ID references, without touching the plan", { timeout: 240_000 }, async () => {
    const before = await planState(admin, projectId);
    const created = await imports.createImport(admin, { projectId, lineageId: null, newLineageName: "Gray Construction master schedule", label: "2026.10.15 Preliminary", sourceDate: "2026-10-15", filename: "CMH139.pdf", contentType: "application/pdf", bytes: new Uint8Array(await readFile(PDF)) });
    await extractImport({ sessionId: created.id }, noProgress);
    const view = await imports.getImport(admin, { sessionId: created.id });
    lineageId = view.lineage.id;
    expect(view.session.status).toBe("NEEDS_REVIEW");
    expect(view.session.meta.pageCount).toBe(expected.pageCount);
    expect((view.session.meta.previews as { pages: number }).pages).toBe(expected.pageCount);
    expect(view.session.issues).toEqual([]);
    for (const e of expected.expectedActivities) {
      const row = view.rows.find((r) => r.externalId === e.externalId)!;
      expect(row, e.externalId).toBeDefined();
      expect(row.page).toBe(e.pageNumber);
      expect(row.reviewed.name).toBe(e.label);
      expect(row.reviewed.start).toBe(e.start);
      expect(row.reviewed.finish).toBe(e.finish);
      expect(row.reviewed.originalDuration).toBe(e.printedOriginalDuration);
      expect(row.wbsPath.length).toBeGreaterThan(0);
    }
    // Extraction is not a plan write.
    expect(await planState(admin, projectId)).toMatchObject({ revision: before.revision, activities: before.activities, entries: before.entries });

    const { revision, count } = await includeScope(admin, created.id);
    expect(count).toBeGreaterThan(40);
    const valid = await imports.validateImport(admin, { sessionId: created.id, expectedRevision: revision });
    expect(valid.problems).toEqual([]);
    const commit = await imports.commitImport(admin, { sessionId: created.id, expectedRevision: valid.revision });
    v1Id = commit.versionId;
    // A retried commit returns the same version instead of a duplicate.
    expect(await imports.commitImport(admin, { sessionId: created.id, expectedRevision: valid.revision })).toMatchObject({ versionId: v1Id, alreadyCommitted: true });
    const records = await imports.versionRecords(admin, { versionId: v1Id });
    expect(records.records.filter((r) => r.included)).toHaveLength(count);
    expect(records.records.length).toBe(view.rows.filter((r) => r.kind !== "WBS" && r.externalId).length);
    expect(await planState(admin, projectId)).toMatchObject({ revision: before.revision, activities: before.activities });
  });

  it("re-importing the identical file is detected and creates no duplicates", { timeout: 240_000 }, async () => {
    const created = await imports.createImport(admin, { projectId, lineageId, newLineageName: null, label: "Same file again", sourceDate: null, filename: "CMH139.pdf", contentType: "application/pdf", bytes: new Uint8Array(await readFile(PDF)) });
    expect(created.identicalToVersionId).toBe(v1Id);
    await extractImport({ sessionId: created.id }, noProgress);
    const view = await imports.getImport(admin, { sessionId: created.id });
    const counts = view.session.meta.counts as Record<string, number>;
    expect(counts.UNCHANGED).toBe(view.rows.filter((r) => r.kind !== "WBS").length);
    expect(counts.ADDED ?? 0).toBe(0);
    expect(counts.removed).toBe(0);
    // Reviewed inclusion carries forward from the prior version.
    expect(view.rows.filter((r) => r.include).length).toBe((await imports.versionRecords(admin, { versionId: v1Id })).records.filter((r) => r.included).length);
    await imports.cancelImport(admin, { sessionId: created.id });
    expect(await prisma.sourceVersion.count({ where: { lineageId } })).toBe(1);
  });

  it("links installation work to source rows (one source row may support several activities)", async () => {
    const plan = (await getPlanView(admin, projectId)).data;
    const fa = plan.systems.find((s) => s.name === "Fire alarm")!.id;
    const vesda = plan.systems.find((s) => s.name.startsWith("VESDA"))!.id;
    const res = await imports.createActivitiesFromSource(admin, {
      planId: plan.plan.id,
      expectedRevision: plan.plan.revision,
      versionId: v1Id,
      items: [
        { externalId: "P1ER.1140", activities: [{ name: "Elec Rm fire alarm", systemId: fa, phaseId: null, areaId: null, start: "2027-06-01", finish: "2027-06-07" }, { name: "Elec Rm VESDA", systemId: vesda, phaseId: null, areaId: null, start: "2027-06-01", finish: "2027-06-07" }] },
        { externalId: "P1RP.1210", activities: [{ name: "Data Hall FA/VESDA", systemId: fa, phaseId: null, areaId: null, start: "2027-06-21", finish: "2027-07-02" }] },
        { externalId: "P1DG.1090", activities: [{ name: "TAHU VESDA", systemId: vesda, phaseId: null, areaId: null, start: "2027-06-14", finish: "2027-06-18" }] },
      ],
    });
    expect(res.created).toBe(4);
    const after = (await getPlanView(admin, projectId)).data;
    for (const a of after.activities) linked[a.name] = a.key;
    // Staff the fire alarm activity with a crew and add a note, to show they survive a source change.
    const pool = after.nodes.find((n) => n.kind === "POOL")!;
    await applyPlanOps(admin, {
      planId: after.plan.id,
      expectedRevision: after.plan.revision,
      ops: [
        { type: "setWeeks", nodeKey: pool.key, values: [{ week: "2027-05-31", headcount: 6 }, { week: "2027-06-07", headcount: 6 }] },
        { type: "addNode", node: { key: "crew-fa", parentKey: pool.key, kind: "RESERVATION", name: "Elec Rm FA crew", role: "Installer", phaseId: null, areaId: null, systemId: fa, activityKey: linked["Elec Rm fire alarm"], calendarKey: null, notes: null, sortOrder: 0 } },
        { type: "setWeeks", nodeKey: "crew-fa", values: [{ week: "2027-05-31", headcount: 3 }] },
        { type: "updateActivity", key: linked["Elec Rm fire alarm"], patch: { notes: "Coordinate room access with ACE" } },
      ],
    });
  });

  it("a revised version shows added, removed, changed, and renamed records; ambiguous IDs require review", { timeout: 120_000 }, async () => {
    const before = await planState(admin, projectId);
    const created = await imports.createImport(admin, { projectId, lineageId, newLineageName: null, label: "2026.11.02 Revised (CSV)", sourceDate: "2026-11-02", filename: "revised.csv", contentType: "text/csv", bytes: new Uint8Array(await readFile(REVISED_CSV)) });
    expect(created.format).toBe("CSV");
    const preview = await imports.sheetPreview(admin, { sessionId: created.id });
    expect(preview.rows[0]).toEqual(["Activity ID", "Activity Name", "OD", "RD", "Start", "Finish", "WBS"]);
    await imports.setMappingAndExtract(admin, { sessionId: created.id, mapping: { sheet: null, headerRow: 1, dateFormat: "ISO", columns: { externalId: 1, name: 2, originalDuration: 3, remainingDuration: 4, start: 5, finish: 6, wbs: 7 } } });
    await extractImport({ sessionId: created.id }, noProgress);
    let view = await imports.getImport(admin, { sessionId: created.id });
    const counts = view.session.meta.counts as Record<string, number>;
    expect(counts).toMatchObject({ ADDED: 1, CHANGED: 1, RENAMED: 1, DUPLICATE_ID: 2, UNCERTAIN: 1, removed: 2 });
    const byId = (id: string) => view.rows.filter((r) => r.externalId === id);
    expect(byId("P1ER.1140")[0].matchStatus).toBe("CHANGED");
    expect(byId("P1CX.2000")[0].matchStatus).toBe("RENAMED");
    expect(byId("P1ER.1145")[0].matchStatus).toBe("ADDED");
    expect(byId("P1DG.1095")[0]).toMatchObject({ matchStatus: "UNCERTAIN", include: true });
    expect(byId("P2ER.1470").map((r) => r.include)).toEqual([true, true]);

    // Ambiguity blocks validation until resolved.
    let valid = await imports.validateImport(admin, { sessionId: created.id, expectedRevision: view.session.revision });
    expect(valid.valid).toBe(false);
    expect(valid.problems.map((p) => p.message).join("\n")).toMatch(/P1DG\.1095: may be a renumbered activity \(P1DG\.1090\)/);
    expect(valid.problems.map((p) => p.message).join("\n")).toMatch(/P2ER\.1470 appears 2 times/);
    const res = await imports.resolveUncertain(admin, { sessionId: created.id, rowId: byId("P1DG.1095")[0].id, expectedRevision: valid.revision, sameAs: "P1DG.1090" });
    const dup = byId("P2ER.1470").find((r) => /duplicate line/.test(r.reviewed.name))!;
    // A stale review edit is rejected rather than overwriting newer review work.
    await expect(imports.updateRows(admin, { sessionId: created.id, expectedRevision: valid.revision, changes: [{ rowId: dup.id, include: false }] })).rejects.toThrow(/changed/i);
    const upd = await imports.updateRows(admin, { sessionId: created.id, expectedRevision: res.revision, changes: [{ rowId: dup.id, include: false }] });
    valid = await imports.validateImport(admin, { sessionId: created.id, expectedRevision: upd.revision });
    expect(valid.problems).toEqual([]);
    const commit = await imports.commitImport(admin, { sessionId: created.id, expectedRevision: valid.revision });
    expect(commit.versionNumber).toBe(2);
    // Committing a source version does not change the plan.
    expect(await planState(admin, projectId)).toMatchObject({ revision: before.revision, activities: before.activities, entries: before.entries });

    const records = await imports.versionRecords(admin, { versionId: commit.versionId });
    const rec = (id: string) => records.records.find((r) => r.externalId === id)!;
    expect(rec("P1RP.1210")).toMatchObject({ changeKind: "REMOVED", linkedActivityKeys: [linked["Data Hall FA/VESDA"]] });
    expect(rec("P1DG.1090").changeKind).toBe("REMOVED");
    // The renumbered row keeps the link of the activity it replaced.
    expect(rec("P1DG.1095").linkedActivityKeys).toEqual([linked["TAHU VESDA"]]);
    expect(rec("P1ER.1140")).toMatchObject({ changeKind: "CHANGED", start: "2027-06-08", finish: "2027-06-14" });
    view = await imports.getImport(admin, { sessionId: created.id });
    expect(view.session.status).toBe("COMMITTED");
  });

  it("applying a reviewed source change keeps crew sizes, notes, and mappings, and moves only selected staffing", async () => {
    const versions = await imports.listImports(admin, { projectId });
    const v2 = versions.lineages.find((l) => l.id === lineageId)!.versions[0];
    const records = await imports.versionRecords(admin, { versionId: v2.id });
    const data = (await getPlanView(admin, projectId)).data;
    const proposals = proposeFromSource(data, sourceChangesFromRecords(records.records), "shift-with-source");
    // Removed rows propose no move; the changed row proposes moves for both linked activities.
    expect(proposals.filter((p) => p.externalId === "P1RP.1210").every((p) => p.to === null)).toBe(true);
    const moving = proposals.filter((p) => p.to);
    expect(moving.map((p) => p.activityKey).sort()).toEqual([linked["Elec Rm fire alarm"], linked["Elec Rm VESDA"]].sort());
    // Accept the fire alarm activity only.
    const selected = new Set([`P1ER.1140|${linked["Elec Rm fire alarm"]}`]);
    const request = sourceMoveRequest(proposals, selected, "shift-with-source")!;
    const preview = buildMovePreview(data, request);
    const sel = defaultSelection(preview);
    const ops = moveOps(preview, sel);
    const applied = await imports.applySourceChanges(admin, { planId: data.plan.id, expectedRevision: data.plan.revision, versionId: v2.id, ops, selected: [...selected] });
    const after = applied.data;
    const fa = after.activities.find((a) => a.key === linked["Elec Rm fire alarm"])!;
    expect([fa.plannedStart, fa.plannedFinish]).toEqual(["2027-06-08", "2027-06-14"]);
    expect(fa.notes).toBe("Coordinate room access with ACE");
    expect(fa.systemId).toBe(data.activities.find((a) => a.key === fa.key)!.systemId);
    // The unselected activity and the removed row's activity are unchanged.
    for (const name of ["Elec Rm VESDA", "Data Hall FA/VESDA"]) {
      const a = (k: typeof data) => k.activities.find((x) => x.key === linked[name])!;
      expect([a(after).plannedStart, a(after).plannedFinish]).toEqual([a(data).plannedStart, a(data).plannedFinish]);
    }
    // Crew size is preserved; the shared pool stays in place unless included.
    const crew = after.entries.filter((e) => e.nodeKey === "crew-fa");
    expect(new Set(crew.map((e) => e.headcount))).toEqual(new Set([3]));
    const pool = after.nodes.find((n) => n.kind === "POOL")!;
    expect(after.entries.filter((e) => e.nodeKey === pool.key)).toEqual(data.entries.filter((e) => e.nodeKey === pool.key));
    // The removed source row is flagged for disposition, not deleted.
    expect(computePlanningIssues(after).some((i) => i.category === "source-removed" && i.refs.some((r) => r.key === linked["Data Hall FA/VESDA"]))).toBe(true);
    const audit = await prisma.auditEvent.findFirst({ where: { projectId, action: "source.apply" }, orderBy: { createdAt: "desc" } });
    expect(audit?.summary).toContain("P1ER.1140");
  });

  it("canceling and failed or scanned extractions leave the plan unchanged and explain the fallback", { timeout: 120_000 }, async () => {
    const before = await planState(admin, projectId);
    const scanned = await imports.createImport(admin, { projectId, lineageId, newLineageName: null, label: "Scanned copy", sourceDate: null, filename: "scan.pdf", contentType: "application/pdf", bytes: blankPdf() });
    await extractImport({ sessionId: scanned.id }, noProgress);
    const sv = await imports.getImport(admin, { sessionId: scanned.id });
    expect(sv.session.status).toBe("FAILED");
    expect(sv.session.issues.map((i) => i.message).join("\n")).toMatch(/scanned PDF.*CSV or Excel export/);

    const broken = await imports.createImport(admin, { projectId, lineageId, newLineageName: null, label: "Broken", sourceDate: null, filename: "broken.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4\nthis is not really a PDF") });
    await expect(extractImport({ sessionId: broken.id }, noProgress)).rejects.toThrow();
    const bv = await imports.getImport(admin, { sessionId: broken.id });
    expect(bv.session.status).toBe("FAILED");
    expect(bv.session.issues[0].message).toMatch(/Current activities and staffing are unchanged/);
    await expect(imports.createImport(admin, { projectId, lineageId, newLineageName: null, label: "Not a PDF", sourceDate: null, filename: "x.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("hello") })).rejects.toThrow(/not a valid PDF/);

    const csv = await imports.createImport(admin, { projectId, lineageId, newLineageName: null, label: "To cancel", sourceDate: null, filename: "revised.csv", contentType: "text/csv", bytes: new Uint8Array(await readFile(REVISED_CSV)) });
    await imports.setMappingAndExtract(admin, { sessionId: csv.id, mapping: { sheet: null, headerRow: 1, dateFormat: "ISO", columns: { externalId: 1, name: 2, originalDuration: 3, remainingDuration: 4, start: 5, finish: 6, wbs: 7 } } });
    await extractImport({ sessionId: csv.id }, noProgress);
    await imports.cancelImport(admin, { sessionId: csv.id });
    expect((await imports.getImport(admin, { sessionId: csv.id })).session.status).toBe("CANCELED");
    expect(await planState(admin, projectId)).toMatchObject({ revision: before.revision, activities: before.activities, entries: before.entries });
    expect(await prisma.sourceVersion.count({ where: { lineageId } })).toBe(2);
  });

  it("viewers cannot import or change review state", async () => {
    const viewer = await makeUser({ grants: [[projectId, "INTERNAL_VIEWER"]] });
    await expect(imports.createImport(viewer, { projectId, lineageId, newLineageName: null, label: "x", sourceDate: null, filename: "a.csv", contentType: "text/csv", bytes: new TextEncoder().encode("a,b\n1,2\n") })).rejects.toThrow();
    const sessions = await imports.listImports(viewer, { projectId });
    expect(sessions.sessions.length).toBeGreaterThan(0);
    await expect(imports.cancelImport(viewer, { sessionId: sessions.sessions[0].id })).rejects.toThrow();
    const outsider = await makeUser();
    await expect(imports.listImports(outsider, { projectId })).rejects.toThrow(/not found/i);
  });
});
