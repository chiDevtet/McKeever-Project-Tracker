import { describe, expect, it } from "vitest";
import { addWorkingDays, CalendarResolver, defaultCalendarDefinition, finishForDuration, resolveDay, workingDayDelta, workingDaysBetween } from "@/domain/calendar";
import { isoWeekday, isoWeekNumber, startOfWeek } from "@/domain/dates";
import { computeMeasures } from "@/domain/metrics";
import { expandAllNodes } from "@/domain/staffing";
import { epochMsToZonedTime, zonedTimeToEpochMs } from "@/domain/tz";
import { block, emptyPlan, leader, node, week } from "../helpers/plan-builder";

const NY = "America/New_York";

describe("dates", () => {
  it("uses Monday-start weeks", () => {
    expect(isoWeekday("2027-06-07")).toBe(1);
    expect(startOfWeek("2027-06-13")).toBe("2027-06-07");
    expect(startOfWeek("2027-06-07")).toBe("2027-06-07");
    expect(isoWeekNumber("2027-06-07")).toBe(23);
  });
});

describe("calendar resolution", () => {
  const def = {
    ...defaultCalendarDefinition(),
    exceptions: [
      { id: "h1", date: "2027-07-05", kind: "closed" as const, hours: null, start: null, label: "Independence Day (observed)" },
      { id: "s1", date: "2027-07-10", kind: "open" as const, hours: 6, start: "06:00", label: "Added Saturday" },
    ],
  };
  const cal = new CalendarResolver(def, NY);

  it("applies holidays and added workdays", () => {
    expect(resolveDay(def, "2027-07-05")).toMatchObject({ open: false, hours: 0, source: "exception" });
    expect(resolveDay(def, "2027-07-10")).toMatchObject({ open: true, hours: 6, start: "06:00" });
    expect(cal.openDaysBetween("2027-07-05", "2027-07-11")).toBe(5);
  });

  it("moves five working days across a weekend and a holiday (A11 rule)", () => {
    // Start Thursday 1 July 2027: Thu 1, Fri 2, (weekend), (Mon 5 holiday), Tue 6, Wed 7, Thu 8.
    expect(finishForDuration(cal, "2027-07-01", 5)).toBe("2027-07-08");
    expect(workingDaysBetween(cal, "2027-07-01", "2027-07-08")).toBe(5);
    expect(addWorkingDays(cal, "2027-07-02", 1)).toBe("2027-07-06");
    expect(workingDayDelta(cal, "2027-07-02", "2027-07-06")).toBe(1);
    expect(workingDayDelta(cal, "2027-07-06", "2027-07-02")).toBe(-1);
  });
});

describe("closed and partial periods (A25)", () => {
  it("a three-day week uses three working days", () => {
    const def = {
      ...defaultCalendarDefinition(),
      exceptions: [
        { id: "a", date: "2027-11-25", kind: "closed" as const, hours: null, start: null, label: "Thanksgiving" },
        { id: "b", date: "2027-11-26", kind: "closed" as const, hours: null, start: null, label: "Day after Thanksgiving" },
      ],
    };
    const data = emptyPlan({ nodes: [node("pool", null)], entries: [week("pool", "2027-11-22", 8)], leadership: [leader("pm", "t", "Tyler", "Project manager", "2027-11-22", "2027-11-26")] }, def);
    const w = computeMeasures(data, "2027-11-22", "2027-11-22").weeks[0];
    expect(w.openDays).toBe(3);
    expect(w.calendarHours).toBe(24);
    expect(w.installerHours).toBe(8 * 3 * 8);
    expect(w.leadershipHours).toBe(24);
    expect(w.averageEquivalent).toBe(9);
  });

  it("a fully closed week has zero hours and no equivalent-staffing division error", () => {
    const shutdown = ["2027-12-27", "2027-12-28", "2027-12-29", "2027-12-30", "2027-12-31"];
    const closedWeek = shutdown.map((date, i) => ({ id: `c${i}`, date, kind: "closed" as const, hours: null, start: null, label: "Shutdown" }));
    const def = { ...defaultCalendarDefinition(), exceptions: closedWeek };
    const data = emptyPlan({ nodes: [node("pool", null)], entries: [week("pool", "2027-12-27", 8)], leadership: [leader("pm", "t", "Tyler", "Project manager", "2027-12-27", "2027-12-31")] }, def);
    const w = computeMeasures(data, "2027-12-27", "2027-12-27").weeks[0];
    expect(w.openDays).toBe(0);
    expect(w.calendarHours).toBe(0);
    expect(w.totalHours).toBe(0);
    expect(w.totalPeak).toBe(0);
    expect(w.averageEquivalent).toBeNull();
  });

  it("overnight shift hours fall into the correct reporting dates and weeks", () => {
    // Sunday 13 June 2027 22:00 to Monday 06:00: 2 h on Sunday (week of 7 Jun), 6 h on Monday (week of 14 Jun).
    const data = emptyPlan({ nodes: [node("pool", null)], entries: [block("pool", "2027-06-13", "22:00", "06:00", 4)] });
    const m = computeMeasures(data, "2027-06-07", "2027-06-14", {}, { days: true });
    expect(m.weeks.map((w) => w.installerHours)).toEqual([8, 24]);
    expect(m.days.find((d) => d.start === "2027-06-13")!.installerHours).toBe(8);
    expect(m.days.find((d) => d.start === "2027-06-14")!.installerHours).toBe(24);
    // The block keeps its shift-start date.
    const blocks = expandAllNodes(data).get("pool")!;
    expect(blocks[0].shiftDate).toBe("2027-06-13");
    expect(m.weeks[0].installerPeak).toBe(4);
    expect(m.weeks[1].installerPeak).toBe(4);
  });
});

describe("daylight-saving transitions", () => {
  it("resolves wall-clock times on both sides of the transitions", () => {
    // 2027 US DST: begins 14 March, ends 7 November.
    expect(zonedTimeToEpochMs("2027-03-13", "07:00", NY)).toBe(Date.UTC(2027, 2, 13, 12, 0));
    expect(zonedTimeToEpochMs("2027-03-15", "07:00", NY)).toBe(Date.UTC(2027, 2, 15, 11, 0));
    // Nonexistent 02:30 on 14 March resolves after the gap.
    expect(epochMsToZonedTime(zonedTimeToEpochMs("2027-03-14", "02:30", NY), NY)).toBe("03:30");
    // Ambiguous 01:30 on 7 November resolves to the first occurrence (EDT).
    expect(zonedTimeToEpochMs("2027-11-07", "01:30", NY)).toBe(Date.UTC(2027, 10, 7, 5, 30));
  });

  it("an overnight shift across fall-back has nine elapsed hours; spring-forward has seven", () => {
    const fall = emptyPlan({ nodes: [node("pool", null)], entries: [block("pool", "2027-11-06", "22:00", "06:00", 1)] });
    const spring = emptyPlan({ nodes: [node("pool", null)], entries: [block("pool", "2027-03-13", "22:00", "06:00", 1)] });
    const hours = (d: typeof fall) => computeMeasures(d, "2027-01-01", "2027-12-31").totals.installerHours;
    expect(hours(fall)).toBe(9);
    expect(hours(spring)).toBe(7);
  });

  it("day shifts keep their configured length across the transition week", () => {
    const data = emptyPlan({ nodes: [node("pool", null)], entries: [week("pool", "2027-03-08", 8), week("pool", "2027-03-15", 8)] });
    const m = computeMeasures(data, "2027-03-08", "2027-03-15");
    expect(m.weeks.map((w) => w.installerHours)).toEqual([320, 320]);
  });
});
