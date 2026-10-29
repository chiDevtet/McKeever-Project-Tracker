import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTree, checkCapacity, remainingRange } from "@/domain/capacity";
import { defaultCalendarDefinition, defaultWeekPattern } from "@/domain/calendar";
import { computeMeasures } from "@/domain/metrics";
import { expandAllNodes } from "@/domain/staffing";
import { localMidnightMs } from "@/domain/tz";
import { block, emptyPlan, leader, node, week } from "../helpers/plan-builder";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/expected/manpower-cases.json", import.meta.url), "utf8")) as {
  cases: { id: string; expected: Record<string, number | string> }[];
};
const expected = (id: string) => fixture.cases.find((c) => c.id === id)!.expected;

// Illustrative week: Monday 7 June 2027 (no holidays configured).
const MON = "2027-06-07";
const FRI = "2027-06-11";

describe("fixtures/expected/manpower-cases.json", () => {
  it("standard-week: 8 installers + PM + foreman, five 8-hour days", () => {
    const e = expected("standard-week");
    const data = emptyPlan({
      nodes: [node("pool", null)],
      entries: [week("pool", MON, 8)],
      leadership: [leader("pm", "tyler", "Tyler Sisia", "Project manager", MON, FRI), leader("fm", null, "TBD", "Main foreman", MON, FRI)],
    });
    const m = computeMeasures(data, MON, MON);
    const w = m.weeks[0];
    expect(w.totalPeak).toBe(e.peakConcurrentOnsite);
    expect(w.installerHours).toBe(e.installerHours);
    expect(w.leadershipHours).toBe(e.leadershipHours);
    expect(w.totalHours).toBe(e.totalHours);
    expect(w.installerPeak).toBe(8);
    expect(w.leadershipPeak).toBe(2);
  });

  it("nested-allocation: phase 8 split 3 + 5 still counts 8 installers", () => {
    const e = expected("nested-allocation");
    const data = emptyPlan({
      phases: [{ id: "ph1", key: "phase-1", name: "Phase 1", sortOrder: 0, areaIds: [] }],
      nodes: [node("pool", null), node("phase1", "pool", { phaseId: "ph1" }), node("elec", "phase1"), node("hall", "phase1")],
      entries: [week("pool", MON, 8), week("phase1", MON, 8), week("elec", MON, 3), week("hall", MON, 5)],
    });
    const m = computeMeasures(data, MON, MON);
    expect(m.weeks[0].installerPeak).toBe(e.installerHeadcount);
    expect(m.weeks[0].installerHours).toBe(320);
    const blocks = expandAllNodes(data);
    expect(checkCapacity(data, blocks)).toEqual([]);
    const ws = localMidnightMs(MON, "America/New_York");
    const we = localMidnightMs("2027-06-14", "America/New_York");
    const rem = remainingRange(blocks.get("phase1")!, [...blocks.get("elec")!, ...blocks.get("hall")!], ws, we);
    expect(rem).toEqual({ min: e.unallocatedWithinPhase, max: e.unallocatedWithinPhase });
    // Phase allocation view equals 8, not 16.
    const phaseView = computeMeasures(data, MON, MON, { allocation: (t) => t.phaseId === "ph1" });
    expect(phaseView.weeks[0].installerPeak).toBe(8);
    expect(phaseView.isAllocationView).toBe(true);
  });

  it("A05 partial detail: 3 of 8 phase installers in a room leaves 5 remaining; the envelope stays 8", () => {
    const data = emptyPlan({
      phases: [{ id: "ph1", key: "phase-1", name: "Phase 1", sortOrder: 0, areaIds: [] }],
      areas: [{ id: "room", name: "Electrical room", kind: "ROOM", parentId: null, code: null, sortOrder: 0 }],
      nodes: [node("pool", null), node("phase1", "pool", { phaseId: "ph1" }), node("room", "phase1", { phaseId: "ph1", areaId: "room" })],
      entries: [week("pool", MON, 8), week("phase1", MON, 8), week("room", MON, 3)],
    });
    const blocks = expandAllNodes(data);
    const ws = localMidnightMs(MON, "America/New_York");
    const we = localMidnightMs("2027-06-14", "America/New_York");
    expect(remainingRange(blocks.get("phase1")!, blocks.get("room")!, ws, we)).toEqual({ min: 5, max: 5 });
    expect(computeMeasures(data, MON, MON, { allocation: (t) => t.areaId === "room" }).weeks[0].installerPeak).toBe(3);
    expect(computeMeasures(data, MON, MON, { allocation: (t) => t.phaseId === "ph1" }).weeks[0].installerPeak).toBe(8);
    expect(computeMeasures(data, MON, MON).weeks[0].installerPeak).toBe(8);
  });

  it("dedicated-split: 3 dedicated of 8 shared leaves 5 shared, total 8", () => {
    const e = expected("dedicated-split");
    const data = emptyPlan({
      nodes: [node("pool", null), node("crew", "pool", { kind: "CREW", name: "Dedicated crew" })],
      entries: [week("pool", MON, 8), week("crew", MON, 3)],
    });
    const blocks = expandAllNodes(data);
    const ws = localMidnightMs(MON, "America/New_York");
    const we = localMidnightMs("2027-06-14", "America/New_York");
    const rem = remainingRange(blocks.get("pool")!, blocks.get("crew")!, ws, we);
    expect(rem?.min).toBe(e.sharedRemaining);
    const crewView = computeMeasures(data, MON, MON, { allocation: (t) => t.crewKey === "crew" });
    expect(crewView.weeks[0].installerPeak).toBe(e.dedicated);
    expect(computeMeasures(data, MON, MON).weeks[0].installerPeak).toBe(e.installerHeadcount);
    // Returning the crew to shared work (removing its reservation) changes no capacity.
    const returned = { ...data, entries: data.entries.filter((x) => x.nodeKey !== "crew") };
    expect(computeMeasures(returned, MON, MON).weeks[0].installerPeak).toBe(8);
    expect(computeMeasures(returned, MON, MON).weeks[0].installerHours).toBe(320);
  });

  it("part-time-onsite-PM: PM Monday and Tuesday only", () => {
    const e = expected("part-time-onsite-PM");
    const data = emptyPlan({
      nodes: [node("pool", null)],
      entries: [week("pool", MON, 8)],
      leadership: [
        leader("pm", "tyler", "Tyler Sisia", "Project manager", MON, FRI, { onsiteMode: "WEEKDAYS", onsiteWeekdays: [1, 2] }),
        leader("fm", "fm1", "Foreman", "Main foreman", MON, FRI),
      ],
    });
    const w = computeMeasures(data, MON, MON).weeks[0];
    expect(w.totalPeak).toBe(e.peakConcurrentOnsite);
    expect(w.installerHours).toBe(e.installerHours);
    expect(w.leadershipHours).toBe(e.leadershipHours);
    expect(w.totalHours).toBe(e.totalHours);
    expect(w.calendarHours).toBe(40);
    expect(w.averageEquivalent).toBe(e.averageEquivalentOnsiteStaffing);
  });

  it("six-tens: six ten-hour days for one week", () => {
    const e = expected("six-tens");
    const sixTens = defaultWeekPattern(10).map((d, i) => (i < 6 ? { ...d, open: true, hours: 10 } : d));
    const cal = { ...defaultCalendarDefinition(), periods: [{ id: "acc", label: "Acceleration", start: MON, end: "2027-06-13", weekPattern: sixTens }] };
    const data = emptyPlan({ nodes: [node("pool", null)], entries: [week("pool", MON, 8)] }, cal);
    const w = computeMeasures(data, MON, MON).weeks[0];
    expect(w.installerPeak).toBe(e.peakConcurrentInstallers);
    expect(w.installerHours).toBe(e.installerHours);
    expect(w.openDays).toBe(6);
  });

  it("sequential-shifts: two non-overlapping 8-person shifts", () => {
    const e = expected("sequential-shifts");
    const data = emptyPlan({
      nodes: [node("pool", null)],
      entries: [block("pool", MON, "06:00", "14:00", 8), block("pool", MON, "14:00", "22:00", 8)],
    });
    const m = computeMeasures(data, MON, MON, {}, { days: true });
    const monday = m.days.find((d) => d.start === MON)!;
    expect(monday.installerPeak).toBe(e.peakConcurrentInstallers);
    expect(monday.installerHours).toBe(e.dailyInstallerHours);
    expect(typeof e.uniqueIndividualsDuringDay).toBe("string");
  });
});

