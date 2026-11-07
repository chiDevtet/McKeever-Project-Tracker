import { describe, expect, it } from "vitest";
import { applySeedStaffing, dailyEntries, monthlyValue, windowEntries, type PoolForecast } from "@/domain/phase-plan";
import { expandAllNodes, projectResolver } from "@/domain/staffing";
import type { PlanData } from "@/domain/plan";
import { emptyPlan, node } from "../helpers/plan-builder";

const perDay = (data: PlanData, key: string) => {
  const m = new Map<string, number>();
  for (const b of expandAllNodes(data).get(key) ?? []) m.set(b.shiftDate, (m.get(b.shiftDate) ?? 0) + b.headcount);
  return m;
};

const forecast = (over: Partial<PoolForecast> = {}): PoolForecast => ({
  role: "Installer",
  key: "pool",
  name: "Installers — shared workforce",
  notes: "Planned capacity from test",
  sortOrder: 0,
  ownedFrom: "2027-04-01",
  ownedTo: "2027-06-30",
  // Thursday 1 April to Wednesday 2 June 2027.
  valueOn: monthlyValue(
    [
      { month: "2027-04", headcount: 6 },
      { month: "2027-05", headcount: 4 },
      { month: "2027-06", headcount: 9 },
    ],
    "2027-04-01",
    "2027-06-02",
  ),
  ...over,
});

describe("seed staffing", () => {
  it("turns monthly forecasts into weekly entries, with day entries where a week crosses a month or the period edge", () => {
    const cal = projectResolver(emptyPlan());
    const f = forecast();
    const e = dailyEntries("pool", f.valueOn, f.ownedFrom, f.ownedTo, cal).map((x) => `${x.kind} ${x.date} ${x.headcount}`);
    expect(e.slice(0, 3)).toEqual(["DAY 2027-04-01 6", "DAY 2027-04-02 6", "WEEK 2027-04-05 6"]);
    // Week of 26 Apr: Mon-Fri 26-30 April are all April.
    expect(e).toContain("WEEK 2027-04-26 6");
    // Week of 31 May: Monday is May (4), Tuesday-Wednesday June (9), then the period ends.
    expect(e.filter((x) => x.includes("2027-05-31") || x.includes("2027-06-0"))).toEqual(["DAY 2027-05-31 4", "DAY 2027-06-01 9", "DAY 2027-06-02 9"]);
    expect(e.at(-1)).toBe("DAY 2027-06-02 9");
    // A constant window matches what windowEntries wrote for the earlier seed.
    expect(windowEntries("r", "2027-05-20", "2027-06-02", 8, cal).map((x) => `${x.kind} ${x.date}`)).toEqual(["DAY 2027-05-20", "DAY 2027-05-21", "WEEK 2027-05-24", "DAY 2027-05-31", "DAY 2027-06-01", "DAY 2027-06-02"]);
  });

  it("replaces the pool inside its owned range, keeps entries outside it, and creates a missing pool", () => {
    const base = emptyPlan({ nodes: [node("pool", null)], entries: [{ nodeKey: "pool", kind: "WEEK", date: "2027-03-22", headcount: 2, hours: null, startTime: null, endTime: null, label: null }, { nodeKey: "pool", kind: "WEEK", date: "2027-05-10", headcount: 40, hours: null, startTime: null, endTime: null, label: null }] });
    const support = forecast({ role: "Ground support", key: "support", name: "Ground support — ACE site safety", sortOrder: 1, valueOn: monthlyValue([{ month: "2027-04", headcount: 2 }], "2027-04-01", "2027-04-30") });
    const r = applySeedStaffing(base, { windows: [], retire: [], pools: [forecast(), support] });
    expect(r.changed).toBe(true);
    const pool = perDay(r.data, "pool");
    expect(pool.get("2027-03-22")).toBe(2);
    expect(pool.get("2027-04-01")).toBe(6);
    expect(pool.get("2027-05-10")).toBe(4);
    expect(pool.get("2027-06-03")).toBeUndefined();
    expect(r.data.nodes.find((n) => n.key === "support")).toMatchObject({ kind: "POOL", parentKey: null, role: "Ground support" });
    expect(perDay(r.data, "support").get("2027-04-30")).toBe(2);
    expect(applySeedStaffing(r.data, { windows: [], retire: [], pools: [forecast(), support] }).changed).toBe(false);
  });

  it("removes an unedited earlier reservation, keeps an edited one, and keeps operator phase windows", () => {
    const cal = projectResolver(emptyPlan());
    const expected = windowEntries("old", "2027-04-05", "2027-04-16", 8, cal);
    const base = emptyPlan({
      phases: [{ id: "p1", key: "phase-1", name: "Phase 1", sortOrder: 0, areaIds: [] }],
      phaseWindows: [{ phaseId: "p1", start: "2027-04-12", finish: "2027-05-28", note: "operator" }],
      nodes: [node("pool", null), node("old", "pool"), node("edited", "pool")],
      entries: [...expected, ...windowEntries("edited", "2027-04-05", "2027-04-16", 3, cal)],
    });
    const r = applySeedStaffing(base, {
      windows: [{ phaseId: "p1", name: "Phase 1", start: "2027-05-20", finish: "2027-12-10", note: "" }],
      retire: [
        { nodeKey: "old", name: "Old", expected },
        { nodeKey: "edited", name: "Edited", expected: windowEntries("edited", "2027-04-05", "2027-04-16", 8, cal) },
      ],
      pools: [forecast()],
    });
    expect(r.data.nodes.map((n) => n.key)).toEqual(["pool", "edited"]);
    expect(r.notes.join("\n")).toMatch(/Old: removed/);
    expect(r.notes.join("\n")).toMatch(/Edited: edited after seeding; kept as edited/);
    expect(r.notes.join("\n")).toMatch(/Phase 1: existing phase window 2027-04-12–2027-05-28 differs/);
    expect(r.data.phaseWindows[0]).toMatchObject({ start: "2027-04-12", finish: "2027-05-28" });
  });
});
