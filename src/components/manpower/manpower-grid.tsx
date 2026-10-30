"use client";

import { getCoreRowModel, getExpandedRowModel, useReactTable, type ColumnDef, type ExpandedState, type Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDate, formatDayMonth, isoWeekNumber, type ISODate } from "@/domain/dates";
import type { GridModel } from "@/domain/grid";
import type { PeriodMeasure } from "@/domain/metrics";
import { cn } from "@/lib/utils";

export type GridRowData =
  | { id: string; type: "section"; label: string; subRows?: GridRowData[] }
  | { id: string; type: "node"; nodeKey: string; label: string; sub: string; kind: string; depth: number; subRows?: GridRowData[] }
  | { id: string; type: "remaining"; parentKey: string; label: string; depth: number; subRows?: GridRowData[] }
  | { id: string; type: "leader"; leaderKey: string; label: string; sub: string; datesSelected: boolean; subRows?: GridRowData[] }
  | { id: string; type: "summary"; metric: SummaryMetric; label: string; subRows?: GridRowData[] };

export type SummaryMetric = "installerPeak" | "leadershipPeak" | "totalPeak" | "installerHours" | "leadershipHours" | "totalHours" | "calendarHours" | "averageEquivalent";

export const SUMMARY_LABELS: Record<SummaryMetric, string> = {
  installerPeak: "Peak installers onsite",
  leadershipPeak: "Peak leadership onsite",
  totalPeak: "Peak total onsite",
  installerHours: "Installer hours",
  leadershipHours: "Leadership hours",
  totalHours: "Total onsite hours",
  calendarHours: "Project calendar hours",
  averageEquivalent: "Avg equivalent staffing",
};

export interface CellRef {
  rowId: string;
  week: ISODate;
}

interface Props {
  model: GridModel;
  weeks: PeriodMeasure[];
  visibleNodeKeys: Set<string> | null;
  allocationLabel: string | null;
  canEdit: boolean;
  selected: CellRef | null;
  selection: { rowId: string; from: ISODate; to: ISODate } | null;
  onSelect: (cell: CellRef | null, extend?: boolean) => void;
  onEditWeeks: (nodeKey: string, values: { week: ISODate; headcount: number | null }[]) => void;
  onOpenRow: (row: GridRowData) => void;
  onRejectInput: (message: string) => void;
}

