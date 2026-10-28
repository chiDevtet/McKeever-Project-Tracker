/**
 * Move previews. Moving work shows new dates under the selected rule,
 * affected links, staffing and leadership that could move with it, and
 * milestone impacts; only the operator's selected changes become ops.
 * Completed activities keep their actual dates and never move. Project
 * workforce (pools) moves only when explicitly included.
 */

import { workingDaysBetween } from "./calendar";
import { formatDate, type ISODate } from "./dates";
import type { PlanOp } from "./ops";
import type { PlanData } from "./plan";
import { activityCalendar, hasStarted, isCompleted, movedDates, moveDelta, proposeSuccessorMoves, shiftByWeeks, shiftByWorkingDays, type DateWindow, type MoveRule, type SuccessorProposal } from "./schedule";

export type MoveRequest =
  | { kind: "dates"; moves: { key: string; start: ISODate; finish?: ISODate }[]; rule: MoveRule }
  | { kind: "shift"; keys: string[]; amount: number; unit: "workingDays" | "weeks" };

export interface ActivityMove {
  key: string;
  code: string;
  name: string;
  from: DateWindow;
  to: DateWindow;
  durationBefore: number;
  durationAfter: number;
  workingDayDelta: number;
  blocked: string | null;
  note: string | null;
}

export interface StaffingOption {
  nodeKey: string;
  /** Activity this reservation belongs to; for successors it moves only with them. */
  forActivityKey: string | null;
  name: string;
  scope: "activity" | "phase" | "pool";
  amount: number;
  unit: "workingDays" | "weeks";
  defaultSelected: boolean;
  description: string;
}

export interface LeadershipOption {
  key: string;
  label: string;
  days: number;
  defaultSelected: boolean;
}

export interface MilestoneImpact {
  activityKey: string;
  milestoneLabel: string;
  milestoneDate: ISODate;
  newFinish: ISODate;
}

export interface MovePreview {
  rule: MoveRule;
  activities: ActivityMove[];
  successors: SuccessorProposal[];
  staffing: StaffingOption[];
  leadership: LeadershipOption[];
  milestones: MilestoneImpact[];
}

export function buildMovePreview(data: PlanData, req: MoveRequest): MovePreview {
  const acts = new Map(data.activities.map((a) => [a.key, a]));
  const moves: ActivityMove[] = [];
  const rule: MoveRule = req.kind === "dates" ? req.rule : "preserve-working-duration";
  const keys = req.kind === "dates" ? req.moves.map((m) => m.key) : req.keys;
  for (const key of keys) {
    const a = acts.get(key);
    if (!a) continue;
    const cal = activityCalendar(data, a);
    const from = { start: a.plannedStart, finish: a.plannedFinish };
    let to: DateWindow;
    let note: string | null = null;
    let blocked: string | null = null;
    if (req.kind === "dates") {
      const m = req.moves.find((x) => x.key === key)!;
      to = movedDates(data, a, m.start, req.rule, m.finish);
    } else {
      to = req.unit === "weeks" ? shiftByWeeks(data, a, req.amount) : shiftByWorkingDays(data, a, req.amount);
    }
    if (isCompleted(data, key)) {
      blocked = "Complete: actual dates are retained and the activity does not move";
      to = from;
    } else if (hasStarted(data, key) && to.start !== from.start) {
      // Started work keeps its historical start; only the remaining finish moves.
      const finishShift = req.kind === "shift" ? to.finish : (req.moves.find((x) => x.key === key)?.finish ?? to.finish);
      to = { start: from.start, finish: finishShift < from.start ? from.start : finishShift };
      note = "In progress: start retained (actual start recorded); only the finish moves. Split remaining work if it restarts later.";
    }
    if (to.finish < to.start) blocked = "The finish would be before the start";
    moves.push({
      key,
      code: a.code,
      name: a.name,
      from,
      to,
      durationBefore: workingDaysBetween(cal, from.start, from.finish),
      durationAfter: workingDaysBetween(cal, to.start, to.finish),
      workingDayDelta: moveDelta(data, a, to),
      blocked,
      note,
    });
  }

  const changes = new Map(moves.filter((m) => !m.blocked).map((m) => [m.key, m.to]));
  const successors = proposeSuccessorMoves(data, changes).filter((p) => !changes.has(p.key));

  // Staffing that can move: activity reservations (default on), phase reservations (default off), pools (default off).
  const movedKeys = new Set(changes.keys());
  const staffing: StaffingOption[] = [];
  const firstDelta = (k: string) => moves.find((m) => m.key === k)?.workingDayDelta ?? 0;
  const unit: "workingDays" | "weeks" = req.kind === "shift" && req.unit === "weeks" ? "weeks" : "workingDays";
  const amountFor = (k: string) => (unit === "weeks" && req.kind === "shift" ? req.amount : firstDelta(k));
  for (const n of data.nodes) {
    if (n.activityKey && movedKeys.has(n.activityKey)) {
      const amount = amountFor(n.activityKey);
      if (amount !== 0) staffing.push({ nodeKey: n.key, forActivityKey: n.activityKey, name: n.name, scope: "activity", amount, unit, defaultSelected: true, description: `Reserved for ${acts.get(n.activityKey)?.code}` });
    }
  }
  for (const sp of successors) {
    const succ = acts.get(sp.key);
    if (!succ || sp.blockedByCompletion) continue;
    const amount = moveDelta(data, succ, sp.to);
    for (const n of data.nodes.filter((x) => x.activityKey === sp.key && amount !== 0)) {
      staffing.push({ nodeKey: n.key, forActivityKey: sp.key, name: n.name, scope: "activity", amount, unit: "workingDays", defaultSelected: true, description: `Reserved for successor ${sp.code}; moves only if ${sp.code} moves` });
    }
  }
  const phases = new Set([...movedKeys].map((k) => acts.get(k)?.phaseId).filter(Boolean) as string[]);
  const commonAmount = moves.length ? amountFor(moves[0].key) : 0;
  if (commonAmount !== 0) {
    for (const n of data.nodes) {
      if (n.kind !== "POOL" && !n.activityKey && n.phaseId && phases.has(n.phaseId)) {
        staffing.push({ nodeKey: n.key, forActivityKey: null, name: n.name, scope: "phase", amount: commonAmount, unit, defaultSelected: false, description: `Phase-level reservation (${data.phases.find((p) => p.id === n.phaseId)?.name}); moves only if selected` });
      }
    }
    for (const n of data.nodes.filter((x) => x.kind === "POOL")) {
      staffing.push({ nodeKey: n.key, forActivityKey: null, name: n.name, scope: "pool", amount: commonAmount, unit, defaultSelected: false, description: "Project workforce capacity; stays in place unless you include it" });
    }
  }

  const leadership: LeadershipOption[] = [];
  const calDays = moves.length && moves[0].to.start !== moves[0].from.start ? Math.round((Date.parse(moves[0].to.start) - Date.parse(moves[0].from.start)) / 86_400_000) : 0;
  if (calDays !== 0) {
    for (const l of data.leadership) {
      if (l.responsibilityPhaseIds.some((p) => phases.has(p)) && l.startDate) {
        leadership.push({ key: l.key, label: `${l.personName} (${l.role})`, days: calDays, defaultSelected: false });
      }
    }
  }

  const milestones: MilestoneImpact[] = [];
  const allChanges = new Map([...changes, ...successors.map((s) => [s.key, s.to] as const)]);
  for (const link of data.activityMilestones) {
    const to = allChanges.get(link.activityKey);
    const m = data.milestones.find((x) => x.id === link.milestoneId);
    const date = m?.date ?? m?.candidates.find((c) => c.date)?.date ?? null;
    if (to && m && date && to.finish > date) milestones.push({ activityKey: link.activityKey, milestoneLabel: `${m.code} ${m.name}`, milestoneDate: date, newFinish: to.finish });
  }

  return { rule, activities: moves, successors, staffing, leadership, milestones };
}

