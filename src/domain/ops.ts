/**
 * Serializable plan operations. Every plan edit is a list of these ops,
 * applied by the same pure function in the browser (optimistic preview) and
 * on the server (authoritative, inside one transaction with a revision
 * check), followed by the same blocking validation. That keeps previews,
 * saves, and reports on one set of rules.
 */

import { z } from "zod";
import { calendarDefinitionSchema, CalendarResolver, addWorkingDays, nextWorkingDay, type CalendarInput } from "./calendar";
import { addDays, eachDay, isISODate, isoWeekday, startOfWeek, type ISODate } from "./dates";
import { buildTree, checkCapacity, descendants, overlappingBlocksOnRow, validateStructure, type CapacityViolation } from "./capacity";
import type { ActivityInput, EntryInput, LeadershipInput, NodeInput, PlanData } from "./plan";
import { entryId, entrySlot } from "./plan";
import { findCycle } from "./schedule";
import { expandAllNodes, nodeCalendarKey, resolverFor } from "./staffing";
import { isTimeOfDay, isValidTimeZone } from "./tz";

const isoDate = z.string().refine(isISODate, "Expected a date (YYYY-MM-DD)");
const timeOfDay = z.string().refine(isTimeOfDay, "Expected a time (HH:MM)");
const key = z.string().min(1).max(100);
const id = z.string().min(1).max(100);
const headcount = z.number().int("Headcount must be a whole number of people").min(0, "Headcount cannot be negative").max(10_000);
const text = (max: number) => z.string().max(max);

export const nodeSchema = z.object({
  key,
  parentKey: key.nullable(),
  kind: z.enum(["POOL", "RESERVATION", "CREW"]),
  name: text(200).min(1, "Name is required"),
  role: text(80).min(1),
  phaseId: id.nullable(),
  areaId: id.nullable(),
  systemId: id.nullable(),
  activityKey: key.nullable(),
  calendarKey: key.nullable(),
  notes: text(4000).nullable(),
  sortOrder: z.number().int(),
});

export const activitySchema = z.object({
  key,
  code: text(40),
  name: text(300).min(1, "Activity name is required"),
  phaseId: id.nullable(),
  areaId: id.nullable(),
  systemId: id.nullable(),
  calendarKey: key.nullable(),
  plannedStart: isoDate,
  plannedFinish: isoDate,
  notes: text(4000).nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
});

const dayOverrideSchema = z.object({
  date: isoDate,
  kind: z.enum(["offsite", "onsite", "hours"]),
  hours: z.number().gt(0).max(24).nullable(),
  start: timeOfDay.nullable(),
});

export const leadershipSchema = z.object({
  key,
  personId: id.nullable(),
  personName: text(200).min(1),
  role: text(80).min(1, "Role is required"),
  responsibilitySystemIds: z.array(id),
  responsibilityPhaseIds: z.array(id),
  responsibilityNote: text(1000).nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  onsiteMode: z.enum(["PROJECT_CALENDAR", "WEEKDAYS"]),
  onsiteWeekdays: z.array(z.number().int().min(1).max(7)),
  onsiteHours: z.number().gt(0).max(24).nullable(),
  onsiteStart: timeOfDay.nullable(),
  offsiteHoursPerWeek: z.number().min(0).max(168).nullable(),
  dayOverrides: z.array(dayOverrideSchema),
  notes: text(4000).nullable(),
  sortOrder: z.number().int(),
});

export const calendarInputSchema = z.object({
  key,
  name: text(120).min(1),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
  isDefault: z.boolean(),
  definition: calendarDefinitionSchema,
});

const blockInput = z.object({ startTime: timeOfDay, endTime: timeOfDay, headcount, label: text(80).nullable().optional() });

