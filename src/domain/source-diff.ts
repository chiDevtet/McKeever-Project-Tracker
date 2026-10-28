/**
 * Source schedule revision comparison. Rows are matched by external activity
 * ID within one source lineage; names alone never establish identity.
 * Duplicate IDs and rows that might be renumbered activities are flagged for
 * review instead of being matched automatically.
 */

import type { ISODate } from "./dates";

export interface ComparableRow {
  externalId: string | null;
  name: string;
  start: ISODate | null;
  finish: ISODate | null;
  originalDuration: number | null;
}

export type MatchStatus = "ADDED" | "UNCHANGED" | "CHANGED" | "RENAMED" | "DUPLICATE_ID" | "UNCERTAIN" | "NO_ID";

export interface FieldChange {
  field: "name" | "start" | "finish" | "originalDuration";
  before: string | number | null;
  after: string | number | null;
}

export interface RowMatch {
  status: MatchStatus;
  changes: FieldChange[];
  categories: ("renamed" | "date-changed" | "duration-changed")[];
  prior: ComparableRow | null;
  /** For UNCERTAIN: prior IDs (removed in this version) with the same name. */
  candidates: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function compareSourceRows(rows: ComparableRow[], prior: ComparableRow[]): { matches: RowMatch[]; removed: ComparableRow[] } {
  const priorById = new Map(prior.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  const counts = new Map<string, number>();
  for (const r of rows) if (r.externalId) counts.set(r.externalId, (counts.get(r.externalId) ?? 0) + 1);
  const present = new Set(rows.map((r) => r.externalId).filter(Boolean) as string[]);
  const removed = prior.filter((p) => p.externalId && !present.has(p.externalId));
  const removedByName = new Map<string, string[]>();
  for (const p of removed) removedByName.set(norm(p.name), [...(removedByName.get(norm(p.name)) ?? []), p.externalId!]);

  const matches = rows.map((r): RowMatch => {
    if (!r.externalId) return { status: "NO_ID", changes: [], categories: [], prior: null, candidates: removedByName.get(norm(r.name)) ?? [] };
    if ((counts.get(r.externalId) ?? 0) > 1) return { status: "DUPLICATE_ID", changes: [], categories: [], prior: priorById.get(r.externalId) ?? null, candidates: [] };
    const p = priorById.get(r.externalId);
    if (!p) {
      const candidates = removedByName.get(norm(r.name)) ?? [];
      return { status: candidates.length ? "UNCERTAIN" : "ADDED", changes: [], categories: [], prior: null, candidates };
    }
    const changes: FieldChange[] = [];
    if (p.name.trim() !== r.name.trim()) changes.push({ field: "name", before: p.name, after: r.name });
    if (p.start !== r.start) changes.push({ field: "start", before: p.start, after: r.start });
    if (p.finish !== r.finish) changes.push({ field: "finish", before: p.finish, after: r.finish });
    if ((p.originalDuration ?? null) !== (r.originalDuration ?? null)) changes.push({ field: "originalDuration", before: p.originalDuration, after: r.originalDuration });
    const categories: RowMatch["categories"] = [];
    if (changes.some((c) => c.field === "name")) categories.push("renamed");
    if (changes.some((c) => c.field === "start" || c.field === "finish")) categories.push("date-changed");
    if (changes.some((c) => c.field === "originalDuration")) categories.push("duration-changed");
    return { status: !changes.length ? "UNCHANGED" : categories.length === 1 && categories[0] === "renamed" ? "RENAMED" : "CHANGED", changes, categories, prior: p, candidates: [] };
  });
  return { matches, removed };
}
