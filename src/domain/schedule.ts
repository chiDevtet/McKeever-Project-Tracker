/**
 * Manual scheduling rules: working-duration moves, finish-to-start links with
 * working-day lag, cycle prevention, and successor proposals. Proposals are
 * never applied silently; the operator selects which to apply.
 */

import { addWorkingDays, finishForDuration, nextWorkingDay, workingDayDelta, workingDaysBetween, type CalendarResolver } from "./calendar";
import { addDays, type ISODate } from "./dates";
import type { ActivityInput, LinkInput, PlanData, ProgressInput } from "./plan";
import { resolverFor } from "./staffing";

export type MoveRule = "preserve-working-duration" | "keep-finish";

export const MOVE_RULE_LABELS: Record<MoveRule, string> = {
  "preserve-working-duration": "Preserve working duration (finish follows the calendar)",
  "keep-finish": "Keep the chosen finish date (working duration changes)",
};

export interface DateWindow {
  start: ISODate;
  finish: ISODate;
}

export function activityCalendar(data: PlanData, act: Pick<ActivityInput, "calendarKey">): CalendarResolver {
  return resolverFor(data, act.calendarKey);
}

export function workingDuration(data: PlanData, act: ActivityInput): number {
  return workingDaysBetween(activityCalendar(data, act), act.plannedStart, act.plannedFinish);
}

export function progressFor(data: PlanData, key: string): ProgressInput | undefined {
  return data.progress.find((p) => p.activityKey === key);
}

export function isCompleted(data: PlanData, key: string): boolean {
  return progressFor(data, key)?.status === "COMPLETE";
}

export function hasStarted(data: PlanData, key: string): boolean {
  const p = progressFor(data, key);
  return Boolean(p && (p.actualStart || p.status === "IN_PROGRESS" || p.status === "COMPLETE"));
}

/**
 * New dates for an activity moved to `newStart`.
 * preserve-working-duration: the finish is recomputed so the activity keeps
 * its working-day duration under its calendar; a start on a closed day snaps
 * to the next working day.
 * keep-finish: start and finish are taken as entered.
 */
export function movedDates(data: PlanData, act: ActivityInput, newStart: ISODate, rule: MoveRule, newFinish?: ISODate): DateWindow {
  const cal = activityCalendar(data, act);
  if (rule === "keep-finish") {
    const finish = newFinish ?? act.plannedFinish;
    return { start: newStart, finish };
  }
  const duration = Math.max(1, workingDaysBetween(cal, act.plannedStart, act.plannedFinish));
  const start = nextWorkingDay(cal, newStart, true);
  return { start, finish: finishForDuration(cal, start, duration) };
}

/** Shift by a signed number of working days, preserving working duration. */
export function shiftByWorkingDays(data: PlanData, act: ActivityInput, days: number): DateWindow {
  const cal = activityCalendar(data, act);
  const startAnchor = nextWorkingDay(cal, act.plannedStart, true);
  const start = days === 0 ? startAnchor : addWorkingDays(cal, startAnchor, days);
  return movedDates(data, act, start, "preserve-working-duration");
}

/** Shift by calendar weeks (dates move 7n days), preserving working duration. */
export function shiftByWeeks(data: PlanData, act: ActivityInput, weeks: number): DateWindow {
  return movedDates(data, act, addDays(act.plannedStart, weeks * 7), "preserve-working-duration");
}

/** Earliest successor start for a finish-to-start link: (lag + 1) working days after the predecessor finish. */
export function earliestSuccessorStart(cal: CalendarResolver, predecessorFinish: ISODate, lagDays: number): ISODate {
  return addWorkingDays(cal, predecessorFinish, 1 + Math.max(0, lagDays));
}

/** Would adding predecessor -> successor create a cycle? */
export function wouldCreateCycle(links: LinkInput[], predecessorKey: string, successorKey: string): boolean {
  if (predecessorKey === successorKey) return true;
  const out = new Map<string, string[]>();
  for (const l of links) {
    const list = out.get(l.predecessorKey) ?? [];
    list.push(l.successorKey);
    out.set(l.predecessorKey, list);
  }
  // Cycle if the successor can already reach the predecessor.
  const stack = [successorKey];
  const seen = new Set<string>();
  while (stack.length) {
    const k = stack.pop()!;
    if (k === predecessorKey) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...(out.get(k) ?? []));
  }
  return false;
}