export const planOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setWeeks"), nodeKey: key, values: z.array(z.object({ week: isoDate, headcount: headcount.nullable() })).max(600) }),
  z.object({
    type: z.literal("setDay"),
    nodeKey: key,
    date: isoDate,
    headcount: headcount.nullable(),
    hours: z.number().gt(0).max(24).nullable().optional(),
    startTime: timeOfDay.nullable().optional(),
    label: text(80).nullable().optional(),
  }),
  z.object({ type: z.literal("setBlocks"), nodeKey: key, date: isoDate, blocks: z.array(blockInput).max(12) }),
  z.object({ type: z.literal("clearOverrides"), nodeKey: key, from: isoDate, to: isoDate }),
  z.object({ type: z.literal("increaseWorkforce"), nodeKey: key, values: z.array(z.object({ week: isoDate, add: z.number().int().min(1).max(10_000) })).min(1).max(600) }),
  z.object({ type: z.literal("addNode"), node: nodeSchema }),
  z.object({
    type: z.literal("updateNode"),
    key,
    patch: nodeSchema.pick({ name: true, role: true, phaseId: true, areaId: true, systemId: true, activityKey: true, calendarKey: true, notes: true, sortOrder: true }).partial().extend({ kind: z.enum(["RESERVATION", "CREW"]).optional() }),
  }),
  z.object({ type: z.literal("removeNode"), key }),
  z.object({ type: z.literal("releaseNode"), key, from: isoDate }),
  z.object({ type: z.literal("splitCrew"), key, newKey: key, name: text(200).min(1), headcount: headcount.min(1), from: isoDate, to: isoDate }),
  z.object({
    type: z.literal("shiftNodeEntries"),
    key,
    includeDescendants: z.boolean(),
    from: isoDate.nullable(),
    to: isoDate.nullable(),
    mode: z.enum(["weeks", "workingDays"]),
    amount: z.number().int().min(-520).max(520),
  }),
  z.object({ type: z.literal("addActivity"), activity: activitySchema }),
  z.object({ type: z.literal("updateActivity"), key, patch: activitySchema.omit({ key: true }).partial() }),
  z.object({ type: z.literal("setActivityDates"), key, start: isoDate, finish: isoDate }),
  z.object({ type: z.literal("addLink"), predecessorKey: key, successorKey: key, lagDays: z.number().int().min(0).max(365) }),
  z.object({ type: z.literal("updateLink"), predecessorKey: key, successorKey: key, lagDays: z.number().int().min(0).max(365) }),
  z.object({ type: z.literal("removeLink"), predecessorKey: key, successorKey: key }),
  z.object({ type: z.literal("linkMilestone"), activityKey: key, milestoneId: id }),
  z.object({ type: z.literal("unlinkMilestone"), activityKey: key, milestoneId: id }),
  z.object({ type: z.literal("setCalendar"), calendar: calendarInputSchema }),
  z.object({ type: z.literal("removeCalendar"), key }),
  z.object({ type: z.literal("upsertLeadership"), assignment: leadershipSchema }),
  z.object({ type: z.literal("removeLeadership"), key }),
  z.object({ type: z.literal("shiftLeadership"), key, days: z.number().int().min(-3650).max(3650) }),
  z.object({ type: z.literal("setPhaseWindow"), phaseId: id, start: isoDate.nullable(), finish: isoDate.nullable(), note: text(1000).nullable() }),
]);

export type PlanOp = z.infer<typeof planOpSchema>;
export const planOpsSchema = z.array(planOpSchema).min(1).max(2000);

export class PlanOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanOpError";
  }
}

function requireNode(data: PlanData, k: string): NodeInput {
  const n = data.nodes.find((x) => x.key === k);
  if (!n) throw new PlanOpError("That staffing row no longer exists. Reload to see the latest plan.");
  return n;
}

function requireActivity(data: PlanData, k: string): ActivityInput {
  const a = data.activities.find((x) => x.key === k);
  if (!a) throw new PlanOpError("That activity no longer exists. Reload to see the latest plan.");
  return a;
}

function upsertEntry(data: PlanData, e: EntryInput) {
  const k = entryId(e);
  const i = data.entries.findIndex((x) => entryId(x) === k);
  if (i >= 0) data.entries[i] = e;
  else data.entries.push(e);
}

function removeEntries(data: PlanData, pred: (e: EntryInput) => boolean) {
  data.entries = data.entries.filter((e) => !pred(e));
}

function weekEntry(nodeKey: string, week: ISODate, n: number): EntryInput {
  return { nodeKey, kind: "WEEK", date: week, headcount: n, hours: null, startTime: null, endTime: null, label: null };
}

