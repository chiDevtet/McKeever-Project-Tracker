import { describe, expect, it } from "vitest";
import { defaultCalendarDefinition } from "@/domain/calendar";
import { computeMeasures } from "@/domain/metrics";
import { applyAndValidate, applyOps, PlanValidationError, validatePlan, type PlanOp } from "@/domain/ops";
import type { ActivityInput } from "@/domain/plan";
import { movedDates, proposeSuccessorMoves, wouldCreateCycle } from "@/domain/schedule";
import { emptyPlan, node, week } from "../helpers/plan-builder";

const MON = "2027-06-07";

function activity(key: string, code: string, start: string, finish: string, extra: Partial<ActivityInput> = {}): ActivityInput {
  return { key, code, name: code, phaseId: null, areaId: null, systemId: null, calendarKey: null, plannedStart: start, plannedFinish: finish, notes: null, sortOrder: 0, archived: false, ...extra };
}

function expectBlocked(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PlanValidationError);
    expect((e as PlanValidationError).issues.map((i) => i.code)).toContain(code);
    return (e as PlanValidationError).issues;
  }
  throw new Error(`expected ${code}`);
}

describe("staffing ops", () => {
  const base = emptyPlan({ nodes: [node("pool", null)], entries: [week("pool", MON, 8)] });

  it("rejects a reservation beyond capacity and explains the correction path", () => {
    const ops: PlanOp[] = [
      { type: "addNode", node: node("phase", "pool") },
      { type: "setWeeks", nodeKey: "phase", values: [{ week: MON, headcount: 12 }] },
    ];
    const issues = expectBlocked(() => applyAndValidate(base, ops), "capacity.exceeded")!;
    expect(issues[0].message).toMatch(/12 reserved .* only 8 available/);
    expect(issues[0].message).toMatch(/explicitly increase the workforce/);
    // The explicit increase makes the same reservation valid; nothing else grows capacity.
    const fixed = applyAndValidate(base, [...ops, { type: "increaseWorkforce", nodeKey: "pool", values: [{ week: MON, add: 4 }] }]);
    expect(computeMeasures(fixed, MON, MON).weeks[0].installerPeak).toBe(12);
  });

  it("rejects fractional and negative people counts at the schema level", () => {
    const bad = applyOps(base, [{ type: "setWeeks", nodeKey: "pool", values: [{ week: MON, headcount: 3 }] }]);
    bad.entries[0].headcount = 2.5;
    expect(validatePlan(bad).map((i) => i.code)).toContain("entry.headcount");
  });

  it("splits a crew and returns it to shared work without changing total capacity", () => {
    const withCrew = applyAndValidate(base, [
      { type: "addNode", node: node("crew", "pool", { kind: "CREW", name: "FA crew" }) },
      { type: "setWeeks", nodeKey: "crew", values: [{ week: MON, headcount: 3 }] },
    ]);
    const split = applyAndValidate(withCrew, [{ type: "splitCrew", key: "crew", newKey: "crew2", name: "VESDA crew", headcount: 1, from: MON, to: "2027-06-13" }]);
    expect(split.entries.filter((e) => e.nodeKey.startsWith("crew")).map((e) => [e.nodeKey, e.headcount])).toEqual([
      ["crew", 2],
      ["crew2", 1],
    ]);
    const released = applyAndValidate(split, [{ type: "releaseNode", key: "crew", from: MON }, { type: "releaseNode", key: "crew2", from: MON }]);
    expect(released.entries.filter((e) => e.nodeKey !== "pool")).toEqual([]);
    for (const d of [withCrew, split, released]) expect(computeMeasures(d, MON, MON).weeks[0].installerHours).toBe(320);
  });

  it("releasing mid-week keeps the earlier days as day entries", () => {
    const withCrew = applyAndValidate(base, [
      { type: "addNode", node: node("crew", "pool", { kind: "CREW" }) },
      { type: "setWeeks", nodeKey: "crew", values: [{ week: MON, headcount: 3 }] },
    ]);
    const released = applyAndValidate(withCrew, [{ type: "releaseNode", key: "crew", from: "2027-06-10" }]);
    expect(released.entries.filter((e) => e.nodeKey === "crew").map((e) => `${e.kind}:${e.date}`)).toEqual(["DAY:2027-06-07", "DAY:2027-06-08", "DAY:2027-06-09"]);
  });

  it("refuses to delete a pool that still has staffing", () => {
    expect(() => applyOps(base, [{ type: "removeNode", key: "pool" }])).toThrow(/explicit/);
  });

  it("shifting staffing by working days moves each resource-day", () => {
    const def = { ...defaultCalendarDefinition(), exceptions: [{ id: "h", date: "2027-06-14", kind: "closed" as const, hours: null, start: null, label: "Holiday" }] };
    const data = emptyPlan({ nodes: [node("pool", null), node("r", "pool")], entries: [week("pool", MON, 8), week("pool", "2027-06-14", 8), week("r", MON, 2)] }, def);
    const shifted = applyAndValidate(data, [{ type: "shiftNodeEntries", key: "r", includeDescendants: false, from: null, to: null, mode: "workingDays", amount: 3 }]);
    const days = shifted.entries.filter((e) => e.nodeKey === "r").map((e) => e.date);
    // Mon-Fri 7-11 June shifted three working days, skipping the 14 June holiday.
    expect(days).toEqual(["2027-06-10", "2027-06-11", "2027-06-15", "2027-06-16", "2027-06-17"]);
    // Allocation view of the reservation: still ten resource-days of eight hours.
    const total = computeMeasures(shifted, MON, "2027-06-14", { allocation: () => true }).totals.installerHours;
    expect(total).toBe(2 * 5 * 8);
  });
});