export function findCycle(links: LinkInput[]): string[] | null {
  const out = new Map<string, string[]>();
  for (const l of links) out.set(l.predecessorKey, [...(out.get(l.predecessorKey) ?? []), l.successorKey]);
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (k: string): string[] | null => {
    state.set(k, 1);
    path.push(k);
    for (const n of out.get(k) ?? []) {
      if (state.get(n) === 1) return [...path.slice(path.indexOf(n)), n];
      if (!state.has(n)) {
        const c = visit(n);
        if (c) return c;
      }
    }
    path.pop();
    state.set(k, 2);
    return null;
  };
  for (const k of out.keys()) {
    if (!state.has(k)) {
      const c = visit(k);
      if (c) return c;
    }
  }
  return null;
}

export interface SuccessorProposal {
  key: string;
  code: string;
  name: string;
  from: DateWindow;
  to: DateWindow;
  /** Required to keep the link valid; optional proposals keep a previously tight spacing. */
  required: boolean;
  reason: string;
  /** Completed activities keep their actual dates and are never moved. */
  blockedByCompletion: boolean;
}

/**
 * Propose successor moves after the given activities change dates. Required
 * proposals push successors that would start too early; optional proposals
 * pull successors that were scheduled exactly at their earliest start.
 * Proposals cascade through chains of links.
 */
export function proposeSuccessorMoves(data: PlanData, changes: Map<string, DateWindow>): SuccessorProposal[] {
  const acts = new Map(data.activities.map((a) => [a.key, a]));
  const current = new Map<string, DateWindow>();
  for (const a of data.activities) current.set(a.key, changes.get(a.key) ?? { start: a.plannedStart, finish: a.plannedFinish });
  const proposals = new Map<string, SuccessorProposal>();
  const queue = [...changes.keys()];
  let guard = 0;
  while (queue.length && guard++ < 10_000) {
    const predKey = queue.shift()!;
    const pred = acts.get(predKey);
    if (!pred) continue;
    const predNow = current.get(predKey)!;
    for (const link of data.links.filter((l) => l.predecessorKey === predKey)) {
      const succ = acts.get(link.successorKey);
      if (!succ || succ.archived) continue;
      const cal = activityCalendar(data, succ);
      const succNow = current.get(succ.key)!;
      const earliest = earliestSuccessorStart(cal, predNow.finish, link.lagDays);
      const originalEarliest = earliestSuccessorStart(cal, pred.plannedFinish, link.lagDays);
      const completed = isCompleted(data, succ.key);
      let target: ISODate | null = null;
      let required = false;
      let reason = "";
      if (succNow.start < earliest) {
        target = earliest;
        required = true;
        reason = `Starts before ${pred.code} finishes${link.lagDays ? ` plus ${link.lagDays} working-day lag` : ""}`;
      } else if (earliest < originalEarliest && succ.plannedStart === originalEarliest && succNow.start === succ.plannedStart) {
        target = earliest;
        reason = `Was scheduled directly after ${pred.code}; can start earlier`;
      }
      if (!target) continue;
      const to = movedDates(data, { ...succ, plannedStart: succNow.start, plannedFinish: succNow.finish }, target, "preserve-working-duration");
      const existing = proposals.get(succ.key);
      if (existing && existing.to.start >= to.start && existing.required) continue;
      proposals.set(succ.key, {
        key: succ.key,
        code: succ.code,
        name: succ.name,
        from: { start: succ.plannedStart, finish: succ.plannedFinish },
        to,
        required: required || Boolean(existing?.required),
        reason,
        blockedByCompletion: completed,
      });
      if (!completed) {
        current.set(succ.key, to);
        queue.push(succ.key);
      }
    }
  }
  return [...proposals.values()];
}

export interface LinkViolation {
  predecessorKey: string;
  successorKey: string;
  earliest: ISODate;
  actualStart: ISODate;
}

export function linkViolations(data: PlanData): LinkViolation[] {
  const acts = new Map(data.activities.map((a) => [a.key, a]));
  const out: LinkViolation[] = [];
  for (const l of data.links) {
    const p = acts.get(l.predecessorKey);
    const s = acts.get(l.successorKey);
    if (!p || !s || p.archived || s.archived) continue;
    const earliest = earliestSuccessorStart(activityCalendar(data, s), p.plannedFinish, l.lagDays);
    if (s.plannedStart < earliest) out.push({ predecessorKey: p.key, successorKey: s.key, earliest, actualStart: s.plannedStart });
  }
  return out;
}

/** Working-day delta for a proposed move of an activity, under its calendar. */
export function moveDelta(data: PlanData, act: ActivityInput, to: DateWindow): number {
  return workingDayDelta(activityCalendar(data, act), act.plannedStart, to.start);
}
