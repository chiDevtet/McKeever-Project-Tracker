/**
 * One canonical resource-capacity model.
 *
 * Each workforce pool is a tree. The POOL root supplies people for date/time
 * blocks. RESERVATION and CREW children reserve part of their parent's
 * capacity for a phase, area, system, activity, or dedicated crew; their own
 * children subdivide that reservation further. Children never add people:
 * at every instant the sum of a node's children must not exceed the node.
 * Headcount is measured from POOL roots only, so nesting detail can never
 * duplicate capacity.
 */

import type { ISODate } from "./dates";
import type { ActivityInput, AreaInfo, NodeInput, PlanData } from "./plan";
import type { Block } from "./staffing";
import { epochMsToZonedDate, epochMsToZonedTime } from "./tz";

export interface NodeTree {
  byKey: Map<string, NodeInput>;
  children: Map<string, string[]>;
  roots: string[];
}

export interface StructureIssue {
  nodeKey: string;
  message: string;
}

export function buildTree(nodes: NodeInput[]): NodeTree {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const sorted = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  for (const n of sorted) {
    if (n.parentKey && byKey.has(n.parentKey)) {
      const list = children.get(n.parentKey) ?? [];
      list.push(n.key);
      children.set(n.parentKey, list);
    } else {
      roots.push(n.key);
    }
  }
  return { byKey, children, roots };
}