describe("scheduling ops (A11, A12)", () => {
  const def = { ...defaultCalendarDefinition(), exceptions: [{ id: "h", date: "2027-07-05", kind: "closed" as const, hours: null, start: null, label: "Independence Day (observed)" }] };

  it("moves a five-day activity across a weekend and holiday preserving five working days", () => {
    const a = activity("a", "A-0001", "2027-06-28", "2027-07-02");
    const data = emptyPlan({ activities: [a] }, def);
    const to = movedDates(data, a, "2027-07-01", "preserve-working-duration");
    expect(to).toEqual({ start: "2027-07-01", finish: "2027-07-08" });
    // Keep-finish rule changes duration instead.
    expect(movedDates(data, a, "2027-07-01", "keep-finish", "2027-07-02")).toEqual({ start: "2027-07-01", finish: "2027-07-02" });
  });

  it("proposes a valid successor move with lag, and cancel leaves both unchanged", () => {
    const cable = activity("cable", "A-0001", "2027-06-07", "2027-06-11", { name: "Cable installation" });
    const term = activity("term", "A-0002", "2027-06-16", "2027-06-18", { name: "Termination" });
    const data = applyAndValidate(emptyPlan({ activities: [cable, term] }, def), [{ type: "addLink", predecessorKey: "cable", successorKey: "term", lagDays: 2 }]);
    const to = movedDates(data, cable, "2027-06-14", "preserve-working-duration");
    const proposals = proposeSuccessorMoves(data, new Map([["cable", to]]));
    expect(proposals).toHaveLength(1);
    // Cable now finishes Fri 18 June; two working-day lag -> earliest Wed 23 June.
    expect(proposals[0]).toMatchObject({ key: "term", required: true, to: { start: "2027-06-23", finish: "2027-06-25" } });
    // Nothing was applied: the plan is unchanged until ops are committed.
    expect(data.activities.map((a) => [a.plannedStart, a.plannedFinish])).toEqual([
      ["2027-06-07", "2027-06-11"],
      ["2027-06-16", "2027-06-18"],
    ]);
  });

  it("rejects a circular link", () => {
    const data = applyAndValidate(emptyPlan({ activities: [activity("a", "A-1", MON, MON), activity("b", "A-2", "2027-06-08", "2027-06-08")] }), [{ type: "addLink", predecessorKey: "a", successorKey: "b", lagDays: 0 }]);
    expect(wouldCreateCycle(data.links, "b", "a")).toBe(true);
    expectBlocked(() => applyAndValidate(data, [{ type: "addLink", predecessorKey: "b", successorKey: "a", lagDays: 0 }]), "link.cycle");
  });

  it("rejects finish before start", () => {
    const data = emptyPlan({ activities: [activity("a", "A-1", MON, "2027-06-11")] });
    expectBlocked(() => applyAndValidate(data, [{ type: "setActivityDates", key: "a", start: "2027-06-11", finish: MON }]), "activity.finishBeforeStart");
  });

  it("does not propose moving completed successors", () => {
    const p = activity("p", "A-1", MON, "2027-06-08");
    const s = activity("s", "A-2", "2027-06-09", "2027-06-10");
    const data = emptyPlan({
      activities: [p, s],
      links: [{ predecessorKey: "p", successorKey: "s", lagDays: 0 }],
      progress: [{ activityKey: "s", status: "COMPLETE", actualStart: "2027-06-09", actualFinish: "2027-06-10", percentComplete: 100, holdReason: null, holdReviewDate: null }],
    });
    const proposals = proposeSuccessorMoves(data, new Map([["p", { start: "2027-06-10", finish: "2027-06-11" }]]));
    expect(proposals[0].blockedByCompletion).toBe(true);
  });
});
