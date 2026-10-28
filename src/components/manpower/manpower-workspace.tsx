"use client";

import { Plus, UserPlus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CapacityDialog, PlanBar, type CapacityProblem } from "@/components/plan/plan-bar";
import { usePlanEditor } from "@/components/plan/use-plan-editor";
import { ActivityPanel } from "@/components/schedule/activity-panel";
import { MovePreviewDialog } from "@/components/schedule/move-preview";
import { ScheduleTimeline, type GroupBy } from "@/components/schedule/timeline";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTree, effectiveTargets, isAreaWithin } from "@/domain/capacity";
import { addDays, eachWeek, formatDate, startOfWeek, type ISODate } from "@/domain/dates";
import { buildGridModel } from "@/domain/grid";
import { computeMeasures, planDateRange, type MeasureFilter } from "@/domain/metrics";
import type { MoveRequest } from "@/domain/move";
import type { PlanOp } from "@/domain/ops";
import { todayInTimeZone } from "@/domain/tz";
import { formatHours } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { MEASURE_LABELS, ManpowerChart, type ChartMeasure } from "@/reporting/manpower-chart";
import type { PlanView } from "@/server/services/plans";
import { LeadershipPanel } from "./leadership-panel";
import { ManpowerGrid, SUMMARY_LABELS, type CellRef, type GridRowData } from "./manpower-grid";
import { NodeFormDialog } from "./node-form";
import { NodePanel } from "./node-panel";

type Selection =
  | { kind: "node"; key: string; week: ISODate | null }
  | { kind: "leader"; key: string; week: ISODate | null }
  | { kind: "newLeader" }
  | { kind: "activity"; key: string }
  | { kind: "info"; title: string; body: string }
  | null;

const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";

export function defaultRange(view: PlanView["data"]): { from: ISODate; to: ISODate } {
  const r = planDateRange(view);
  const today = startOfWeek(todayInTimeZone(view.project.timezone));
  if (!r) return { from: today, to: addDays(today, 7 * 25) };
  const from = startOfWeek(r.start);
  let to = startOfWeek(r.end);
  if (eachWeek(from, to).length < 12) to = addDays(from, 7 * 11);
  return { from, to };
}

