import { describe, expect, it } from "vitest";
import { comparePlans } from "@/domain/compare";
import { applyOps } from "@/domain/ops";
import { normalizeProgress, validateProgress, type ProgressDraft } from "@/domain/progress";
import { emptyPlan, node, week } from "../helpers/plan-builder";

const draft = (d: Partial<ProgressDraft>): ProgressDraft => ({ status: "NOT_STARTED", actualStart: null, actualFinish: null, percentComplete: null, holdReason: null, holdReviewDate: null, ...d });
const today = "2027-06-10";
const msgs = (prev: Parameters<typeof validateProgress>[0], d: Partial<ProgressDraft>) => validateProgress(prev, draft(d), today).map((p) => p.message);

describe("progress rules", () => {
  it("rejects future actuals and a finish before the start", () => {
    expect(msgs(null, { status: "IN_PROGRESS", actualStart: "2027-06-11" })).toContain("An actual start cannot be in the future");
    expect(msgs(null, { status: "COMPLETE", actualStart: "2027-06-08", actualFinish: "2027-06-07" })).toContain("The actual finish cannot be before the actual start");
    expect(msgs(null, { status: "COMPLETE", actualStart: "2027-06-08", actualFinish: "2027-06-11" })).toContain("An actual finish cannot be in the future");
  });

  it("completion requires actual dates and records 100 percent", () => {
    expect(msgs(null, { status: "COMPLETE" })).toEqual(expect.arrayContaining(["Completing an activity requires an actual finish", "Completing an activity requires an actual start"]));
    const ok = draft({ status: "COMPLETE", actualStart: "2027-06-01", actualFinish: "2027-06-10", percentComplete: 60 });
    expect(validateProgress(null, ok, today)).toEqual([]);
    expect(normalizeProgress("a", ok).percentComplete).toBe(100);
  });

  it("reopening needs a reason; hold needs a reason and keeps nothing else implicit", () => {
    expect(msgs({ status: "COMPLETE" }, { status: "IN_PROGRESS", actualStart: "2027-06-01" })).toContain("Reopening completed work requires a reason; it is recorded in the history");
    expect(msgs({ status: "COMPLETE" }, { status: "IN_PROGRESS", actualStart: "2027-06-01", reopenReason: "Rework" })).toEqual([]);
    expect(msgs(null, { status: "ON_HOLD" })).toContain("Record why the work is on hold");
    expect(normalizeProgress("a", draft({ status: "IN_PROGRESS", actualStart: "2027-06-01", holdReason: "stale" })).holdReason).toBeNull();
  });
});

describe("plan comparison", () => {
  it("reports peak, hours, and moved activities against the base plan", () => {
    const base = emptyPlan({
      nodes: [node("pool", null)],
      entries: [week("pool", "2027-06-07", 4)],
      activities: [{ key: "a", code: "A-0001", name: "Rough-in", phaseId: null, areaId: null, systemId: null, calendarKey: null, plannedStart: "2027-06-07", plannedFinish: "2027-06-11", notes: null, sortOrder: 0, archived: false }],
    });
    const other = applyOps(base, [
      { type: "setWeeks", nodeKey: "pool", values: [{ week: "2027-06-07", headcount: 8 }] },
      { type: "setActivityDates", key: "a", start: "2027-06-14", finish: "2027-06-18" },
    ]);
    const c = comparePlans(base, other);
    expect(c.totals.base).toMatchObject({ peakInstallers: 4, installerHours: 160 });
    expect(c.totals.other).toMatchObject({ peakInstallers: 8, installerHours: 320 });
    expect(c.activities).toEqual([expect.objectContaining({ key: "a", change: "moved", startDelta: 5, finishDelta: 5 })]);
    expect(c.staffingRowsChanged).toBe(1);
  });
});
