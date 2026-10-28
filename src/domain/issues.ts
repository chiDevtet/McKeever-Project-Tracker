/**
 * Planning issues: non-blocking flags that may remain in a draft, are shown
 * with navigation to the affected records, and must be acknowledged before a
 * formal submission is recorded. Data validation failures are separate and
 * always block saving (see ops.validatePlan).
 */

import { buildTree, checkCapacity } from "./capacity";
import { formatDate, type ISODate } from "./dates";
import type { PlanData } from "./plan";
import { activityCalendar, linkViolations } from "./schedule";
import { expandAllNodes } from "./staffing";

export type IssueSeverity = "error" | "warning" | "info";

export interface IssueRef {
  kind: "activity" | "node" | "leadership" | "milestone" | "phase";
  key: string;
  label: string;
}

export interface PlanningIssue {
  id: string;
  severity: IssueSeverity;
  category:
    | "capacity"
    | "source-window"
    | "source-removed"
    | "milestone-missed"
    | "milestone-unconfirmed"
    | "closed-day"
    | "link-violation"
    | "leadership-dates"
    | "leadership-tbd"
    | "on-hold"
    | "staffing-after-completion";
  message: string;
  refs: IssueRef[];
}

export const ISSUE_CATEGORY_LABELS: Record<PlanningIssue["category"], string> = {
  capacity: "Capacity conflict",
  "source-window": "Outside source window",
  "source-removed": "Source activity removed",
  "milestone-missed": "Linked milestone missed",
  "milestone-unconfirmed": "Milestone needs review",
  "closed-day": "Work on a closed day",
  "link-violation": "Dependency not satisfied",
  "leadership-dates": "Leadership dates not selected",
  "leadership-tbd": "Leadership to be named",
  "on-hold": "On-hold work has reservations",
  "staffing-after-completion": "Staffing after completion",
};