export function ManpowerWorkspace({ view, workspaceRoles }: { view: PlanView; workspaceRoles: string[] }) {
  const editor = usePlanEditor(view.data, view.canEdit);
  const { data } = editor;
  const [people, setPeople] = useState(view.people);
  const [range, setRangeRaw] = useState(() => defaultRange(view.data));
  // Keep at least one week and never let the end precede the start.
  const setRange = (r: { from: ISODate; to: ISODate }) => setRangeRaw(r.to < r.from ? { from: r.from, to: addDays(r.from, 7 * 25) } : r);
  const [filters, setFilters] = useState({ phaseId: "", systemId: "", areaId: "", search: "" });
  const [measure, setMeasure] = useState<ChartMeasure>("peak");
  const [tab, setTab] = useState("grid");
  const [groupBy, setGroupBy] = useState<GroupBy>("phase");
  const [zoom, setZoom] = useState<"day" | "week">("week");
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [rangeSel, setRangeSel] = useState<{ rowId: string; from: ISODate; to: ISODate } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [capacityProblem, setCapacityProblem] = useState<CapacityProblem | null>(null);
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null);
  const [addPool, setAddPool] = useState(false);
  const wide = useMediaQuery("(min-width: 1280px)");

  const weeks = useMemo(() => eachWeek(range.from, range.to).slice(0, 260), [range]);
  const model = useMemo(() => buildGridModel(data, weeks), [data, weeks]);

  // Filters apply to both grid rows and timeline activities.
  const filterActive = Boolean(filters.phaseId || filters.systemId || filters.areaId);
  const areaMap = useMemo(() => new Map(data.areas.map((a) => [a.id, a])), [data.areas]);
  const matchTargets = useCallback(
    (t: { phaseId: string | null; systemId: string | null; areaId: string | null }) =>
      (!filters.phaseId || t.phaseId === filters.phaseId) && (!filters.systemId || t.systemId === filters.systemId) && (!filters.areaId || (t.areaId !== null && isAreaWithin(areaMap, t.areaId, filters.areaId))),
    [filters, areaMap],
  );
  const visibleNodeKeys = useMemo(() => {
    if (!filterActive && !filters.search) return null;
    const tree = buildTree(data.nodes);
    const eff = effectiveTargets(data, tree);
    const q = filters.search.toLowerCase();
    return new Set(data.nodes.filter((n) => (!filterActive || (n.kind !== "POOL" && matchTargets(eff.get(n.key)!))) && (!q || n.name.toLowerCase().includes(q))).map((n) => n.key));
  }, [data, filterActive, filters.search, matchTargets]);
  const allocationLabel = filterActive
    ? [data.phases.find((p) => p.id === filters.phaseId)?.name, data.systems.find((s) => s.id === filters.systemId)?.name, data.areas.find((a) => a.id === filters.areaId)?.name].filter(Boolean).join(" · ")
    : null;
  const measureFilter: MeasureFilter = useMemo(
    () =>
      filterActive
        ? {
            allocation: (t) => matchTargets(t),
            leadership: (l) => (!filters.systemId || l.responsibilitySystemIds.includes(filters.systemId)) && (!filters.phaseId || l.responsibilityPhaseIds.length === 0 || l.responsibilityPhaseIds.includes(filters.phaseId)),
          }
        : {},
    [filterActive, matchTargets, filters.systemId, filters.phaseId],
  );
  const measures = useMemo(() => computeMeasures(data, range.from, range.to, measureFilter), [data, range, measureFilter]);
  const activities = useMemo(() => {
    const q = filters.search.toLowerCase();
    return data.activities.filter((a) => !a.archived && (!filterActive || matchTargets(a)) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q))).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart) || a.code.localeCompare(b.code));
  }, [data.activities, filterActive, filters.search, matchTargets]);

  const apply = useCallback(
    (ops: PlanOp[], summary?: string): boolean => {
      const r = editor.apply(ops, summary);
      if (!r.ok) {
        if (r.issues?.length) setCapacityProblem({ ops, summary, issues: r.issues });
        else toast.error(r.message ?? "Change not applied");
      }
      return r.ok;
    },
    [editor],
  );

  const onSelectCell = (cell: CellRef | null, extend?: boolean) => {
    if (!cell) return;
    if (extend && selected && selected.rowId === cell.rowId) {
      const [a, b] = [selected.week, cell.week].sort();
      setRangeSel({ rowId: cell.rowId, from: a, to: b });
      setSelected(cell);
      return;
    }
    setRangeSel(null);
    setSelected(cell);
    if (cell.rowId.startsWith("node:")) setSelection({ kind: "node", key: cell.rowId.slice(5), week: cell.week });
    else if (cell.rowId.startsWith("leader:")) setSelection({ kind: "leader", key: cell.rowId.slice(7), week: cell.week });
    else if (cell.rowId.startsWith("sum:")) {
      const metric = cell.rowId.slice(4) as keyof typeof SUMMARY_LABELS;
      setSelection({ kind: "info", title: SUMMARY_LABELS[metric], body: metricHelp(metric) });
    } else if (cell.rowId.startsWith("rem:")) setSelection({ kind: "info", title: "Remaining capacity", body: "Capacity in the parent row that no reservation below it has claimed for the week (minimum–maximum within the week). It is part of the same people, not additional staff." });
  };

  const onOpenRow = (row: GridRowData) => {
    if (row.type === "node") setSelection({ kind: "node", key: row.nodeKey, week: selected?.week ?? null });
    if (row.type === "leader") setSelection({ kind: "leader", key: row.leaderKey, week: selected?.week ?? null });
    if (row.type === "summary") setSelection({ kind: "info", title: row.label, body: metricHelp(row.metric) });
  };

  const fillSelection = (value: number | null) => {
    if (!rangeSel || !rangeSel.rowId.startsWith("node:")) return;
    apply([{ type: "setWeeks", nodeKey: rangeSel.rowId.slice(5), values: eachWeek(rangeSel.from, rangeSel.to).map((w) => ({ week: w, headcount: value })) }], value === null ? "Clear weeks" : `Fill weeks with ${value}`);
  };

  const copyWeek = () => {
    if (!selected?.rowId.startsWith("node:")) return;
    const v = model.nodeRows.find((r) => r.node.key === selected.rowId.slice(5))?.cells.get(selected.week)?.weeklyValue ?? null;
    void navigator.clipboard?.writeText(v === null ? "" : String(v));
    sessionStorage.setItem("fieldops-copied-week", JSON.stringify({ value: v }));
    toast.success(`Copied week of ${formatDate(selected.week)} (${v ?? "blank"})`);
  };
  const pasteWeek = () => {
    const raw = sessionStorage.getItem("fieldops-copied-week");
    const target = rangeSel ?? (selected ? { rowId: selected.rowId, from: selected.week, to: selected.week } : null);
    if (!raw || !target || !target.rowId.startsWith("node:")) return;
    const { value } = JSON.parse(raw) as { value: number | null };
    apply([{ type: "setWeeks", nodeKey: target.rowId.slice(5), values: eachWeek(target.from, target.to).map((w) => ({ week: w, headcount: value })) }], "Paste week");
  };

  const panel = renderPanel();
  function renderPanel() {
    if (!selection) return null;
    if (selection.kind === "node") {
      const node = data.nodes.find((n) => n.key === selection.key);
      if (!node) return null;
      return <NodePanel key={node.key} data={data} model={model} node={node} week={selection.week} canEdit={editor.canEdit} apply={apply} onSelectWeek={(w) => setSelection({ ...selection, week: w })} />;
    }
    if (selection.kind === "leader" || selection.kind === "newLeader") {
      const a = selection.kind === "leader" ? (data.leadership.find((l) => l.key === selection.key) ?? null) : null;
      const week = selection.kind === "leader" ? selection.week : null;
      const row = a ? model.leaderRows.find((r) => r.key === a.key) : null;
      return (
        <LeadershipPanel
          key={`${a?.key ?? "new"}:${data.plan.revision}`}
          data={data}
          assignment={a}
          people={people}
          roles={workspaceRoles}
          canEdit={editor.canEdit}
          week={week}
          weekSummary={week && row ? (row.cells.get(week) ?? null) : null}
          apply={apply}
          onPeopleChanged={(p) => setPeople([...people, p].sort((x, y) => x.displayName.localeCompare(y.displayName)))}
          onDone={() => setSelection(null)}
        />
      );
    }
    if (selection.kind === "activity") {
      const act = data.activities.find((a) => a.key === selection.key);
      if (!act) return null;
      return <ActivityPanel key={`${act.key}:${data.plan.revision}`} data={data} activity={act} canEdit={editor.canEdit} apply={apply} onRequestMove={setMoveRequest} onSelectNode={(k) => setSelection({ kind: "node", key: k, week: null })} />;
    }
    return (
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{selection.title}</h2>
        <p className="text-sm text-muted-foreground">{selection.body}</p>
      </div>
    );
  }

  const peak = measures.totals;
  const hasStaffing = data.entries.length > 0 || data.leadership.length > 0;

  return (
    <div className="flex min-h-0">
      <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-4">
        <PlanBar editor={editor} plans={view.plans} basePath={`/projects/${data.project.id}/manpower`} />
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-2">
          <label className="text-xs">
            <span className="block text-muted-foreground">From week</span>
            <Input type="date" className="h-8 w-36" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: startOfWeek(e.target.value) })} />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">To week</span>
            <Input type="date" className="h-8 w-36" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: startOfWeek(e.target.value) })} />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Phase</span>
            <select className={selectCls} value={filters.phaseId} onChange={(e) => setFilters({ ...filters, phaseId: e.target.value })}>
              <option value="">All phases</option>
              {data.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">System</span>
            <select className={selectCls} value={filters.systemId} onChange={(e) => setFilters({ ...filters, systemId: e.target.value })}>
              <option value="">All systems</option>
              {data.systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Area</span>
            <select className={selectCls} value={filters.areaId} onChange={(e) => setFilters({ ...filters, areaId: e.target.value })}>
              <option value="">All areas</option>
              {data.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Search</span>
            <Input className="h-8 w-40" placeholder="Row or activity" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </label>
          {filterActive || filters.search ? (
            <Button size="sm" variant="ghost" onClick={() => setFilters({ phaseId: "", systemId: "", areaId: "", search: "" })}>
              <X className="size-3.5" /> Clear filters
            </Button>
          ) : null}
          {editor.canEdit ? (
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setAddPool(true)}>
                <Plus className="size-3.5" /> Workforce pool
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelection({ kind: "newLeader" })}>
                <UserPlus className="size-3.5" /> Leadership
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={filterActive ? "Peak allocated onsite" : "Peak onsite (period)"} value={String(peak.peakTotal)} sub={`${peak.peakInstallers} installers · ${peak.peakLeadership} leadership (separate peaks)`} />
          <Stat label="Installer hours" value={formatHours(peak.installerHours)} />
          <Stat label="Leadership hours" value={formatHours(peak.leadershipHours)} />
          <Stat label="Total onsite hours" value={formatHours(peak.totalHours)} sub={filterActive ? `Allocation view: ${allocationLabel}` : "All project labor"} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="grid">Manpower grid</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
            {tab === "grid" && rangeSel && editor.canEdit ? (
              <div className="flex flex-wrap items-center gap-1 text-xs" role="toolbar" aria-label="Selected weeks">
                <span>
                  {eachWeek(rangeSel.from, rangeSel.to).length} weeks selected
                </span>
                <FillInline onFill={fillSelection} />
                <Button size="sm" variant="outline" onClick={() => fillSelection(null)}>
                  Clear
                </Button>
                <Button size="sm" variant="outline" onClick={pasteWeek}>
                  Paste copied week
                </Button>
              </div>
            ) : tab === "grid" && selected?.rowId.startsWith("node:") ? (
              <div className="flex gap-1 text-xs">
                <Button size="sm" variant="ghost" onClick={copyWeek}>
                  Copy week
                </Button>
                {editor.canEdit ? (
                  <Button size="sm" variant="ghost" onClick={pasteWeek}>
                    Paste
                  </Button>
                ) : null}
                <span className="self-center text-muted-foreground">Shift+click or Shift+→ selects a range of weeks</span>
              </div>
            ) : null}
            {tab === "timeline" ? (
              <div className="flex gap-2 text-xs">
                <select aria-label="Group by" className={selectCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  <option value="phase">Group by phase</option>
                  <option value="area">Group by area</option>
                  <option value="system">Group by system</option>
                  <option value="none">No grouping</option>
                </select>
                <select aria-label="Zoom" className={selectCls} value={zoom} onChange={(e) => setZoom(e.target.value as "day" | "week")}>
                  <option value="week">Week zoom</option>
                  <option value="day">Day zoom</option>
                </select>
              </div>
            ) : null}
          </div>
          <TabsContent value="grid" className="space-y-3">
            {!hasStaffing ? (
              <div className="rounded-md border border-dashed bg-background px-3 py-2 text-sm text-muted-foreground">
                Enter weekly installer counts in the <strong>Installers — shared workforce</strong> row (type a number in a week cell), then add the PM and foreman with <strong>Leadership</strong>. Room-level allocation is optional.
              </div>
            ) : null}
            <ManpowerGrid
              model={model}
              weeks={measures.weeks}
              visibleNodeKeys={visibleNodeKeys}
              allocationLabel={allocationLabel}
              canEdit={editor.canEdit}
              selected={selected}
              selection={rangeSel}
              onSelect={onSelectCell}
              onEditWeeks={(nodeKey, values) => apply([{ type: "setWeeks", nodeKey, values }])}
              onOpenRow={onOpenRow}
              onRejectInput={(m) => toast.error(m)}
            />
          </TabsContent>
          <TabsContent value="timeline">
            {activities.length === 0 ? (
              <EmptyState title="No activities in view">Add installation activities on the Schedule tab, or clear filters. Project-level manpower does not require activities.</EmptyState>
            ) : (
              <ScheduleTimeline data={data} activities={activities} groupBy={groupBy} zoom={zoom} from={addDays(range.from, -7)} to={addDays(range.to, 13)} selectedKey={selection?.kind === "activity" ? selection.key : null} onSelect={(k) => setSelection({ kind: "activity", key: k })} canEdit={editor.canEdit} onRequestMove={setMoveRequest} />
            )}
          </TabsContent>
        </Tabs>

        <section className="rounded-lg border bg-background p-3" aria-label="Manpower chart">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {MEASURE_LABELS[measure]}
              {filterActive ? <span className="ml-2 font-normal text-warning">Allocation view: {allocationLabel} — not total project staffing</span> : null}
            </h2>
            <select aria-label="Chart measure" className={selectCls} value={measure} onChange={(e) => setMeasure(e.target.value as ChartMeasure)}>
              <option value="peak">Peak concurrent onsite</option>
              <option value="hours">Planned labor hours</option>
              <option value="average">Average equivalent staffing</option>
            </select>
          </div>
          <ManpowerChart
            weeks={measures.weeks.map((w) => ({ week: w.start, installerPeak: w.installerPeak, installersAtPeak: w.installersAtPeak, leadershipAtPeak: w.leadershipAtPeak, totalPeak: w.totalPeak, installerHours: w.installerHours, leadershipHours: w.leadershipHours, calendarHours: w.calendarHours, averageEquivalent: w.averageEquivalent }))}
            measure={measure}
            activeWeek={selected?.week ?? null}
            onSelectWeek={(w) => setSelected(selected ? { ...selected, week: w } : { rowId: "sum:totalPeak", week: w })}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Peak = most people onsite at the same instant in the week (not a sum of days, not unique visitors, not FTE). Average equivalent staffing = onsite person-hours ÷ project calendar hours; n/a when the calendar is closed.
          </p>
        </section>
      </div>

      <aside className="sticky top-0 hidden h-dvh w-[380px] shrink-0 overflow-y-auto border-l bg-background p-4 xl:block" aria-label="Details">
        {panel ?? <p className="text-sm text-muted-foreground">Select a row, week cell, leadership assignment, or timeline activity to see details and edit.</p>}
      </aside>
      <Sheet open={Boolean(panel) && !wide} onOpenChange={(o) => !o && setSelection(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-md xl:hidden">
          <SheetTitle className="sr-only">Details</SheetTitle>
          {panel}
        </SheetContent>
      </Sheet>

      <CapacityDialog problem={capacityProblem} editor={editor} onRetry={(ops, summary) => apply(ops, summary)} onClose={() => setCapacityProblem(null)} />
      {moveRequest ? <MovePreviewDialog key={JSON.stringify(moveRequest)} data={data} request={moveRequest} onCancel={() => setMoveRequest(null)} onApply={apply} /> : null}
      {addPool ? <NodeFormDialog data={data} mode="add" kind="POOL" parentKey={null} apply={apply} onClose={() => setAddPool(false)} /> : null}
    </div>
  );
}

function metricHelp(metric: keyof typeof SUMMARY_LABELS): string {
  switch (metric) {
    case "installerPeak":
      return "Most installers onsite at the same instant in the week, from workforce pool capacity. Reservations and crews explain where they work and are never added again.";
    case "leadershipPeak":
      return "Most leaders onsite at the same instant. A person with several responsibilities counts once. Offsite management hours are excluded.";
    case "totalPeak":
      return "Most people onsite at the same instant (installers + leadership together). It can be lower than the two separate peaks added, when they occur at different times.";
    case "installerHours":
    case "leadershipHours":
    case "totalHours":
      return "Planned labor hours: headcount × scheduled block hours, attributed to the week in which the hours occur.";
    case "calendarHours":
      return "Open hours in the project calendar for the week (the denominator for average equivalent staffing).";
    case "averageEquivalent":
      return "Onsite person-hours ÷ project calendar hours for the week. Shown as n/a when the calendar has no open hours.";
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function FillInline({ onFill }: { onFill: (n: number) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <Input aria-label="Fill value" inputMode="numeric" className="h-7 w-14 text-right" value={v} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" variant="outline" disabled={!/^\d+$/.test(v)} onClick={() => onFill(Number(v))}>
        Fill
      </Button>
    </span>
  );
}

