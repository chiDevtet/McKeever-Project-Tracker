import { defaultCalendarDefinition, type CalendarDefinition } from "@/domain/calendar";
import type { EntryInput, LeadershipInput, NodeInput, PlanData } from "@/domain/plan";
import { PLAN_DATA_SCHEMA_VERSION } from "@/domain/plan";

/** Minimal PlanData for engine tests. Illustrative data only. */
export function emptyPlan(overrides: Partial<PlanData> = {}, calendar: CalendarDefinition = defaultCalendarDefinition()): PlanData {
  return {
    schemaVersion: PLAN_DATA_SCHEMA_VERSION,
    project: { id: "p1", code: "TEST", name: "Test project", status: "ACTIVE", timezone: "America/New_York", workspaceName: "Test workspace", customer: null, generalContractor: null, owner: null },
    plan: { id: "plan1", kind: "WORKING", name: "Working plan", revision: 1, basedOnRevision: null },
    calendars: [{ key: "project", name: "Project calendar", timezone: "America/New_York", isDefault: true, definition: calendar }],
    phases: [],
    phaseWindows: [],
    areas: [],
    systems: [],
    milestones: [],
    activities: [],
    links: [],
    activityMilestones: [],
    nodes: [],
    entries: [],
    leadership: [],
    progress: [],
    sourceWindows: [],
    ...overrides,
  };
}

export function node(key: string, parentKey: string | null, extra: Partial<NodeInput> = {}): NodeInput {
  return {
    key,
    parentKey,
    kind: parentKey ? "RESERVATION" : "POOL",
    name: key,
    role: "Installer",
    phaseId: null,
    areaId: null,
    systemId: null,
    activityKey: null,
    calendarKey: null,
    notes: null,
    sortOrder: 0,
    ...extra,
  };
}

export function week(nodeKey: string, date: string, headcount: number): EntryInput {
  return { nodeKey, kind: "WEEK", date, headcount, hours: null, startTime: null, endTime: null, label: null };
}

export function day(nodeKey: string, date: string, headcount: number, hours: number | null = null): EntryInput {
  return { nodeKey, kind: "DAY", date, headcount, hours, startTime: null, endTime: null, label: null };
}

export function block(nodeKey: string, date: string, startTime: string, endTime: string, headcount: number): EntryInput {
  return { nodeKey, kind: "BLOCK", date, headcount, hours: null, startTime, endTime, label: null };
}

export function leader(key: string, personId: string | null, personName: string, role: string, startDate: string | null, endDate: string | null, extra: Partial<LeadershipInput> = {}): LeadershipInput {
  return {
    key,
    personId,
    personName,
    role,
    responsibilitySystemIds: [],
    responsibilityPhaseIds: [],
    responsibilityNote: null,
    startDate,
    endDate,
    onsiteMode: "PROJECT_CALENDAR",
    onsiteWeekdays: [1, 2, 3, 4, 5],
    onsiteHours: null,
    onsiteStart: null,
    offsiteHoursPerWeek: null,
    dayOverrides: [],
    notes: null,
    sortOrder: 0,
    ...extra,
  };
}
