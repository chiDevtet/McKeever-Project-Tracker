"use client";

import { useMemo, useRef, useState } from "react";
import { addDays, diffDays, eachDay, formatDate, formatDayMonth, isoWeekday, monthShort, type ISODate } from "@/domain/dates";
import type { MoveRequest } from "@/domain/move";
import type { ActivityInput, PlanData, SourceWindow } from "@/domain/plan";
import { projectResolver } from "@/domain/staffing";
import { todayInTimeZone } from "@/domain/tz";
import { cn } from "@/lib/utils";

export type GroupBy = "none" | "phase" | "area" | "system";

interface Props {
  data: PlanData;
  activities: ActivityInput[];
  groupBy: GroupBy;
  zoom: "day" | "week";
  from: ISODate;
  to: ISODate;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  canEdit: boolean;
  onRequestMove: (req: MoveRequest) => void;
}

const LABEL_W = 260;
const ROW_H = 30;

interface Drag {
  key: string;
  mode: "move" | "resize";
  startX: number;
  dx: number;
}

export function groupActivities(data: PlanData, acts: ActivityInput[], groupBy: GroupBy): { id: string; label: string; items: ActivityInput[] }[] {
  if (groupBy === "none") return [{ id: "all", label: "All activities", items: acts }];
  const label = (a: ActivityInput) => {
    if (groupBy === "phase") return data.phases.find((p) => p.id === a.phaseId)?.name ?? "No phase";
    if (groupBy === "system") return data.systems.find((s) => s.id === a.systemId)?.name ?? "Shared systems";
    return data.areas.find((x) => x.id === a.areaId)?.name ?? "No area";
  };
  const order = (a: ActivityInput) => {
    if (groupBy === "phase") return data.phases.find((p) => p.id === a.phaseId)?.sortOrder ?? 9999;
    if (groupBy === "system") return data.systems.find((s) => s.id === a.systemId)?.sortOrder ?? 9999;
    return data.areas.find((x) => x.id === a.areaId)?.sortOrder ?? 9999;
  };
  const groups = new Map<string, { id: string; label: string; items: ActivityInput[]; order: number }>();
  for (const a of acts) {
    const l = label(a);
    const g = groups.get(l) ?? { id: l, label: l, items: [], order: order(a) };
    g.items.push(a);
    groups.set(l, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function ScheduleTimeline({ data, activities, groupBy, zoom, from, to, selectedKey, onSelect, canEdit, onRequestMove }: Props) {
  const dayW = zoom === "day" ? 24 : 6;
  const days = useMemo(() => eachDay(from, to), [from, to]);
  const width = days.length * dayW;
  const x = (d: ISODate) => diffDays(from, d) * dayW;
  const cal = projectResolver(data);
  const today = todayInTimeZone(data.project.timezone);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupActivities(data, activities, groupBy), [data, activities, groupBy]);
  const progress = useMemo(() => new Map(data.progress.map((p) => [p.activityKey, p])), [data.progress]);
  const sources = useMemo(() => {
    const m = new Map<string, SourceWindow[]>();
    for (const s of data.sourceWindows) m.set(s.activityKey, [...(m.get(s.activityKey) ?? []), s]);
    return m;
  }, [data.sourceWindows]);

  // Row layout (group headers + activity rows) for bars and dependency lines.
  const layout = useMemo(() => {
    const rows: ({ type: "group"; id: string; label: string; items: ActivityInput[] } | { type: "act"; a: ActivityInput })[] = [];
    for (const g of groups) {
      if (groupBy !== "none") rows.push({ type: "group", id: g.id, label: g.label, items: g.items });
      if (!collapsed.has(g.id)) for (const a of g.items) rows.push({ type: "act", a });
    }
    const yByKey = new Map<string, number>();
    rows.forEach((r, i) => r.type === "act" && yByKey.set(r.a.key, i * ROW_H + ROW_H / 2));
    return { rows, yByKey };
  }, [groups, collapsed, groupBy]);

  const milestones = data.milestones
    .map((m) => ({ m, date: m.date ?? m.candidates.find((c) => c.date)?.date ?? null }))
    .filter((x): x is { m: (typeof data.milestones)[number]; date: ISODate } => Boolean(x.date && x.date >= from && x.date <= to));

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const shift = Math.round(d.dx / dayW);
    if (shift === 0) return;
    const a = activities.find((x) => x.key === d.key);
    if (!a) return;
    if (d.mode === "move") onRequestMove({ kind: "dates", moves: [{ key: a.key, start: addDays(a.plannedStart, shift) }], rule: "preserve-working-duration" });
    else {
      const finish = addDays(a.plannedFinish, shift);
      onRequestMove({ kind: "dates", moves: [{ key: a.key, start: a.plannedStart, finish: finish < a.plannedStart ? a.plannedStart : finish }], rule: "keep-finish" });
    }
  }

  const months: { start: ISODate; label: string; w: number }[] = [];
  for (const d of days) {
    if (d === from || d.slice(8) === "01") months.push({ start: d, label: `${monthShort(d)} ${d.slice(0, 4)}`, w: 0 });
    months[months.length - 1].w += dayW;
  }
  const weekStarts = days.filter((d) => isoWeekday(d) === 1);

  return (
    <div className="relative max-h-[65dvh] overflow-auto rounded-lg border bg-background" onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div style={{ width: LABEL_W + width }} className="relative">
        {/* Header */}
        <div className="sticky top-0 z-20 flex border-b bg-background">
          <div className="sticky left-0 z-30 flex items-end border-r bg-background px-2 pb-1 text-xs font-medium text-muted-foreground" style={{ width: LABEL_W, minWidth: LABEL_W }}>
            Activity
          </div>
          <div className="relative" style={{ width, height: 62 }}>
            <div className="absolute inset-x-0 top-0 flex h-5 text-[11px] font-medium">
              {months.map((m) => (
                <div key={m.start} className="truncate border-r px-1" style={{ width: m.w }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 top-5 h-5 text-[10px] text-muted-foreground">
              {(zoom === "day" ? days : weekStarts).map((d) => (
                <div key={d} className="absolute border-l px-0.5" style={{ left: x(d), width: zoom === "day" ? dayW : 7 * dayW }}>
                  {zoom === "day" ? d.slice(8) : formatDayMonth(d)}
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 top-10 h-[22px]">
              {milestones.map(({ m, date }) => (
                <div key={m.id} className="absolute -translate-x-1/2 text-center" style={{ left: x(date) + dayW / 2, top: 0 }} title={`${m.code} ${m.name}: ${formatDate(date)} ${m.reviewStatus === "CONFIRMED" ? "(confirmed)" : "(candidate — needs review)"}`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M6 1 L11 6 L6 11 L1 6 Z" fill={m.reviewStatus === "CONFIRMED" ? "#1c1e21" : "#ffffff"} stroke="#1c1e21" strokeWidth="1.5" />
                  </svg>
                  <div className="-mt-0.5 whitespace-nowrap text-[9px] leading-none">{m.code}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="relative flex">
          <div className="sticky left-0 z-10 border-r bg-background" style={{ width: LABEL_W, minWidth: LABEL_W }}>
            {layout.rows.map((r) =>
              r.type === "group" ? (
                <button
                  key={`g:${r.id}`}
                  type="button"
                  className="flex w-full items-center gap-1 border-b bg-muted/60 px-2 text-left text-xs font-semibold"
                  style={{ height: ROW_H }}
                  aria-expanded={!collapsed.has(r.id)}
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    setCollapsed(next);
                  }}
                >
                  {collapsed.has(r.id) ? "▸" : "▾"} {r.label} <span className="font-normal text-muted-foreground">({r.items.length})</span>
                </button>
              ) : (
                <button key={r.a.key} type="button" onClick={() => onSelect(r.a.key)} className={cn("block w-full truncate border-b px-2 text-left text-xs", selectedKey === r.a.key && "bg-accent")} style={{ height: ROW_H }} title={`${r.a.code} ${r.a.name}`}>
                  <span className="font-medium">{r.a.code}</span> {r.a.name}
                </button>
              ),
            )}
          </div>
          <div className="relative" style={{ width, height: layout.rows.length * ROW_H }}>
            {/* Closed-day shading (text cue in day zoom header via tooltip) */}
            {zoom === "day"
              ? days
                  .filter((d) => !cal.isWorkingDay(d))
                  .map((d) => <div key={d} className="hatch-closed absolute inset-y-0 opacity-70" style={{ left: x(d), width: dayW }} title={`${formatDate(d)}: closed`} />)
              : weekStarts.map((d) => <div key={d} className="absolute inset-y-0 border-l border-dashed border-border/60" style={{ left: x(d) }} />)}
            {today >= from && today <= to ? <div className="absolute inset-y-0 w-px bg-destructive/70" style={{ left: x(today) }} title={`Today ${formatDate(today)}`} /> : null}
            {milestones.map(({ m, date }) => (
              <div key={m.id} className="absolute inset-y-0 w-px bg-foreground/15" style={{ left: x(date) + dayW / 2 }} />
            ))}
            {layout.rows.map((r, i) => {
              if (r.type === "group") {
                if (!r.items.length) return null;
                const s = r.items.reduce((m, a) => (a.plannedStart < m ? a.plannedStart : m), r.items[0].plannedStart);
                const f = r.items.reduce((m, a) => (a.plannedFinish > m ? a.plannedFinish : m), r.items[0].plannedFinish);
                return <div key={`gb:${r.id}`} className="absolute h-1.5 rounded bg-foreground/50" style={{ top: i * ROW_H + ROW_H / 2 - 3, left: x(s), width: Math.max(dayW, x(addDays(f, 1)) - x(s)) }} title={`${r.label}: ${formatDate(s)} – ${formatDate(f)}`} />;
              }
              const a = r.a;
              const p = progress.get(a.key);
              const dragging = drag?.key === a.key ? drag : null;
              const dxDays = dragging ? Math.round(dragging.dx / dayW) : 0;
              const left = x(a.plannedStart) + (dragging?.mode === "move" ? dxDays * dayW : 0);
              const w = Math.max(dayW, x(addDays(a.plannedFinish, 1)) - x(a.plannedStart) + (dragging?.mode === "resize" ? dxDays * dayW : 0));
              const status = p?.status ?? "NOT_STARTED";
              const pct = p?.percentComplete ?? (status === "COMPLETE" ? 100 : 0);
              const label = `${a.code} ${a.name}: ${formatDate(a.plannedStart)} – ${formatDate(a.plannedFinish)} · ${status.replace("_", " ").toLowerCase()}${pct ? ` ${pct}%` : ""}`;
              return (
                <div key={a.key} className="absolute inset-x-0" style={{ top: i * ROW_H, height: ROW_H }}>
                  {(sources.get(a.key) ?? []).map((s) =>
                    s.start && s.finish ? (
                      <div key={s.externalId} className={cn("absolute h-1 rounded-sm", s.removed ? "bg-destructive/40" : "bg-foreground/30")} style={{ top: ROW_H - 6, left: x(s.start), width: Math.max(dayW, x(addDays(s.finish, 1)) - x(s.start)) }} title={`Source ${s.externalId} (${s.lineageName} ${s.versionLabel}): ${formatDate(s.start)} – ${formatDate(s.finish)}${s.removed ? " — removed in latest version" : ""}`} />
                    ) : null,
                  )}
                  <button
                    type="button"
                    aria-label={label}
                    title={label}
                    onClick={() => onSelect(a.key)}
                    onKeyDown={(e) => {
                      if (!canEdit || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                      e.preventDefault();
                      const step = e.key === "ArrowRight" ? 1 : -1;
                      if (e.shiftKey) onRequestMove({ kind: "dates", moves: [{ key: a.key, start: a.plannedStart, finish: addDays(a.plannedFinish, step) }], rule: "keep-finish" });
                      else onRequestMove({ kind: "dates", moves: [{ key: a.key, start: addDays(a.plannedStart, step) }], rule: "preserve-working-duration" });
                    }}
                    onPointerDown={(e) => {
                      if (!canEdit || status === "COMPLETE") return;
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      const d: Drag = { key: a.key, mode: (e.target as HTMLElement).dataset.handle === "end" ? "resize" : "move", startX: e.clientX, dx: 0 };
                      dragRef.current = d;
                      setDrag(d);
                    }}
                    onPointerMove={(e) => {
                      const d = dragRef.current;
                      if (!d || d.key !== a.key) return;
                      const next = { ...d, dx: e.clientX - d.startX };
                      dragRef.current = next;
                      setDrag(next);
                    }}
                    className={cn(
                      "absolute flex items-center overflow-hidden rounded px-1 text-left text-[10px] leading-none text-white outline-offset-1 focus-visible:outline-2 focus-visible:outline-brand",
                      status === "COMPLETE" ? "bg-[#4b5057]" : status === "ON_HOLD" ? "bg-[#9a5b00]" : "bg-brand",
                      selectedKey === a.key && "ring-2 ring-foreground ring-offset-1",
                      canEdit && status !== "COMPLETE" ? "cursor-grab" : "cursor-pointer",
                      dragging && "opacity-80",
                    )}
                    style={{ top: 5, height: ROW_H - 13, left, width: w }}
                  >
                    {status === "IN_PROGRESS" && pct ? <span className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${pct}%` }} aria-hidden /> : null}
                    {status === "ON_HOLD" ? <span className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,255,255,.25)_4px_8px)]" aria-hidden /> : null}
                    <span className="relative truncate">
                      {status === "COMPLETE" ? "✓ " : status === "ON_HOLD" ? "❚❚ " : ""}
                      {w > 60 ? a.code : ""}
                      {status === "IN_PROGRESS" && w > 90 ? ` ${pct}%` : ""}
                    </span>
                    {canEdit && status !== "COMPLETE" ? <span data-handle="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/30" aria-hidden /> : null}
                  </button>
                  {dragging ? (
                    <div className="pointer-events-none absolute -top-0.5 z-10 rounded bg-foreground px-1 text-[10px] text-white" style={{ left: left + w + 4 }}>
                      {dragging.mode === "move" ? `${dxDays >= 0 ? "+" : ""}${dxDays} d` : `finish ${formatDate(addDays(a.plannedFinish, dxDays))}`}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <svg className="pointer-events-none absolute inset-0" width={width} height={layout.rows.length * ROW_H} aria-hidden>
              <defs>
                <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#5f646b" />
                </marker>
              </defs>
              {data.links.map((l) => {
                const y1 = layout.yByKey.get(l.predecessorKey);
                const y2 = layout.yByKey.get(l.successorKey);
                const p = activities.find((a) => a.key === l.predecessorKey);
                const s = activities.find((a) => a.key === l.successorKey);
                if (y1 === undefined || y2 === undefined || !p || !s) return null;
                const x1 = x(addDays(p.plannedFinish, 1));
                const x2 = x(s.plannedStart);
                const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
                return <path key={`${l.predecessorKey}>${l.successorKey}`} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} fill="none" stroke="#5f646b" strokeWidth="1" markerEnd="url(#arrow)" />;
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