export interface MoveSelection {
  successorKeys: string[];
  staffingKeys: string[];
  leadershipKeys: string[];
}

export function defaultSelection(p: MovePreview): MoveSelection {
  return {
    successorKeys: p.successors.filter((s) => s.required && !s.blockedByCompletion).map((s) => s.key),
    staffingKeys: p.staffing.filter((s) => s.defaultSelected).map((s) => s.nodeKey),
    leadershipKeys: p.leadership.filter((l) => l.defaultSelected).map((l) => l.key),
  };
}

/** Ops for exactly the selected changes. */
export function moveOps(p: MovePreview, sel: MoveSelection): PlanOp[] {
  const ops: PlanOp[] = [];
  for (const m of p.activities) if (!m.blocked && (m.to.start !== m.from.start || m.to.finish !== m.from.finish)) ops.push({ type: "setActivityDates", key: m.key, start: m.to.start, finish: m.to.finish });
  for (const s of p.successors) if (sel.successorKeys.includes(s.key) && !s.blockedByCompletion) ops.push({ type: "setActivityDates", key: s.key, start: s.to.start, finish: s.to.finish });
  const movingSuccessors = new Set(sel.successorKeys);
  const isSuccessorStaffing = (s: StaffingOption) => s.forActivityKey !== null && p.successors.some((x) => x.key === s.forActivityKey);
  for (const s of p.staffing) if (sel.staffingKeys.includes(s.nodeKey) && (!isSuccessorStaffing(s) || movingSuccessors.has(s.forActivityKey!))) ops.push({ type: "shiftNodeEntries", key: s.nodeKey, includeDescendants: true, from: null, to: null, mode: s.unit, amount: s.amount });
  for (const l of p.leadership) if (sel.leadershipKeys.includes(l.key)) ops.push({ type: "shiftLeadership", key: l.key, days: l.days });
  return ops;
}

export function describeMove(p: MovePreview): string {
  const first = p.activities[0];
  if (!first) return "Move activities";
  return p.activities.length === 1 ? `Move ${first.code} to ${formatDate(first.to.start)}–${formatDate(first.to.finish)}` : `Move ${p.activities.length} activities`;
}
