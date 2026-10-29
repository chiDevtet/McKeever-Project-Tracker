/**
 * PlanData is the single in-memory shape of a project plan consumed by the
 * domain engine. The server builds it from the database, scenarios and
 * snapshots store it, screens preview edits against it, and reports render
 * from a frozen copy. Plan-scoped records reference each other by lineage
 * `key`; project structure (phases, areas, systems, milestones, people) is
 * referenced by its stable database id.
 */

import type { CalendarInput } from "./calendar";
import type { ISODate } from "./dates";

export const PLAN_DATA_SCHEMA_VERSION = 1;

export type NodeKind = "POOL" | "RESERVATION" | "CREW";
export type EntryKind = "WEEK" | "DAY" | "BLOCK";
export type OnsiteMode = "PROJECT_CALENDAR" | "WEEKDAYS";
export type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "ON_HOLD";
export type AreaKind = "BUILDING" | "ROMP" | "DATA_HALL" | "ROOM" | "ZONE" | "OTHER";

export interface ProjectInfo {
  id: string;
  code: string;
  name: string;
  status: string;
  timezone: string;
  workspaceName: string;
  customer: string | null;
  generalContractor: string | null;
  owner: string | null;
}

export interface PlanInfo {
  id: string;
  kind: "WORKING" | "SCENARIO";
  name: string;
  revision: number;
  basedOnRevision: number | null;
}

export interface PhaseInfo {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  areaIds: string[];
}

export interface PhaseWindowInput {
  phaseId: string;
  start: ISODate | null;
  finish: ISODate | null;
  note: string | null;
}

export interface AreaInfo {
  id: string;
  parentId: string | null;
  kind: AreaKind;
  name: string;
  code: string | null;
  sortOrder: number;
}

export interface SystemInfo {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  sourceAliases: string[];
}

export interface MilestoneInfo {
  id: string;
  phaseId: string | null;
  code: string;
  name: string;
  /** Adopted working date; null until reviewed. */
  date: ISODate | null;
  reviewStatus: "NEEDS_REVIEW" | "CONFIRMED";
  candidates: { id: string; label: string; date: ISODate | null; sourceDate: ISODate | null }[];
}

export interface ActivityInput {
  key: string;
  code: string;
  name: string;
  phaseId: string | null;
  areaId: string | null;
  /** null = Shared systems. */
  systemId: string | null;
  calendarKey: string | null;
  plannedStart: ISODate;
  plannedFinish: ISODate;
  /** Optional cost code reference. */
  costCode?: string | null;
  notes: string | null;
  sortOrder: number;
  archived: boolean;
}

export interface LinkInput {
  predecessorKey: string;
  successorKey: string;
  lagDays: number;
}

export interface ActivityMilestoneInput {
  activityKey: string;
  milestoneId: string;
}

export interface NodeInput {
  key: string;
  parentKey: string | null;
  kind: NodeKind;
  name: string;
  role: string;
  phaseId: string | null;
  areaId: string | null;
  systemId: string | null;
  activityKey: string | null;
  calendarKey: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface EntryInput {
  nodeKey: string;
  kind: EntryKind;
  /** WEEK: Monday of the week. DAY: the date. BLOCK: shift-start date. */
  date: ISODate;
  headcount: number;
  /** DAY only: hours override (null = calendar hours). */
  hours: number | null;
  /** BLOCK: local start; DAY: optional start override. */
  startTime: string | null;
  /** BLOCK: local end; end <= start means the next day. */
  endTime: string | null;
  label: string | null;
}

export interface DayOverride {
  date: ISODate;
  kind: "offsite" | "onsite" | "hours";
  hours: number | null;
  start: string | null;
}

export interface LeadershipInput {
  key: string;
  /** null = explicit TBD placeholder. */
  personId: string | null;
  personName: string;
  role: string;
  responsibilitySystemIds: string[];
  responsibilityPhaseIds: string[];
  responsibilityNote: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  onsiteMode: OnsiteMode;
  onsiteWeekdays: number[];
  onsiteHours: number | null;
  onsiteStart: string | null;
  offsiteHoursPerWeek: number | null;
  dayOverrides: DayOverride[];
  notes: string | null;
  sortOrder: number;
}

export interface ProgressInput {
  activityKey: string;
  status: ProgressStatus;
  actualStart: ISODate | null;
  actualFinish: ISODate | null;
  percentComplete: number | null;
  holdReason: string | null;
  holdReviewDate: ISODate | null;
}

export interface SourceWindow {
  activityKey: string;
  lineageId: string;
  lineageName: string;
  externalId: string;
  versionLabel: string;
  name: string;
  start: ISODate | null;
  finish: ISODate | null;
  removed: boolean;
}

export interface PlanData {
  schemaVersion: number;
  project: ProjectInfo;
  plan: PlanInfo;
  calendars: CalendarInput[];
  phases: PhaseInfo[];
  phaseWindows: PhaseWindowInput[];
  areas: AreaInfo[];
  systems: SystemInfo[];
  milestones: MilestoneInfo[];
  activities: ActivityInput[];
  links: LinkInput[];
  activityMilestones: ActivityMilestoneInput[];
  nodes: NodeInput[];
  entries: EntryInput[];
  leadership: LeadershipInput[];
  progress: ProgressInput[];
  sourceWindows: SourceWindow[];
}

export function defaultCalendar(data: PlanData): CalendarInput {
  const cal = data.calendars.find((c) => c.isDefault) ?? data.calendars[0];
  if (!cal) throw new Error("The plan has no working calendar");
  return cal;
}

export function calendarByKey(data: PlanData, key: string | null | undefined): CalendarInput {
  if (key) {
    const cal = data.calendars.find((c) => c.key === key);
    if (cal) return cal;
  }
  return defaultCalendar(data);
}

export function entrySlot(e: Pick<EntryInput, "kind" | "startTime">): string {
  return e.kind === "BLOCK" ? (e.startTime ?? "") : "";
}

export function entryId(e: Pick<EntryInput, "nodeKey" | "kind" | "date" | "startTime">): string {
  return `${e.nodeKey}|${e.kind}|${e.date}|${entrySlot(e)}`;
}

export function clonePlanData(data: PlanData): PlanData {
  return structuredClone(data);
}

/** Leadership dedup key: a named person counts once; each TBD is distinct. */
export function personKey(l: Pick<LeadershipInput, "personId" | "key">): string {
  return l.personId ? `person:${l.personId}` : `tbd:${l.key}`;
}
