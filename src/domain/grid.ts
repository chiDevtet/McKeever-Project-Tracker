/**
 * Weekly planning-grid model shared by the manpower screen and staffing-table
 * reports. Rows follow the capacity tree; each parent with children gets a
 * read-only "remaining" row (capacity not yet reserved), so detail never
 * appears as additional people.
 */

import { buildTree, remainingRange, type NodeTree } from "./capacity";
import { addDays, type ISODate } from "./dates";
import { nodeWeekStats } from "./metrics";
import type { NodeInput, PlanData } from "./plan";
import { expandAllNodes, expandLeadership, projectResolver, type Block } from "./staffing";
import { HOUR_MS, localMidnightMs, overlapMs } from "./tz";

export interface GridCell {
  /** Peak headcount of the row in the week (null when nothing scheduled). */
  value: number | null;
  /** Weekly entry value when set. */
  weeklyValue: number | null;
  /** Daily overrides or timed blocks exist in the week. */
  varies: boolean;
  hours: number;
}

export interface RemainingCell {
  min: number;
  max: number;
}

export interface GridNodeRow {
  type: "node";
  node: NodeInput;
  depth: number;
  targetsLabel: string;
  cells: Map<ISODate, GridCell>;
  remaining: Map<ISODate, RemainingCell | null> | null;
  childKeys: string[];
}

export interface GridLeaderRow {
  type: "leadership";
  key: string;
  personName: string;
  role: string;
  isPlaceholder: boolean;
  responsibility: string;
  datesSelected: boolean;
  cells: Map<ISODate, { onsiteDays: number; hours: number }>;
}

export interface WeekColumn {
  week: ISODate;
  openDays: number;
  calendarHours: number;
}

export interface GridModel {
  weeks: WeekColumn[];
  nodeRows: GridNodeRow[];
  leaderRows: GridLeaderRow[];
  tree: NodeTree;
  blocks: Map<string, Block[]>;
}

export function targetsLabel(data: PlanData, n: NodeInput): string {
  const parts: string[] = [];
  if (n.kind === "CREW") parts.push("Dedicated crew");
  const phase = n.phaseId ? data.phases.find((p) => p.id === n.phaseId)?.name : null;
  const area = n.areaId ? data.areas.find((a) => a.id === n.areaId)?.name : null;
  const system = n.systemId ? data.systems.find((s) => s.id === n.systemId)?.name : null;
  const act = n.activityKey ? data.activities.find((a) => a.key === n.activityKey) : null;
  if (phase) parts.push(phase);
  if (area) parts.push(area);
  if (system) parts.push(system);
  if (act) parts.push(`${act.code} ${act.name}`);
  if (n.kind === "POOL") parts.push(`${n.role} capacity`);
  return parts.join(" · ");
}

export function buildGridModel(data: PlanData, weeks: ISODate[]): GridModel {
  const tree = buildTree(data.nodes);
  const blocks = expandAllNodes(data);
  const stats = nodeWeekStats(data, blocks, weeks);
  const cal = projectResolver(data);
  const tz = data.project.timezone;

  const nodeRows: GridNodeRow[] = [];
  const visit = (k: string, depth: number) => {
    const node = tree.byKey.get(k)!;
    const kids = tree.children.get(k) ?? [];
    const cells = new Map<ISODate, GridCell>();
    for (const w of weeks) {
      const s = stats.get(k)?.get(w);
      cells.set(w, {
        value: s && (s.peak > 0 || s.weeklyValue !== null) ? s.peak : null,
        weeklyValue: s?.weeklyValue ?? null,
        varies: Boolean(s?.hasOverrides),
        hours: s?.hours ?? 0,
      });
    }
    let remaining: Map<ISODate, RemainingCell | null> | null = null;
    if (kids.length) {
      remaining = new Map();
      const childBlocks = kids.flatMap((c) => blocks.get(c) ?? []);
      for (const w of weeks) {
        remaining.set(w, remainingRange(blocks.get(k) ?? [], childBlocks, localMidnightMs(w, tz), localMidnightMs(addDays(w, 7), tz)));
      }
    }
    nodeRows.push({ type: "node", node, depth, targetsLabel: targetsLabel(data, node), cells, remaining, childKeys: kids });
    for (const c of kids) visit(c, depth + 1);
  };
  for (const r of tree.roots) visit(r, 0);

  const systems = new Map(data.systems.map((s) => [s.id, s.name]));
  const phases = new Map(data.phases.map((p) => [p.id, p.name]));
  const leaderRows: GridLeaderRow[] = [...data.leadership]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => {
      const lb = expandLeadership(data, l);
      const cells = new Map<ISODate, { onsiteDays: number; hours: number }>();
      for (const w of weeks) {
        const ws = localMidnightMs(w, tz);
        const we = localMidnightMs(addDays(w, 7), tz);
        let hours = 0;
        const days = new Set<ISODate>();
        for (const b of lb) {
          const o = overlapMs(b.startMs, b.endMs, ws, we);
          if (o > 0) {
            hours += o / HOUR_MS;
            days.add(b.shiftDate);
          }
        }
        cells.set(w, { onsiteDays: days.size, hours: Math.round(hours * 100) / 100 });
      }
      const scope = [
        ...l.responsibilitySystemIds.map((id) => systems.get(id)).filter(Boolean),
        ...l.responsibilityPhaseIds.map((id) => phases.get(id)).filter(Boolean),
      ];
      return {
        type: "leadership" as const,
        key: l.key,
        personName: l.personName,
        role: l.role,
        isPlaceholder: !l.personId,
        responsibility: scope.length ? scope.join(", ") : l.responsibilityNote ?? "Whole project",
        datesSelected: Boolean(l.startDate && l.endDate),
        cells,
      };
    });

  return {
    weeks: weeks.map((w) => ({ week: w, openDays: cal.openDaysBetween(w, addDays(w, 6)), calendarHours: cal.hoursBetween(w, addDays(w, 6)) })),
    nodeRows,
    leaderRows,
    tree,
    blocks,
  };
}