describe("capacity conservation", () => {
  it("rejects a reservation above its parent and an overlapping duplicate booking", () => {
    const data = emptyPlan({
      nodes: [node("pool", null), node("a", "pool"), node("b", "pool")],
      entries: [week("pool", MON, 8), block("a", MON, "07:00", "11:00", 8), block("b", MON, "10:00", "15:00", 8)],
    });
    const v = checkCapacity(data, expandAllNodes(data), buildTree(data.nodes));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ parentKey: "pool", capacity: 8, reserved: 16, date: MON, timeRange: "10:00–11:00" });
    expect(v[0].childKeys).toEqual(["a", "b"]);
  });

  it("accepts sequential use of the same positions and counts presence once", () => {
    const data = emptyPlan({
      nodes: [node("pool", null), node("a", "pool"), node("b", "pool")],
      entries: [week("pool", MON, 8), block("a", MON, "07:00", "11:00", 8), block("b", MON, "11:00", "15:00", 8)],
    });
    expect(checkCapacity(data, expandAllNodes(data))).toEqual([]);
    const monday = computeMeasures(data, MON, MON, {}, { days: true }).days.find((d) => d.start === MON)!;
    expect(monday.installerPeak).toBe(8);
    expect(monday.installerHours).toBe(64);
  });

  it("a named person with several responsibilities counts once", () => {
    const data = emptyPlan({
      leadership: [
        leader("fm-fa", "p9", "Pat Foreman", "Main foreman", MON, FRI, { responsibilitySystemIds: ["fa", "vesda", "radio", "cell"] }),
        leader("fm-safety", "p9", "Pat Foreman", "Safety lead", MON, FRI),
      ],
    });
    const w = computeMeasures(data, MON, MON).weeks[0];
    expect(w.leadershipPeak).toBe(1);
    expect(w.leadershipHours).toBe(40);
  });

  it("offsite management hours never enter onsite totals", () => {
    const data = emptyPlan({ leadership: [leader("pm", "tyler", "Tyler", "Project manager", MON, FRI, { offsiteHoursPerWeek: 12, dayOverrides: [{ date: "2027-06-11", kind: "offsite", hours: null, start: null }] })] });
    const w = computeMeasures(data, MON, MON).weeks[0];
    expect(w.leadershipHours).toBe(32);
    expect(w.leadershipPeak).toBe(1);
  });
});
