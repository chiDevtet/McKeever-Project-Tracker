import { describe, expect, it } from "vitest";
import { computeDivision } from "@/domain/division";
import { day, emptyPlan, leader, node } from "../helpers/plan-builder";

const MON = "2027-06-07";

function project(id: string, code: string) {
  const p = emptyPlan();
  return { ...p, project: { ...p.project, id, code } };
}

describe("division demand (A24)", () => {
  // Project A: 8 installers Mon-Wed. Project B: 6 installers Thu-Fri. Same week, different days.
  const a = { ...project("A", "AAA"), nodes: [node("pa", null)], entries: ["2027-06-07", "2027-06-08", "2027-06-09"].map((d) => day("pa", d, 8)) };
  const b = { ...project("B", "BBB"), nodes: [node("pb", null)], entries: ["2027-06-10", "2027-06-11"].map((d) => day("pb", d, 6)) };

  it("uses the aligned concurrent peak, not the sum of independent project peaks", () => {
    const f = computeDivision([a, b], MON, MON, { timezone: "America/New_York" });
    expect(f.weeks[0].installerPeak).toBe(8);
    expect(f.weeks[0].sumOfProjectPeaks).toBe(14);
    expect(f.weeks[0].installerHours).toBe(8 * 3 * 8 + 6 * 2 * 8);
  });

  it("flags a named leader booked simultaneously on two projects and counts them once", () => {
    const a2 = { ...a, leadership: [leader("pmA", "tyler", "Tyler Sisia", "Project manager", MON, "2027-06-11")] };
    const b2 = { ...b, leadership: [leader("pmB", "tyler", "Tyler Sisia", "Project manager", MON, "2027-06-11")] };
    const f = computeDivision([a2, b2], MON, MON, { timezone: "America/New_York" });
    expect(f.weeks[0].leadershipPeak).toBe(1);
    expect(f.conflicts).toHaveLength(1);
    expect(f.conflicts[0]).toMatchObject({ personName: "Tyler Sisia", days: 5, firstDate: MON, lastDate: "2027-06-11" });
  });

  it("never merges TBD placeholders or flags them as conflicts", () => {
    const a2 = { ...a, leadership: [leader("fmA", null, "TBD", "Main foreman", MON, "2027-06-11")] };
    const b2 = { ...b, leadership: [leader("fmB", null, "TBD", "Main foreman", MON, "2027-06-11")] };
    const f = computeDivision([a2, b2], MON, MON, { timezone: "America/New_York" });
    expect(f.weeks[0].leadershipPeak).toBe(2);
    expect(f.conflicts).toHaveLength(0);
  });

  it("reports shortages only when availability is entered", () => {
    const unset = computeDivision([a, b], MON, MON, { timezone: "America/New_York" });
    expect(unset.availabilitySet).toBe(false);
    expect(unset.weeks[0].shortage).toBeNull();
    const set = computeDivision([a, b], MON, MON, { timezone: "America/New_York", availability: [{ role: "Installer", startDate: "2027-01-01", endDate: "2027-12-31", maxHeadcount: 6 }] });
    expect(set.weeks[0]).toMatchObject({ limit: 6, shortage: 2 });
  });
});