export function ancestors(tree: NodeTree, key: string): NodeInput[] {
  const out: NodeInput[] = [];
  let cur = tree.byKey.get(key);
  let guard = 0;
  while (cur?.parentKey && guard++ < 256) {
    const p = tree.byKey.get(cur.parentKey);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}

export function descendants(tree: NodeTree, key: string): string[] {
  const out: string[] = [];
  const stack = [...(tree.children.get(key) ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    out.push(k);
    stack.push(...(tree.children.get(k) ?? []));
  }
  return out;
}

export function rootOf(tree: NodeTree, key: string): NodeInput | undefined {
  const chain = ancestors(tree, key);
  return chain.length ? chain[chain.length - 1] : tree.byKey.get(key);
}

export function isAreaWithin(areas: Map<string, AreaInfo>, areaId: string, ancestorId: string): boolean {
  let cur: string | null = areaId;
  let guard = 0;
  while (cur && guard++ < 256) {
    if (cur === ancestorId) return true;
    cur = areas.get(cur)?.parentId ?? null;
  }
  return false;
}

export interface EffectiveTargets {
  phaseId: string | null;
  areaId: string | null;
  systemId: string | null;
  activityKey: string | null;
  crewKey: string | null;
  poolKey: string;
  role: string;
}

/** A node's own targets, including those implied by its activity. */
export function ownTargets(node: NodeInput, activities: Map<string, ActivityInput>) {
  const act = node.activityKey ? activities.get(node.activityKey) : undefined;
  return {
    phaseId: node.phaseId ?? act?.phaseId ?? null,
    areaId: node.areaId ?? act?.areaId ?? null,
    systemId: node.systemId ?? act?.systemId ?? null,
    activityKey: node.activityKey,
  };
}

/** Targets inherited down the tree; children are equal to or more specific than ancestors. */
export function effectiveTargets(data: PlanData, tree: NodeTree): Map<string, EffectiveTargets> {
  const activities = new Map(data.activities.map((a) => [a.key, a]));
  const out = new Map<string, EffectiveTargets>();
  const visit = (key: string, inherited: EffectiveTargets | null) => {
    const node = tree.byKey.get(key)!;
    const own = ownTargets(node, activities);
    const eff: EffectiveTargets = {
      phaseId: own.phaseId ?? inherited?.phaseId ?? null,
      areaId: own.areaId ?? inherited?.areaId ?? null,
      systemId: own.systemId ?? inherited?.systemId ?? null,
      activityKey: own.activityKey ?? inherited?.activityKey ?? null,
      crewKey: node.kind === "CREW" ? node.key : (inherited?.crewKey ?? null),
      poolKey: inherited?.poolKey ?? node.key,
      role: inherited?.role ?? node.role,
    };
    out.set(key, eff);
    for (const c of tree.children.get(key) ?? []) visit(c, eff);
  };
  for (const r of tree.roots) visit(r, null);
  return out;
}

/** Structural rules: POOL roots only, no cycles, targets consistent with ancestors. */
export function validateStructure(data: PlanData, tree: NodeTree = buildTree(data.nodes)): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const areas = new Map(data.areas.map((a) => [a.id, a]));
  const activities = new Map(data.activities.map((a) => [a.key, a]));
  const phaseIds = new Set(data.phases.map((p) => p.id));
  const systemIds = new Set(data.systems.map((s) => s.id));

  for (const n of data.nodes) {
    if (n.parentKey && !tree.byKey.has(n.parentKey)) issues.push({ nodeKey: n.key, message: `"${n.name}" refers to a missing parent row` });
    if (!n.parentKey && n.kind !== "POOL") issues.push({ nodeKey: n.key, message: `"${n.name}" must belong to a workforce pool` });
    if (n.parentKey && n.kind === "POOL") issues.push({ nodeKey: n.key, message: `Workforce pool "${n.name}" cannot be nested inside another row` });
    if (n.phaseId && !phaseIds.has(n.phaseId)) issues.push({ nodeKey: n.key, message: `"${n.name}" refers to a missing phase` });
    if (n.areaId && !areas.has(n.areaId)) issues.push({ nodeKey: n.key, message: `"${n.name}" refers to a missing area` });
    if (n.systemId && !systemIds.has(n.systemId)) issues.push({ nodeKey: n.key, message: `"${n.name}" refers to a missing system` });
    if (n.activityKey && !activities.has(n.activityKey)) issues.push({ nodeKey: n.key, message: `"${n.name}" refers to a missing activity` });
    if (!Number.isInteger(n.sortOrder)) issues.push({ nodeKey: n.key, message: "Invalid sort order" });

    // Cycle detection.
    const seen = new Set<string>([n.key]);
    let cur = n.parentKey ? tree.byKey.get(n.parentKey) : undefined;
    while (cur) {
      if (seen.has(cur.key)) {
        issues.push({ nodeKey: n.key, message: `"${n.name}" is nested inside itself` });
        break;
      }
      seen.add(cur.key);
      cur = cur.parentKey ? tree.byKey.get(cur.parentKey) : undefined;
    }
  }
  if (issues.length) return issues;

  const eff = effectiveTargets(data, tree);
  for (const n of data.nodes) {
    if (!n.parentKey) continue;
    const parent = eff.get(n.parentKey)!;
    const own = ownTargets(n, activities);
    if (own.phaseId && parent.phaseId && own.phaseId !== parent.phaseId) {
      issues.push({ nodeKey: n.key, message: `"${n.name}" targets a different phase than the reservation it subdivides` });
    }
    if (own.systemId && parent.systemId && own.systemId !== parent.systemId) {
      issues.push({ nodeKey: n.key, message: `"${n.name}" targets a different system than the reservation it subdivides` });
    }
    if (own.areaId && parent.areaId && !isAreaWithin(areas, own.areaId, parent.areaId)) {
      issues.push({ nodeKey: n.key, message: `"${n.name}" targets an area outside the parent reservation's area` });
    }
    if (own.activityKey && parent.activityKey && own.activityKey !== parent.activityKey) {
      issues.push({ nodeKey: n.key, message: `"${n.name}" targets a different activity than the reservation it subdivides` });
    }
  }
  return issues;
}

export interface CapacityViolation {
  parentKey: string;
  parentName: string;
  childKeys: string[];
  startMs: number;
  endMs: number;
  capacity: number;
  reserved: number;
  /** Local date and time range for messages. */
  date: ISODate;
  timeRange: string;
}

interface SweepEvent {
  t: number;
  cap: number;
  use: number;
  child: string | null;
}

/**
 * At every instant, reserved (sum of children) must not exceed the parent.
 * Returns merged violation segments for one parent.
 */
export function sweepCapacity(parentKey: string, parentName: string, parentBlocks: Block[], childBlocks: Block[], timeZone: string): CapacityViolation[] {
  if (!childBlocks.length) return [];
  const events: SweepEvent[] = [];
  for (const b of parentBlocks) {
    events.push({ t: b.startMs, cap: b.headcount, use: 0, child: null });
    events.push({ t: b.endMs, cap: -b.headcount, use: 0, child: null });
  }
  for (const b of childBlocks) {
    events.push({ t: b.startMs, cap: 0, use: b.headcount, child: b.ownerKey });
    events.push({ t: b.endMs, cap: 0, use: -b.headcount, child: b.ownerKey });
  }
  events.sort((a, b) => a.t - b.t);

  const out: CapacityViolation[] = [];
  const active = new Map<string, number>();
  let cap = 0;
  let use = 0;
  let i = 0;
  while (i < events.length) {
    const t = events[i].t;
    while (i < events.length && events[i].t === t) {
      const e = events[i++];
      cap += e.cap;
      use += e.use;
      if (e.child) {
        const n = (active.get(e.child) ?? 0) + e.use;
        if (n === 0) active.delete(e.child);
        else active.set(e.child, n);
      }
    }
    const next = i < events.length ? events[i].t : t;
    if (next > t && use > cap) {
      const childKeys = [...active.keys()].sort();
      const last = out[out.length - 1];
      if (last && last.endMs === t && last.capacity === cap && last.reserved === use && last.childKeys.join() === childKeys.join()) {
        last.endMs = next;
      } else {
        out.push({ parentKey, parentName, childKeys, startMs: t, endMs: next, capacity: cap, reserved: use, date: epochMsToZonedDate(t, timeZone), timeRange: "" });
      }
    }
  }
  for (const v of out) v.timeRange = `${epochMsToZonedTime(v.startMs, timeZone)}–${epochMsToZonedTime(v.endMs, timeZone)}`;
  return out;
}

/** Capacity violations across all pools. */
export function checkCapacity(data: PlanData, blocks: Map<string, Block[]>, tree: NodeTree = buildTree(data.nodes)): CapacityViolation[] {
  const tz = data.project.timezone;
  const out: CapacityViolation[] = [];
  for (const [parentKey, kids] of tree.children) {
    const parent = tree.byKey.get(parentKey)!;
    const childBlocks = kids.flatMap((k) => blocks.get(k) ?? []);
    out.push(...sweepCapacity(parentKey, parent.name, blocks.get(parentKey) ?? [], childBlocks, tz));
  }
  return out;
}

/** Overlapping timed blocks on the same row (a duplicate booking of the same slice). */
export function overlappingBlocksOnRow(data: PlanData): { nodeKey: string; date: ISODate; message: string }[] {
  const out: { nodeKey: string; date: ISODate; message: string }[] = [];
  const groups = new Map<string, { s: number; e: number; label: string }[]>();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (const e of data.entries) {
    if (e.kind !== "BLOCK" || !e.startTime || !e.endTime) continue;
    const s = toMin(e.startTime);
    let en = toMin(e.endTime);
    if (en <= s) en += 1440;
    const k = `${e.nodeKey}|${e.date}`;
    const list = groups.get(k) ?? [];
    list.push({ s, e: en, label: `${e.startTime}–${e.endTime}` });
    groups.set(k, list);
  }
  const names = new Map(data.nodes.map((n) => [n.key, n.name]));
  for (const [k, list] of groups) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) {
      if (list[i].s < list[i - 1].e) {
        const [nodeKey, date] = k.split("|");
        out.push({ nodeKey, date, message: `Time blocks ${list[i - 1].label} and ${list[i].label} overlap on "${names.get(nodeKey) ?? nodeKey}" ${date}. Use a separate crew or row for additional concurrent people.` });
      }
    }
  }
  return out;
}

