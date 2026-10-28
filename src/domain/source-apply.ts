/**
 * Proposals from a reviewed source revision. Changed source windows propose
 * moves of linked installation activities; nothing moves until the operator
 * selects changes in the move preview. Removed source rows never delete or
 * move linked work; they are flagged for disposition.
 */

import { addWorkingDays, nextWorkingDay, workingDayDelta } from "./calendar";
import type { ISODate } from "./dates";
import type { MoveRequest } from "./move";
import type { PlanData } from "./plan";
import { activityCalendar, isCompleted } from "./schedule";

export interface SourceChangeInput {
  externalId: string;
  name: string;
  before: { start: ISODate | null; finish: ISODate | null } | null;
  after: { start: ISODate | null; finish: ISODate | null } | null;
  removed: boolean;
  linkedActivityKeys: string[];
}

export type SourceRule = "shift-with-source" | "align-to-source";

export interface SourceProposal {
  externalId: string;
  activityKey: string;
  code: string;
  name: string;
  from: { start: ISODate; finish: ISODate };
  to: { start: ISODate; finish: ISODate } | null;
  note: string;
}

export function proposeFromSource(data: PlanData, changes: SourceChangeInput[], rule: SourceRule): SourceProposal[] {
  const acts = new Map(data.activities.map((a) => [a.key, a]));
  const out: SourceProposal[] = [];
  for (const c of changes) {
    for (const key of c.linkedActivityKeys) {
      const a = acts.get(key);
      if (!a || a.archived) continue;
      const from = { start: a.plannedStart, finish: a.plannedFinish };
      if (c.removed) {
        out.push({ externalId: c.externalId, activityKey: key, code: a.code, name: a.name, from, to: null, note: "Source activity removed in this version; installation work is retained for your disposition (no automatic move or deletion)." });
        continue;
      }
      if (isCompleted(data, key)) {
        out.push({ externalId: c.externalId, activityKey: key, code: a.code, name: a.name, from, to: null, note: "Complete: actual dates are retained." });
        continue;
      }
      const cal = activityCalendar(data, a);
      if (rule === "align-to-source" && c.after?.start && c.after.finish) {
        out.push({ externalId: c.externalId, activityKey: key, code: a.code, name: a.name, from, to: { start: c.after.start, finish: c.after.finish }, note: "Align to the new source window" });
        continue;
      }
      if (!c.before?.start || !c.after?.start) {
        out.push({ externalId: c.externalId, activityKey: key, code: a.code, name: a.name, from, to: null, note: "Source start missing; adjust manually." });
        continue;
      }
      const delta = workingDayDelta(cal, nextWorkingDay(cal, c.before.start), nextWorkingDay(cal, c.after.start));
      if (delta === 0) continue;
      const start = addWorkingDays(cal, nextWorkingDay(cal, a.plannedStart), delta);
      out.push({ externalId: c.externalId, activityKey: key, code: a.code, name: a.name, from, to: { start, finish: start }, note: `Shift ${delta > 0 ? "+" : ""}${delta} working day(s) with the source start, preserving duration` });
    }
  }
  return out;
}

/** Move request for the selected proposals (feeds the standard move preview). */
export function sourceMoveRequest(proposals: SourceProposal[], selected: Set<string>, rule: SourceRule): MoveRequest | null {
  const moves = proposals.filter((p) => p.to && selected.has(`${p.externalId}|${p.activityKey}`)).map((p) => (rule === "align-to-source" ? { key: p.activityKey, start: p.to!.start, finish: p.to!.finish } : { key: p.activityKey, start: p.to!.start }));
  if (!moves.length) return null;
  const unique = [...new Map(moves.map((m) => [m.key, m])).values()];
  return { kind: "dates", moves: unique, rule: rule === "align-to-source" ? "keep-finish" : "preserve-working-duration" };
}