export function computePlanningIssues(data: PlanData): PlanningIssue[] {
  const out: PlanningIssue[] = [];
  const acts = new Map(data.activities.filter((a) => !a.archived).map((a) => [a.key, a]));
  const actLabel = (k: string) => {
    const a = acts.get(k);
    return a ? `${a.code} ${a.name}` : k;
  };
  const nodes = new Map(data.nodes.map((n) => [n.key, n]));
  const milestones = new Map(data.milestones.map((m) => [m.id, m]));
  const progress = new Map(data.progress.map((p) => [p.activityKey, p]));

  // Capacity conflicts that exist in the stored plan (for example after a crew calendar change).
  const blocks = expandAllNodes(data);
  for (const v of checkCapacity(data, blocks, buildTree(data.nodes))) {
    out.push({
      id: `capacity:${v.parentKey}:${v.startMs}`,
      severity: "error",
      category: "capacity",
      message: `"${v.parentName}" has ${v.reserved} reserved but ${v.capacity} available on ${formatDate(v.date)} ${v.timeRange}`,
      refs: [{ kind: "node", key: v.parentKey, label: v.parentName }, ...v.childKeys.map((k) => ({ kind: "node" as const, key: k, label: nodes.get(k)?.name ?? k }))],
    });
  }

  for (const sw of data.sourceWindows) {
    const a = acts.get(sw.activityKey);
    if (!a) continue;
    if (sw.removed) {
      out.push({
        id: `source-removed:${a.key}:${sw.externalId}`,
        severity: "warning",
        category: "source-removed",
        message: `${a.code} is linked to ${sw.externalId}, which is removed in ${sw.lineageName} ${sw.versionLabel}. The installation activity is retained for review.`,
        refs: [{ kind: "activity", key: a.key, label: actLabel(a.key) }],
      });
      continue;
    }
    if (!sw.start || !sw.finish) continue;
    if (a.plannedStart < sw.start || a.plannedFinish > sw.finish) {
      out.push({
        id: `source-window:${a.key}:${sw.externalId}`,
        severity: "warning",
        category: "source-window",
        message: `${a.code} (${formatDate(a.plannedStart)}–${formatDate(a.plannedFinish)}) falls outside source ${sw.externalId} (${formatDate(sw.start)}–${formatDate(sw.finish)}, ${sw.versionLabel})`,
        refs: [{ kind: "activity", key: a.key, label: actLabel(a.key) }],
      });
    }
  }

  for (const link of data.activityMilestones) {
    const a = acts.get(link.activityKey);
    const m = milestones.get(link.milestoneId);
    if (!a || !m) continue;
    const date: ISODate | null = m.date ?? m.candidates.find((c) => c.date)?.date ?? null;
    if (date && a.plannedFinish > date) {
      out.push({
        id: `milestone-missed:${a.key}:${m.id}`,
        severity: "warning",
        category: "milestone-missed",
        message: `${a.code} finishes ${formatDate(a.plannedFinish)}, after linked milestone ${m.code} ${m.name} (${formatDate(date)}${m.reviewStatus === "CONFIRMED" ? "" : ", candidate"})`,
        refs: [
          { kind: "activity", key: a.key, label: actLabel(a.key) },
          { kind: "milestone", key: m.id, label: `${m.code} ${m.name}` },
        ],
      });
    }
  }

  for (const m of data.milestones) {
    if (m.reviewStatus !== "NEEDS_REVIEW") continue;
    const distinct = new Set(m.candidates.map((c) => c.date ?? "unspecified"));
    out.push({
      id: `milestone-unconfirmed:${m.id}`,
      severity: "info",
      category: "milestone-unconfirmed",
      message:
        distinct.size > 1
          ? `${m.code} ${m.name}: sources disagree (${m.candidates.map((c) => `${c.date ? formatDate(c.date) : "unspecified"} per ${c.label}`).join("; ")}). Needs operator review.`
          : `${m.code} ${m.name}: candidate date needs operator review`,
      refs: [{ kind: "milestone", key: m.id, label: `${m.code} ${m.name}` }],
    });
  }

  for (const a of acts.values()) {
    const cal = activityCalendar(data, a);
    const bad = [a.plannedStart, a.plannedFinish].filter((d) => !cal.isWorkingDay(d));
    if (bad.length) {
      out.push({
        id: `closed-day:${a.key}`,
        severity: "warning",
        category: "closed-day",
        message: `${a.code} ${bad.length === 2 && bad[0] !== bad[1] ? "starts and finishes" : a.plannedStart === bad[0] ? "starts" : "finishes"} on a closed calendar day (${bad.map((d) => formatDate(d)).join(", ")})`,
        refs: [{ kind: "activity", key: a.key, label: actLabel(a.key) }],
      });
    }
  }
  const closedStaffing = new Map<string, ISODate[]>();
  for (const [k, list] of blocks) {
    for (const b of list) if (b.closedDay) closedStaffing.set(k, [...(closedStaffing.get(k) ?? []), b.shiftDate]);
  }
  for (const [k, dates] of closedStaffing) {
    const uniq = [...new Set(dates)].sort();
    out.push({
      id: `closed-day:node:${k}`,
      severity: "warning",
      category: "closed-day",
      message: `"${nodes.get(k)?.name ?? k}" has staffing on ${uniq.length} closed calendar day${uniq.length === 1 ? "" : "s"} (${uniq.slice(0, 4).map((d) => formatDate(d)).join(", ")}${uniq.length > 4 ? ", …" : ""})`,
      refs: [{ kind: "node", key: k, label: nodes.get(k)?.name ?? k }],
    });
  }

  for (const v of linkViolations(data)) {
    out.push({
      id: `link:${v.predecessorKey}:${v.successorKey}`,
      severity: "warning",
      category: "link-violation",
      message: `${actLabel(v.successorKey)} starts ${formatDate(v.actualStart)}; its predecessor ${acts.get(v.predecessorKey)?.code} allows ${formatDate(v.earliest)} at the earliest`,
      refs: [
        { kind: "activity", key: v.predecessorKey, label: actLabel(v.predecessorKey) },
        { kind: "activity", key: v.successorKey, label: actLabel(v.successorKey) },
      ],
    });
  }

  for (const l of data.leadership) {
    const label = `${l.personName} (${l.role})`;
    if (!l.startDate || !l.endDate) {
      out.push({
        id: `leadership-dates:${l.key}`,
        severity: "warning",
        category: "leadership-dates",
        message: `${label}: onsite assignment dates are not selected, so no onsite time is counted`,
        refs: [{ kind: "leadership", key: l.key, label }],
      });
    }
    if (!l.personId) {
      out.push({ id: `leadership-tbd:${l.key}`, severity: "info", category: "leadership-tbd", message: `${l.role} is TBD`, refs: [{ kind: "leadership", key: l.key, label }] });
    }
  }

  for (const [k, p] of progress) {
    const a = acts.get(k);
    if (!a) continue;
    const reserved = data.nodes.filter((n) => n.activityKey === k);
    if (p.status === "ON_HOLD" && reserved.length) {
      out.push({
        id: `on-hold:${k}`,
        severity: "warning",
        category: "on-hold",
        message: `${a.code} is on hold${p.holdReason ? ` (${p.holdReason})` : ""}; ${reserved.length} staffing reservation${reserved.length === 1 ? "" : "s"} kept for review${p.holdReviewDate ? `, review by ${formatDate(p.holdReviewDate)}` : ""}`,
        refs: [{ kind: "activity", key: k, label: actLabel(k) }, ...reserved.map((n) => ({ kind: "node" as const, key: n.key, label: n.name }))],
      });
    }
    if (p.status === "COMPLETE" && p.actualFinish) {
      const after = reserved.filter((n) => (blocks.get(n.key) ?? []).some((b) => b.shiftDate > p.actualFinish!));
      if (after.length) {
        out.push({
          id: `staffing-after-completion:${k}`,
          severity: "warning",
          category: "staffing-after-completion",
          message: `${a.code} finished ${formatDate(p.actualFinish)} but has reserved staffing after that date`,
          refs: [{ kind: "activity", key: k, label: actLabel(k) }, ...after.map((n) => ({ kind: "node" as const, key: n.key, label: n.name }))],
        });
      }
    }
  }

  const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.category.localeCompare(b.category) || a.message.localeCompare(b.message));
}