/**
 * Remaining (unreserved) capacity of a parent over a window: the minimum and
 * maximum of parent - sum(children) while the parent has capacity.
 */
export function remainingRange(parentBlocks: Block[], childBlocks: Block[], windowStart: number, windowEnd: number): { min: number; max: number } | null {
  const events: { t: number; cap: number; use: number }[] = [];
  const clip = (b: Block) => [Math.max(b.startMs, windowStart), Math.min(b.endMs, windowEnd)] as const;
  for (const b of parentBlocks) {
    const [s, e] = clip(b);
    if (e > s) events.push({ t: s, cap: b.headcount, use: 0 }, { t: e, cap: -b.headcount, use: 0 });
  }
  if (!events.length) return null;
  for (const b of childBlocks) {
    const [s, e] = clip(b);
    if (e > s) events.push({ t: s, cap: 0, use: b.headcount }, { t: e, cap: 0, use: -b.headcount });
  }
  events.sort((a, b) => a.t - b.t);
  let cap = 0;
  let use = 0;
  let min = Infinity;
  let max = -Infinity;
  let i = 0;
  while (i < events.length) {
    const t = events[i].t;
    while (i < events.length && events[i].t === t) {
      cap += events[i].cap;
      use += events[i].use;
      i++;
    }
    const next = i < events.length ? events[i].t : t;
    if (next > t && cap > 0) {
      min = Math.min(min, cap - use);
      max = Math.max(max, cap - use);
    }
  }
  return min === Infinity ? null : { min, max };
}

/**
 * Nodes that represent a grouping value without double counting: the topmost
 * nodes matching a predicate that is monotone down the tree (if a parent
 * matches, every descendant matches).
 */
export function topmostMatching(tree: NodeTree, matches: (key: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (key: string) => {
    if (matches(key)) {
      out.push(key);
      return;
    }
    for (const c of tree.children.get(key) ?? []) visit(c);
  };
  for (const r of tree.roots) visit(r);
  return out;
}
