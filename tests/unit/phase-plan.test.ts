import { describe, expect, it } from "vitest";
import { applyPhaseStaffing, derivedPoolEntries, windowEntries, type PhaseStaffing } from "@/domain/phase-plan";
import { expandAllNodes, projectResolver } from "@/domain/staffing";
import { emptyPlan, node } from "../helpers/plan-builder";

const plans = (a: [string, string], b: [string, string]): PhaseStaffing[] => [
  { phaseId: "p1", nodeKey: "res-1", name: "Phase 1 installers (planned)", notes: null, role: "Installer", headcount: 8, start: a[0], finish: a[1], sortOrder: 0 },
  { phaseId: "p2", nodeKey: "res-2", name: "Phase 2 installers (planned)", notes: null, role: "Installer", headcount: 8, start: b[0], finish: b[1], sortOrder: 1 },
];
const phases = [
  { id: "p1", key: "phase-1", name: "Phase 1", sortOrder: 0, areaIds: [] },
  { id: "p2", key: "phase-2", name: "Phase 2", sortOrder: 1, areaIds: [] },
];
const perDay = (data: ReturnType<typeof emptyPlan>, key: string) => {
  const m = new Map<string, number>();
  for (const b of expandAllNodes(data).get(key) ?? []) m.set(b.shiftDate, (m.get(b.shiftDate) ?? 0) + b.headcount);
  return m;
};

describe("phase staffing plans", () => {
  it("staffs exactly the window: whole weeks as WEEK entries, boundary weeks as working-day DAY entries", () => {
    const cal = projectResolver(emptyPlan());
    // Thursday 20 May to Wednesday 2 June 2027.
    const e = windowEntries("r", "2027-05-20", "2027-06-02", 8, cal);
    expect(e.map((x) => `${x.kind} ${x.date}`)).toEqual(["DAY 2027-05-20", "DAY 2027-05-21", "WEEK 2027-05-24", "DAY 2027-05-31", "DAY 2027-06-01", "DAY 2027-06-02"]);
    expect(e.every((x) => x.headcount === 8)).toBe(true);
  });

  it("derives pool capacity as the sum of overlapping reservations and never staffs outside a window", () => {
    const base = emptyPlan({ phases, nodes: [node("pool", null)] });
    const r = applyPhaseStaffing(base, base.nodes[0], plans(["2027-05-20", "2027-06-11"], ["2027-06-01", "2027-06-18"]));
    expect(r.changed).toBe(true);
    const pool = perDay(r.data, "pool");
    expect(pool.get("2027-05-19")).toBeUndefined();
    expect(pool.get("2027-05-20")).toBe(8);
    expect(pool.get("2027-05-31")).toBe(8);
    expect(pool.get("2027-06-01")).toBe(16);
    expect(pool.get("2027-06-11")).toBe(16);
    expect(pool.get("2027-06-14")).toBe(8);
    expect(pool.get("2027-06-21")).toBeUndefined();
    expect(r.data.phaseWindows).toEqual([
      expect.objectContaining({ phaseId: "p1", start: "2027-05-20", finish: "2027-06-11" }),
      expect.objectContaining({ phaseId: "p2", start: "2027-06-01", finish: "2027-06-18" }),
    ]);
    // Re-applying is a no-op.
    expect(applyPhaseStaffing(r.data, r.data.nodes[0], plans(["2027-05-20", "2027-06-11"], ["2027-06-01", "2027-06-18"])).changed).toBe(false);
  });

  it("keeps an edited reservation and existing windows, and includes other pool reservations in the pool total", () => {
    const base = emptyPlan({ phases, nodes: [node("pool", null)] });
    const seeded = applyPhaseStaffing(base, base.nodes[0], plans(["2027-05-24", "2027-06-04"], ["2027-05-24", "2027-06-04"])).data;
    const edited = structuredClone(seeded);
    edited.entries = edited.entries.map((e) => (e.nodeKey === "res-1" && e.date === "2027-05-24" ? { ...e, headcount: 10 } : e));
    edited.nodes.push(node("crew", "pool"));
    edited.entries.push({ nodeKey: "crew", kind: "DAY", date: "2027-05-26", headcount: 3, hours: null, startTime: null, endTime: null, label: null });
    const r = applyPhaseStaffing(edited, edited.nodes[0], plans(["2027-05-24", "2027-06-04"], ["2027-05-24", "2027-06-04"]));
    expect(r.notes.join("\n")).toMatch(/Phase 1 installers \(planned\): reservation staffing was edited after seeding; left as edited/);
    const pool = perDay(r.data, "pool");
    expect(pool.get("2027-05-25")).toBe(18);
    expect(pool.get("2027-05-26")).toBe(21);
    expect(pool.get("2027-06-01")).toBe(16);
    expect(derivedPoolEntries(r.data, "pool", "2027-05-24", "2027-06-06").find((e) => e.kind === "WEEK" && e.date === "2027-05-31")?.headcount).toBe(16);
  });
});