export function nextActivityCode(data: PlanData): string {
  let max = 0;
  for (const a of data.activities) {
    const m = /^A-(\d+)$/.exec(a.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `A-${String(max + 1).padStart(4, "0")}`;
}

function nodeResolver(data: PlanData, n: NodeInput): CalendarResolver {
  return resolverFor(data, nodeCalendarKey(data, n));
}

/** Shift one node's entries in [from, to] by weeks or working days. */
function shiftEntriesOf(data: PlanData, n: NodeInput, from: ISODate | null, to: ISODate | null, mode: "weeks" | "workingDays", amount: number) {
  if (amount === 0) return;
  const inRange = (d: ISODate) => (!from || d >= from) && (!to || d <= to);
  const moving = data.entries.filter((e) => e.nodeKey === n.key && inRange(e.date));
  if (!moving.length) return;
  removeEntries(data, (e) => moving.includes(e));
  const shifted: EntryInput[] = [];
  if (mode === "weeks") {
    for (const e of moving) shifted.push({ ...e, date: addDays(e.date, amount * 7) });
  } else {
    const cal = nodeResolver(data, n);
    const shiftDate = (d: ISODate) => addWorkingDays(cal, nextWorkingDay(cal, d, true), amount);
    for (const e of moving) {
      if (e.kind === "WEEK") {
        // Materialize the week into its open days so each resource-day moves exactly.
        for (let i = 0; i < 7; i++) {
          const d = addDays(e.date, i);
          if (!cal.isWorkingDay(d) || e.headcount <= 0) continue;
          shifted.push({ nodeKey: e.nodeKey, kind: "DAY", date: shiftDate(d), headcount: e.headcount, hours: null, startTime: null, endTime: null, label: null });
        }
      } else {
        shifted.push({ ...e, date: shiftDate(e.date) });
      }
    }
  }
  for (const e of shifted) upsertEntry(data, e);
}

/** Apply one op in place. Throws PlanOpError for impossible requests. */
export function applyOp(data: PlanData, op: PlanOp): void {
  switch (op.type) {
    case "setWeeks": {
      requireNode(data, op.nodeKey);
      for (const v of op.values) {
        if (isoWeekday(v.week) !== 1) throw new PlanOpError(`Week ${v.week} must start on a Monday`);
        if (v.headcount === null) removeEntries(data, (e) => e.nodeKey === op.nodeKey && e.kind === "WEEK" && e.date === v.week);
        else upsertEntry(data, weekEntry(op.nodeKey, v.week, v.headcount));
      }
      return;
    }
    case "setDay": {
      requireNode(data, op.nodeKey);
      if (op.headcount === null) {
        removeEntries(data, (e) => e.nodeKey === op.nodeKey && e.kind === "DAY" && e.date === op.date);
      } else {
        upsertEntry(data, { nodeKey: op.nodeKey, kind: "DAY", date: op.date, headcount: op.headcount, hours: op.hours ?? null, startTime: op.startTime ?? null, endTime: null, label: op.label ?? null });
      }
      return;
    }
    case "setBlocks": {
      requireNode(data, op.nodeKey);
      removeEntries(data, (e) => e.nodeKey === op.nodeKey && e.kind === "BLOCK" && e.date === op.date);
      for (const b of op.blocks) {
        if (b.startTime === b.endTime) throw new PlanOpError("A time block must have different start and end times");
        upsertEntry(data, { nodeKey: op.nodeKey, kind: "BLOCK", date: op.date, headcount: b.headcount, hours: null, startTime: b.startTime, endTime: b.endTime, label: b.label ?? null });
      }
      return;
    }
    case "clearOverrides": {
      requireNode(data, op.nodeKey);
      removeEntries(data, (e) => e.nodeKey === op.nodeKey && e.kind !== "WEEK" && e.date >= op.from && e.date <= op.to);
      return;
    }
    case "increaseWorkforce": {
      const n = requireNode(data, op.nodeKey);
      if (n.kind !== "POOL") throw new PlanOpError("Workforce can only be increased on a workforce pool");
      for (const v of op.values) {
        const current = data.entries.find((e) => e.nodeKey === n.key && e.kind === "WEEK" && e.date === v.week)?.headcount ?? 0;
        upsertEntry(data, weekEntry(n.key, v.week, current + v.add));
        // Day overrides in that week carry their own counts; raise them too.
        for (const e of data.entries) {
          if (e.nodeKey === n.key && e.kind !== "WEEK" && startOfWeek(e.date) === v.week && e.headcount > 0) e.headcount += v.add;
        }
      }
      return;
    }
    case "addNode": {
      if (data.nodes.some((n) => n.key === op.node.key)) throw new PlanOpError("A row with this key already exists");
      if (op.node.parentKey) requireNode(data, op.node.parentKey);
      data.nodes.push({ ...op.node });
      return;
    }
    case "updateNode": {
      const n = requireNode(data, op.key);
      if (op.patch.kind && n.kind === "POOL") throw new PlanOpError("A workforce pool cannot become a reservation");
      Object.assign(n, op.patch);
      return;
    }
    case "removeNode": {
      const n = requireNode(data, op.key);
      const tree = buildTree(data.nodes);
      const doomed = new Set([n.key, ...descendants(tree, n.key)]);
      if (n.kind === "POOL" && data.entries.some((e) => doomed.has(e.nodeKey) && e.headcount > 0)) {
        throw new PlanOpError("Remove this pool's staffing before deleting the pool; deleting capacity must be explicit");
      }
      data.nodes = data.nodes.filter((x) => !doomed.has(x.key));
      removeEntries(data, (e) => doomed.has(e.nodeKey));
      return;
    }
    case "releaseNode": {
      const n = requireNode(data, op.key);
      if (n.kind === "POOL") throw new PlanOpError("A pool is the shared workforce; release a reservation or crew instead");
      const tree = buildTree(data.nodes);
      const affected = new Set([n.key, ...descendants(tree, n.key)]);
      // Weeks that straddle the release date keep their days before it as day entries.
      const straddling = data.entries.filter((x) => affected.has(x.nodeKey) && x.kind === "WEEK" && x.date < op.from && addDays(x.date, 6) >= op.from);
      const kept: EntryInput[] = [];
      for (const e of straddling) {
        const cal = nodeResolver(data, requireNode(data, e.nodeKey));
        for (const d of eachDay(e.date, addDays(op.from, -1))) {
          if (cal.isWorkingDay(d) && !data.entries.some((x) => x.nodeKey === e.nodeKey && x.kind !== "WEEK" && x.date === d)) {
            kept.push({ nodeKey: e.nodeKey, kind: "DAY", date: d, headcount: e.headcount, hours: null, startTime: null, endTime: null, label: null });
          }
        }
      }
      removeEntries(data, (e) => affected.has(e.nodeKey) && (straddling.includes(e) || e.date >= op.from));
      data.entries.push(...kept);
      return;
    }
    case "splitCrew": {
      const crew = requireNode(data, op.key);
      if (crew.kind === "POOL") throw new PlanOpError("Split a crew or reservation, not the pool");
      if (data.nodes.some((n) => n.key === op.newKey)) throw new PlanOpError("A row with this key already exists");
      data.nodes.push({ ...crew, key: op.newKey, name: op.name, sortOrder: crew.sortOrder + 1 });
      for (const e of data.entries.filter((x) => x.nodeKey === crew.key && x.date >= startOfWeek(op.from) && x.date <= op.to)) {
        if (e.kind === "WEEK" && (e.date < op.from || addDays(e.date, 6) > op.to)) {
          throw new PlanOpError("Choose a split range that covers whole weeks of weekly staffing, or enter day values first");
        }
        if (e.date < op.from) continue;
        if (e.headcount < op.headcount) throw new PlanOpError(`The crew has only ${e.headcount} people on ${e.date}; cannot move ${op.headcount}`);
        e.headcount -= op.headcount;
        data.entries.push({ ...e, nodeKey: op.newKey, headcount: op.headcount });
      }
      return;
    }
    case "shiftNodeEntries": {
      const n = requireNode(data, op.key);
      const keys = op.includeDescendants ? [n.key, ...descendants(buildTree(data.nodes), n.key)] : [n.key];
      for (const k of keys) shiftEntriesOf(data, requireNode(data, k), op.from, op.to, op.mode, op.amount);
      return;
    }
    case "addActivity": {
      if (data.activities.some((a) => a.key === op.activity.key)) throw new PlanOpError("An activity with this key already exists");
      const code = op.activity.code.trim() || nextActivityCode(data);
      data.activities.push({ ...op.activity, code });
      return;
    }
    case "updateActivity": {
      const a = requireActivity(data, op.key);
      Object.assign(a, op.patch);
      if (op.patch.code !== undefined && !a.code.trim()) a.code = nextActivityCode(data);
      return;
    }
    case "setActivityDates": {
      const a = requireActivity(data, op.key);
      a.plannedStart = op.start;
      a.plannedFinish = op.finish;
      return;
    }
    case "addLink": {
      requireActivity(data, op.predecessorKey);
      requireActivity(data, op.successorKey);
      if (data.links.some((l) => l.predecessorKey === op.predecessorKey && l.successorKey === op.successorKey)) throw new PlanOpError("These activities are already linked");
      data.links.push({ predecessorKey: op.predecessorKey, successorKey: op.successorKey, lagDays: op.lagDays });
      return;
    }
    case "updateLink": {
      const l = data.links.find((x) => x.predecessorKey === op.predecessorKey && x.successorKey === op.successorKey);
      if (!l) throw new PlanOpError("That link no longer exists");
      l.lagDays = op.lagDays;
      return;
    }
    case "removeLink": {
      data.links = data.links.filter((x) => !(x.predecessorKey === op.predecessorKey && x.successorKey === op.successorKey));
      return;
    }
    case "linkMilestone": {
      requireActivity(data, op.activityKey);
      if (!data.milestones.some((m) => m.id === op.milestoneId)) throw new PlanOpError("That milestone no longer exists");
      if (!data.activityMilestones.some((x) => x.activityKey === op.activityKey && x.milestoneId === op.milestoneId)) {
        data.activityMilestones.push({ activityKey: op.activityKey, milestoneId: op.milestoneId });
      }
      return;
    }
    case "unlinkMilestone": {
      data.activityMilestones = data.activityMilestones.filter((x) => !(x.activityKey === op.activityKey && x.milestoneId === op.milestoneId));
      return;
    }
    case "setCalendar": {
      const c: CalendarInput = { ...op.calendar };
      const i = data.calendars.findIndex((x) => x.key === c.key);
      if (c.isDefault) for (const x of data.calendars) x.isDefault = false;
      if (i >= 0) data.calendars[i] = c;
      else data.calendars.push(c);
      return;
    }
    case "removeCalendar": {
      const c = data.calendars.find((x) => x.key === op.key);
      if (!c) return;
      if (c.isDefault) throw new PlanOpError("The project calendar cannot be removed");
      if (data.nodes.some((n) => n.calendarKey === op.key) || data.activities.some((a) => a.calendarKey === op.key)) {
        throw new PlanOpError("Calendar is still used by a crew or activity");
      }
      data.calendars = data.calendars.filter((x) => x.key !== op.key);
      return;
    }
    case "upsertLeadership": {
      const i = data.leadership.findIndex((x) => x.key === op.assignment.key);
      const a: LeadershipInput = { ...op.assignment, onsiteWeekdays: [...new Set(op.assignment.onsiteWeekdays)].sort() };
      if (i >= 0) data.leadership[i] = a;
      else data.leadership.push(a);
      return;
    }
    case "removeLeadership": {
      data.leadership = data.leadership.filter((x) => x.key !== op.key);
      return;
    }
    case "shiftLeadership": {
      const l = data.leadership.find((x) => x.key === op.key);
      if (!l) throw new PlanOpError("That leadership assignment no longer exists");
      if (l.startDate) l.startDate = addDays(l.startDate, op.days);
      if (l.endDate) l.endDate = addDays(l.endDate, op.days);
      l.dayOverrides = l.dayOverrides.map((o) => ({ ...o, date: addDays(o.date, op.days) }));
      return;
    }
    case "setPhaseWindow": {
      if (!data.phases.some((p) => p.id === op.phaseId)) throw new PlanOpError("That phase no longer exists");
      data.phaseWindows = data.phaseWindows.filter((w) => w.phaseId !== op.phaseId);
      if (op.start || op.finish || op.note) data.phaseWindows.push({ phaseId: op.phaseId, start: op.start, finish: op.finish, note: op.note });
      return;
    }
  }
}

export function applyOps(data: PlanData, ops: PlanOp[]): PlanData {
  const next = structuredClone(data);
  for (const op of ops) applyOp(next, op);
  return next;
}

export interface BlockingIssue {
  code: string;
  message: string;
  refs: { kind: "node" | "activity" | "link" | "entry" | "leadership" | "calendar"; key: string }[];
  capacity?: CapacityViolation;
}

function violationSignature(v: CapacityViolation): string {
  return `${v.parentKey}|${v.startMs}|${v.endMs}|${v.reserved}|${v.capacity}`;
}

/**
 * Blocking validation of a proposed plan. Capacity violations already
 * present before the edit do not block unrelated edits; any new or worsened
 * over-reservation does.
 */
export function validatePlan(after: PlanData, before?: PlanData): BlockingIssue[] {
  const issues: BlockingIssue[] = [];

  const defaults = after.calendars.filter((c) => c.isDefault);
  if (defaults.length !== 1) issues.push({ code: "calendar.default", message: "The plan needs exactly one project calendar", refs: [] });
  for (const c of after.calendars) {
    const r = calendarInputSchema.safeParse(c);
    if (!r.success) issues.push({ code: "calendar.invalid", message: `Calendar "${c.name}": ${r.error.issues[0]?.message ?? "invalid"}`, refs: [{ kind: "calendar", key: c.key }] });
  }

  const activityKeys = new Set<string>();
  const codes = new Map<string, string>();
  for (const a of after.activities) {
    if (activityKeys.has(a.key)) issues.push({ code: "activity.duplicate", message: `Duplicate activity key ${a.key}`, refs: [{ kind: "activity", key: a.key }] });
    activityKeys.add(a.key);
    if (!isISODate(a.plannedStart) || !isISODate(a.plannedFinish)) {
      issues.push({ code: "activity.date", message: `${a.code || a.name}: invalid date`, refs: [{ kind: "activity", key: a.key }] });
    } else if (a.plannedFinish < a.plannedStart) {
      issues.push({ code: "activity.finishBeforeStart", message: `${a.code} ${a.name}: finish ${a.plannedFinish} is before start ${a.plannedStart}`, refs: [{ kind: "activity", key: a.key }] });
    }
    if (!a.name.trim()) issues.push({ code: "activity.name", message: "Activity name is required", refs: [{ kind: "activity", key: a.key }] });
    const other = codes.get(a.code);
    if (other && other !== a.key) issues.push({ code: "activity.code", message: `Activity ID ${a.code} is used twice`, refs: [{ kind: "activity", key: a.key }] });
    codes.set(a.code, a.key);
    if (a.calendarKey && !after.calendars.some((c) => c.key === a.calendarKey)) issues.push({ code: "activity.calendar", message: `${a.code}: calendar not found`, refs: [{ kind: "activity", key: a.key }] });
  }

  const linkSeen = new Set<string>();
  for (const l of after.links) {
    const k = `${l.predecessorKey}>${l.successorKey}`;
    if (linkSeen.has(k)) issues.push({ code: "link.duplicate", message: "Duplicate activity link", refs: [{ kind: "link", key: k }] });
    linkSeen.add(k);
    if (!activityKeys.has(l.predecessorKey) || !activityKeys.has(l.successorKey)) issues.push({ code: "link.missing", message: "A link refers to a missing activity", refs: [{ kind: "link", key: k }] });
    if (l.predecessorKey === l.successorKey) issues.push({ code: "link.self", message: "An activity cannot depend on itself", refs: [{ kind: "link", key: k }] });
  }
  const cycle = findCycle(after.links);
  if (cycle) {
    const names = new Map(after.activities.map((a) => [a.key, a.code]));
    issues.push({ code: "link.cycle", message: `Circular dependency: ${cycle.map((k) => names.get(k) ?? k).join(" → ")}`, refs: cycle.map((k) => ({ kind: "activity" as const, key: k })) });
  }

  const tree = buildTree(after.nodes);
  for (const s of validateStructure(after, tree)) issues.push({ code: "node.structure", message: s.message, refs: [{ kind: "node", key: s.nodeKey }] });

  const nodeKeys = new Set(after.nodes.map((n) => n.key));
  const entrySeen = new Set<string>();
  for (const e of after.entries) {
    const ref = { kind: "entry" as const, key: entryId(e) };
    if (!nodeKeys.has(e.nodeKey)) issues.push({ code: "entry.node", message: "Staffing refers to a missing row", refs: [ref] });
    if (entrySeen.has(ref.key)) issues.push({ code: "entry.duplicate", message: `Duplicate staffing entry ${ref.key}`, refs: [ref] });
    entrySeen.add(ref.key);
    if (!Number.isInteger(e.headcount) || e.headcount < 0) issues.push({ code: "entry.headcount", message: "People counts must be whole numbers of zero or more", refs: [ref] });
    if (e.kind === "WEEK" && isoWeekday(e.date) !== 1) issues.push({ code: "entry.week", message: `Weekly staffing must start on a Monday (${e.date})`, refs: [ref] });
    if (e.kind === "BLOCK" && (!e.startTime || !e.endTime || e.startTime === e.endTime)) issues.push({ code: "entry.block", message: "Time blocks need different start and end times", refs: [ref] });
    if (e.hours !== null && (e.hours <= 0 || e.hours > 24)) issues.push({ code: "entry.hours", message: "Hours must be above 0 and at most 24", refs: [ref] });
    if (entrySlot(e) !== (e.kind === "BLOCK" ? e.startTime ?? "" : "")) issues.push({ code: "entry.slot", message: "Invalid staffing slot", refs: [ref] });
  }
  for (const o of overlappingBlocksOnRow(after)) issues.push({ code: "entry.overlap", message: o.message, refs: [{ kind: "node", key: o.nodeKey }] });

  for (const l of after.leadership) {
    const ref = { kind: "leadership" as const, key: l.key };
    const r = leadershipSchema.safeParse(l);
    if (!r.success) issues.push({ code: "leadership.invalid", message: `${l.personName} (${l.role}): ${r.error.issues[0]?.message}`, refs: [ref] });
    if (l.startDate && l.endDate && l.endDate < l.startDate) issues.push({ code: "leadership.dates", message: `${l.personName} (${l.role}): end date is before start date`, refs: [ref] });
    if ((l.startDate === null) !== (l.endDate === null)) issues.push({ code: "leadership.dates", message: `${l.personName} (${l.role}): select both start and end dates, or neither`, refs: [ref] });
  }

  if (!issues.some((i) => i.code === "node.structure" || i.code === "calendar.default" || i.code === "calendar.invalid")) {
    const afterV = checkCapacity(after, expandAllNodes(after), tree);
    let beforeSigs = new Set<string>();
    if (before) {
      try {
        beforeSigs = new Set(checkCapacity(before, expandAllNodes(before)).map(violationSignature));
      } catch {
        beforeSigs = new Set();
      }
    }
    const names = new Map(after.nodes.map((n) => [n.key, n.name]));
    for (const v of afterV) {
      if (beforeSigs.has(violationSignature(v))) continue;
      issues.push({
        code: "capacity.exceeded",
        message: `Over capacity in "${v.parentName}" on ${v.date} ${v.timeRange}: ${v.reserved} reserved by ${v.childKeys.map((k) => `"${names.get(k) ?? k}"`).join(", ")} but only ${v.capacity} available. Reduce the reservation, move it, or explicitly increase the workforce.`,
        refs: [{ kind: "node", key: v.parentKey }, ...v.childKeys.map((k) => ({ kind: "node" as const, key: k }))],
        capacity: v,
      });
    }
  }
  return issues;
}

export class PlanValidationError extends Error {
  constructor(readonly issues: BlockingIssue[]) {
    super(issues.map((i) => i.message).join("\n"));
    this.name = "PlanValidationError";
  }
}

/** Apply ops and validate; throws PlanOpError or PlanValidationError. */
export function applyAndValidate(data: PlanData, ops: PlanOp[]): PlanData {
  const next = applyOps(data, ops);
  const issues = validatePlan(next, data);
  if (issues.length) throw new PlanValidationError(issues);
  return next;
}