const LABEL_W = 280;
const COL_W = 62;

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function ManpowerGrid({ model, weeks, visibleNodeKeys, allocationLabel, canEdit, selected, selection, onSelect, onEditWeeks, onOpenRow, onRejectInput }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [editing, setEditing] = useState<{ cell: CellRef; value: string } | null>(null);
  const weekIds = useMemo(() => model.weeks.map((w) => w.week), [model.weeks]);
  const weekInfo = useMemo(() => new Map(model.weeks.map((w) => [w.week, w])), [model.weeks]);
  const measureByWeek = useMemo(() => new Map(weeks.map((w) => [w.start, w])), [weeks]);
  const nodeRows = useMemo(() => new Map(model.nodeRows.map((r) => [r.node.key, r])), [model.nodeRows]);
  const leaderRows = useMemo(() => new Map(model.leaderRows.map((r) => [r.key, r])), [model.leaderRows]);

  const data = useMemo<GridRowData[]>(() => {
    const build = (key: string, depth: number): GridRowData | null => {
      const r = nodeRows.get(key)!;
      const kids = r.childKeys.map((k) => build(k, depth + 1)).filter(Boolean) as GridRowData[];
      if (visibleNodeKeys && !visibleNodeKeys.has(key) && kids.length === 0) return null;
      const subRows = [...kids];
      if (r.childKeys.length) subRows.push({ id: `rem:${key}`, type: "remaining", parentKey: key, label: r.node.kind === "POOL" ? "Shared / not reserved" : `Remaining in ${r.node.name}`, depth: depth + 1 });
      return { id: `node:${key}`, type: "node", nodeKey: key, label: r.node.name, sub: r.targetsLabel, kind: r.node.kind, depth, subRows };
    };
    const pools = model.tree.roots.map((k) => build(k, 0)).filter(Boolean) as GridRowData[];
    const leaders: GridRowData[] = model.leaderRows.map((l) => ({ id: `leader:${l.key}`, type: "leader", leaderKey: l.key, label: l.isPlaceholder ? `${l.personName} (to be named)` : l.personName, sub: `${l.role} · ${l.responsibility}`, datesSelected: l.datesSelected }));
    const metrics: SummaryMetric[] = ["installerPeak", "leadershipPeak", "totalPeak", "installerHours", "leadershipHours", "totalHours", "calendarHours", "averageEquivalent"];
    return [
      { id: "sec:installers", type: "section", label: "Installer workforce", subRows: pools },
      { id: "sec:leaders", type: "section", label: "Onsite leadership", subRows: leaders },
      { id: "sec:summary", type: "section", label: allocationLabel ? `Totals — allocation view: ${allocationLabel}` : "Project totals (all labor)", subRows: metrics.map((m) => ({ id: `sum:${m}`, type: "summary", metric: m, label: SUMMARY_LABELS[m] })) },
    ];
  }, [model.tree.roots, model.leaderRows, nodeRows, visibleNodeKeys, allocationLabel]);

  const columns = useMemo<ColumnDef<GridRowData>[]>(() => [{ id: "label", header: "Row" }, ...weekIds.map((w) => ({ id: w, header: w }))], [weekIds]);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table/Virtual return unmemoizable functions; React Compiler skips this component by design.
  const table = useReactTable({ data, columns, state: { expanded }, onExpandedChange: setExpanded, getSubRows: (r) => r.subRows, getCoreRowModel: getCoreRowModel(), getExpandedRowModel: getExpandedRowModel(), getRowId: (r) => r.id });
  const rows = table.getRowModel().rows;

  // Week columns start after the frozen label column, so the virtualizer uses it as scroll margin:
  // item starts include the margin, the total size does not.
  const colVirtualizer = useVirtualizer({ horizontal: true, count: weekIds.length, getScrollElement: () => scrollRef.current, estimateSize: () => COL_W, overscan: 8, scrollMargin: LABEL_W, initialRect: { width: 1200, height: 600 } });
  const virtualCols = colVirtualizer.getVirtualItems();
  const totalSize = colVirtualizer.getTotalSize();
  const padLeft = virtualCols.length ? virtualCols[0].start - LABEL_W : 0;
  const padRight = virtualCols.length ? totalSize - (virtualCols[virtualCols.length - 1].end - LABEL_W) : totalSize;

  const editableRow = (rowId: string) => canEdit && rowId.startsWith("node:");
  const navigable = useMemo(() => rows.filter((r) => r.original.type !== "section").map((r) => r.id), [rows]);

  /** Returns false (keeping the typed value in the editor) when the input is not a whole number. */
  const commit = useCallback(
    (cell: CellRef, raw: string): boolean => {
      const nodeKey = cell.rowId.slice(5);
      const trimmed = raw.trim();
      if (trimmed !== "" && !/^\d+$/.test(trimmed)) {
        onRejectInput(`"${trimmed}" is not a whole number of people. Enter 0 or more installers, or leave blank.`);
        setEditing({ cell, value: raw });
        return false;
      }
      setEditing(null);
      onEditWeeks(nodeKey, [{ week: cell.week, headcount: trimmed === "" ? null : Number(trimmed) }]);
      return true;
    },
    [onEditWeeks, onRejectInput],
  );

  const move = useCallback(
    (dRow: number, dCol: number, extend = false) => {
      if (!selected) return;
      const ri = navigable.indexOf(selected.rowId);
      const ci = weekIds.indexOf(selected.week);
      const nr = navigable[Math.max(0, Math.min(navigable.length - 1, ri + dRow))];
      const nc = weekIds[Math.max(0, Math.min(weekIds.length - 1, ci + dCol))];
      if (nr && nc) {
        onSelect({ rowId: extend ? selected.rowId : nr, week: nc }, extend);
        colVirtualizer.scrollToIndex(weekIds.indexOf(nc), { align: "auto" });
      }
    },
    [selected, navigable, weekIds, onSelect, colVirtualizer],
  );

  useEffect(() => {
    if (!selected || editing) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${selected.rowId}|${selected.week}`)}"]`);
    el?.focus({ preventScroll: false });
  }, [selected, editing]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!selected || editing) return;
    const k = e.key;
    if (k === "ArrowRight") move(0, 1, e.shiftKey);
    else if (k === "ArrowLeft") move(0, -1, e.shiftKey);
    else if (k === "ArrowDown") move(1, 0);
    else if (k === "ArrowUp") move(-1, 0);
    else if (k === "Tab") move(0, e.shiftKey ? -1 : 1);
    else if (k === "Enter" || k === "F2") {
      if (editableRow(selected.rowId)) {
        const r = nodeRows.get(selected.rowId.slice(5));
        setEditing({ cell: selected, value: fmtNum(r?.cells.get(selected.week)?.weeklyValue) });
      } else {
        const row = rows.find((r) => r.id === selected.rowId);
        if (row) onOpenRow(row.original);
      }
    } else if ((k === "Delete" || k === "Backspace") && editableRow(selected.rowId)) {
      commit(selected, "");
    } else if (/^\d$/.test(k) && editableRow(selected.rowId)) {
      setEditing({ cell: selected, value: k });
    } else return;
    e.preventDefault();
  }

  const inSelection = (rowId: string, week: ISODate) => selection && selection.rowId === rowId && week >= selection.from && week <= selection.to;

  function renderCell(row: Row<GridRowData>, week: ISODate) {
    const r = row.original;
    const key = `${row.id}|${week}`;
    const isSel = selected?.rowId === row.id && selected.week === week;
    const info = weekInfo.get(week)!;
    const closed = info.openDays === 0;
    const base = cn(
      "h-8 border-b border-r px-1 text-right text-[13px] tabular outline-none",
      closed && "hatch-closed",
      isSel && "ring-2 ring-inset ring-brand-line",
      inSelection(row.id, week) && !isSel && "bg-accent",
    );
    const focusProps = {
      "data-cell": key,
      tabIndex: isSel ? 0 : -1,
      role: "gridcell" as const,
      "aria-selected": isSel,
      onMouseDown: (e: React.MouseEvent) => onSelect({ rowId: row.id, week }, e.shiftKey),
      onDoubleClick: () => {
        if (editableRow(row.id)) setEditing({ cell: { rowId: row.id, week }, value: fmtNum(nodeRows.get(row.id.slice(5))?.cells.get(week)?.weeklyValue) });
        else onOpenRow(r);
      },
    };
    if (r.type === "section") return <td key={key} className="h-7 border-b bg-muted/60" />;
    if (r.type === "node") {
      const cell = nodeRows.get(r.nodeKey)?.cells.get(week);
      if (editing && editing.cell.rowId === row.id && editing.cell.week === week) {
        return (
          <td key={key} className="h-8 border-b border-r p-0">
            <input
              autoFocus
              aria-label={`${r.label}, week of ${formatDate(week)}`}
              inputMode="numeric"
              className="h-8 w-full bg-field px-1 text-right text-[13px] tabular outline-2 outline-brand-line"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onBlur={() => commit(editing.cell, editing.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  if (commit(editing.cell, editing.value)) move(e.key === "Enter" ? 1 : 0, e.key === "Tab" ? 1 : 0);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(null);
                }
              }}
            />
          </td>
        );
      }
      const label = cell?.value === null || cell?.value === undefined ? "" : String(cell.value);
      return (
        <td key={key} {...focusProps} className={cn(base, r.kind === "POOL" ? "font-semibold" : "", cell?.varies && "italic")} title={cell ? `${r.label} · week of ${formatDate(week)} · ${cell.hours} h${cell.varies ? " · daily values vary (peak shown)" : ""}${closed ? " · calendar closed this week" : ""}` : undefined}>
          {label}
          {cell?.varies ? <sup className="ml-0.5 text-[9px] text-muted-foreground" aria-label="varies by day">±</sup> : null}
          {!label && closed ? <span className="text-[10px] text-muted-foreground">closed</span> : null}
        </td>
      );
    }
    if (r.type === "remaining") {
      const rem = nodeRows.get(r.parentKey)?.remaining?.get(week);
      const text = !rem ? "" : rem.min === rem.max ? String(rem.min) : `${rem.min}–${rem.max}`;
      return (
        <td key={key} {...focusProps} className={cn(base, "bg-muted/30 text-muted-foreground", rem && rem.min < 0 && "font-semibold text-destructive")} title={rem ? `Not yet reserved within ${nodeRows.get(r.parentKey)?.node.name}` : undefined}>
          {text}
        </td>
      );
    }
    if (r.type === "leader") {
      const c = leaderRows.get(r.leaderKey)?.cells.get(week);
      return (
        <td key={key} {...focusProps} className={cn(base, "text-[12px]")} title={c ? `${c.onsiteDays} onsite day(s), ${c.hours} h` : undefined}>
          {c && c.onsiteDays > 0 ? `${c.onsiteDays}d` : ""}
        </td>
      );
    }
    const m = measureByWeek.get(week);
    let v = "";
    if (m) {
      const val = m[r.metric];
      v = r.metric === "averageEquivalent" ? (val === null ? "n/a" : fmtNum(val as number)) : fmtNum(val as number);
      if (["installerHours", "leadershipHours", "totalHours", "calendarHours"].includes(r.metric) && val === 0) v = "0";
    }
    return (
      <td key={key} {...focusProps} className={cn(base, "bg-muted/20", r.metric === "totalPeak" && "font-semibold")}>
        {v}
      </td>
    );
  }

  function renderLabel(row: Row<GridRowData>) {
    const r = row.original;
    const depth = r.type === "node" || r.type === "remaining" ? r.depth : 0;
    const toggle = row.getCanExpand() ? (
      <button type="button" className="mr-1 rounded p-0.5 hover:bg-muted" onClick={row.getToggleExpandedHandler()} aria-label={row.getIsExpanded() ? `Collapse ${r.label}` : `Expand ${r.label}`} aria-expanded={row.getIsExpanded()}>
        {row.getIsExpanded() ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
    ) : (
      <span className="mr-1 inline-block w-[18px]" />
    );
    if (r.type === "section") {
      return (
        <th scope="rowgroup" className="sticky left-0 z-10 h-7 border-b border-r bg-muted px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" style={{ width: LABEL_W, minWidth: LABEL_W }}>
          <div className="flex items-center">
            {toggle}
            {r.label}
          </div>
        </th>
      );
    }
    const sub = r.type === "node" || r.type === "leader" ? r.sub : r.type === "remaining" ? "Capacity not yet reserved (not additional people)" : "";
    return (
      <th scope="row" className={cn("sticky left-0 z-10 h-8 border-b border-r bg-background px-2 text-left font-normal", r.type === "summary" && "bg-muted/40")} style={{ width: LABEL_W, minWidth: LABEL_W }}>
        <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
          {r.type === "node" || r.type === "remaining" ? toggle : null}
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenRow(r)} title={sub || r.label}>
            <div className={cn("truncate text-[13px]", r.type === "node" && r.kind === "POOL" && "font-semibold", r.type === "remaining" && "italic text-muted-foreground", r.type === "summary" && "font-medium")}>
              {r.type === "node" && r.kind === "CREW" ? <span className="mr-1 rounded bg-secondary px-1 text-[10px] font-medium uppercase text-secondary-foreground">Crew</span> : null}
              {r.label}
              {r.type === "leader" && !r.datesSelected ? <span className="ml-1 text-[10px] text-warning">dates not set</span> : null}
            </div>
            {sub && r.type !== "remaining" ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
          </button>
          {!canEdit && r.type === "node" ? <Lock className="size-3 text-muted-foreground" aria-label="read-only" /> : null}
        </div>
      </th>
    );
  }

  return (
    <div ref={scrollRef} className="relative max-h-[60dvh] overflow-auto rounded-lg border bg-background" onKeyDown={onKeyDown}>
      <table role="grid" aria-label="Weekly manpower grid" aria-rowcount={rows.length} className="border-separate border-spacing-0" style={{ width: LABEL_W + totalSize, tableLayout: "fixed" }}>
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th scope="col" className="sticky left-0 z-30 border-b border-r bg-background px-2 py-1 text-left text-xs font-medium text-muted-foreground" style={{ width: LABEL_W, minWidth: LABEL_W }}>
              Week starting (Mon)
            </th>
            {padLeft > 0 ? <th style={{ width: padLeft, minWidth: padLeft }} /> : null}
            {virtualCols.map((vc) => {
              const w = weekIds[vc.index];
              const info = weekInfo.get(w)!;
              return (
                <th key={w} scope="col" className={cn("border-b border-r px-1 py-1 text-right align-bottom text-[11px] font-medium", info.openDays === 0 && "hatch-closed")} style={{ width: COL_W, minWidth: COL_W }} title={`Week of ${formatDate(w)} – ${formatDate(addDays(w, 6))}: ${info.openDays} open day(s), ${info.calendarHours} calendar h`}>
                  <div className="text-muted-foreground">W{isoWeekNumber(w)}</div>
                  <div>{formatDayMonth(w)}</div>
                  <div className="text-[10px] font-normal text-muted-foreground">{info.openDays === 0 ? "closed" : `${info.openDays}d`}</div>
                </th>
              );
            })}
            {padRight > 0 ? <th style={{ width: padRight, minWidth: padRight }} /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group">
              {renderLabel(row)}
              {padLeft > 0 ? <td className="border-b" style={{ width: padLeft }} /> : null}
              {virtualCols.map((vc) => renderCell(row, weekIds[vc.index]))}
              {padRight > 0 ? <td className="border-b" style={{ width: padRight }} /> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
