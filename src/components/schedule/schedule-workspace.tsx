"use client";

import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDownUp, MoveHorizontal, Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CapacityDialog, PlanBar, type CapacityProblem } from "@/components/plan/plan-bar";
import { usePlanEditor } from "@/components/plan/use-plan-editor";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isAreaWithin } from "@/domain/capacity";
import { addDays, formatDate, maxDate, minDate, startOfWeek } from "@/domain/dates";
import { computePlanningIssues, ISSUE_CATEGORY_LABELS } from "@/domain/issues";
import type { MoveRequest } from "@/domain/move";
import type { PlanOp } from "@/domain/ops";
import type { ActivityInput } from "@/domain/plan";
import { finishForDuration } from "@/domain/calendar";
import { workingDuration } from "@/domain/schedule";
import { projectResolver } from "@/domain/staffing";
import { todayInTimeZone } from "@/domain/tz";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { PlanView } from "@/server/services/plans";
import { areaOptions } from "@/components/manpower/node-form";
import { ActivityPanel } from "./activity-panel";
import { MovePreviewDialog } from "./move-preview";
import { groupActivities, ScheduleTimeline, type GroupBy } from "./timeline";

const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
const STATUS_TEXT: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETE: "Complete", ON_HOLD: "On hold" };

export function ScheduleWorkspace({ view }: { view: PlanView }) {
  const editor = usePlanEditor(view.data, view.canEdit);
  const { data } = editor;
  const [filters, setFilters] = useState({ phaseId: "", systemId: "", areaId: "", status: "", search: "", showArchived: false });
  const [groupBy, setGroupBy] = useState<GroupBy>("phase");
  const [zoom, setZoom] = useState<"day" | "week">("week");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([{ id: "start", desc: false }]);
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null);
  const [bulk, setBulk] = useState(false);
  const [adding, setAdding] = useState(false);
  const [capacityProblem, setCapacityProblem] = useState<CapacityProblem | null>(null);
  const wide = useMediaQuery("(min-width: 1280px)");
  const progress = useMemo(() => new Map(data.progress.map((p) => [p.activityKey, p])), [data.progress]);
  const issues = useMemo(() => computePlanningIssues(data), [data]);
  const issuesByActivity = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) for (const r of i.refs) if (r.kind === "activity") m.set(r.key, (m.get(r.key) ?? 0) + 1);
    return m;
  }, [issues]);
  const areaMap = useMemo(() => new Map(data.areas.map((a) => [a.id, a])), [data.areas]);

  const apply = useCallback(
    (ops: PlanOp[], summary?: string) => {
      const r = editor.apply(ops, summary);
      if (!r.ok) {
        if (r.issues?.length) setCapacityProblem({ ops, summary, issues: r.issues });
        else toast.error(r.message ?? "Change not applied");
      }
      return r.ok;
    },
    [editor],
  );

  const visible = useMemo(() => {
    const q = filters.search.toLowerCase();
    return data.activities.filter(
      (a) =>
        (filters.showArchived || !a.archived) &&
        (!filters.phaseId || (filters.phaseId === "none" ? !a.phaseId : a.phaseId === filters.phaseId)) &&
        (!filters.systemId || (filters.systemId === "shared" ? !a.systemId : a.systemId === filters.systemId)) &&
        (!filters.areaId || (filters.areaId === "none" ? !a.areaId : a.areaId !== null && isAreaWithin(areaMap, a.areaId, filters.areaId))) &&
        (!filters.status || (progress.get(a.key)?.status ?? "NOT_STARTED") === filters.status) &&
        (!q || `${a.code} ${a.name} ${a.notes ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data.activities, filters, areaMap, progress]);

  const name = (list: { id: string; name: string }[], id: string | null, fallback: string) => (id ? (list.find((x) => x.id === id)?.name ?? fallback) : fallback);
  const columns = useMemo<ColumnDef<ActivityInput>[]>(
    () => [
      {
        id: "select",
        header: () => <span className="sr-only">Select</span>,
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.code}`}
            checked={checked.has(row.original.key)}
            onChange={() => {
              const next = new Set(checked);
              if (next.has(row.original.key)) next.delete(row.original.key);
              else next.add(row.original.key);
              setChecked(next);
            }}
          />
        ),
        enableSorting: false,
      },
      { id: "code", header: "ID", accessorFn: (a) => a.code },
      { id: "name", header: "Activity", accessorFn: (a) => a.name },
      { id: "phase", header: "Phase", accessorFn: (a) => name(data.phases, a.phaseId, "—") },
      { id: "area", header: "Area", accessorFn: (a) => name(data.areas, a.areaId, "—") },
      { id: "system", header: "System", accessorFn: (a) => name(data.systems, a.systemId, "Shared systems") },
      { id: "start", header: "Start", accessorFn: (a) => a.plannedStart, cell: ({ getValue }) => formatDate(getValue() as string) },
      { id: "finish", header: "Finish", accessorFn: (a) => a.plannedFinish, cell: ({ getValue }) => formatDate(getValue() as string) },
      { id: "days", header: "Work days", accessorFn: (a) => workingDuration(data, a) },
      { id: "status", header: "Status", accessorFn: (a) => STATUS_TEXT[progress.get(a.key)?.status ?? "NOT_STARTED"] },
      {
        id: "flags",
        header: "Flags",
        accessorFn: (a) => issuesByActivity.get(a.key) ?? 0,
        cell: ({ getValue }) => ((getValue() as number) ? <span className="text-warning">⚠ {getValue() as number}</span> : ""),
      },
    ],
    [checked, data, progress, issuesByActivity],
  );
  const table = useReactTable({ data: visible, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (a) => a.key });
  const sortedRows = table.getRowModel().rows;

  const range = useMemo(() => {
    const s = minDate(...visible.map((a) => a.plannedStart), ...data.milestones.map((m) => m.date ?? m.candidates[0]?.date ?? null));
    const f = maxDate(...visible.map((a) => a.plannedFinish));
    const today = todayInTimeZone(data.project.timezone);
    return { from: startOfWeek(s ?? today), to: addDays(startOfWeek(f ?? addDays(today, 180)), 13) };
  }, [visible, data.milestones, data.project.timezone]);

  const selected = selectedKey ? data.activities.find((a) => a.key === selectedKey) : null;
  const panel = selected ? <ActivityPanel key={`${selected.key}:${data.plan.revision}`} data={data} activity={selected} canEdit={editor.canEdit} apply={apply} onRequestMove={setMoveRequest} /> : null;
  const groups = groupActivities(data, sortedRows.map((r) => r.original), groupBy);

  return (
    <div className="flex min-h-0">
      <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-4">
        <PlanBar editor={editor} plans={view.plans} basePath={`/projects/${data.project.id}/schedule`} />
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-2 text-xs">
          <label>
            <span className="block text-muted-foreground">Phase</span>
            <select className={selectCls} value={filters.phaseId} onChange={(e) => setFilters({ ...filters, phaseId: e.target.value })}>
              <option value="">All</option>
              <option value="none">No phase</option>
              {data.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-muted-foreground">System</span>
            <select className={selectCls} value={filters.systemId} onChange={(e) => setFilters({ ...filters, systemId: e.target.value })}>
              <option value="">All</option>
              <option value="shared">Shared systems</option>
              {data.systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-muted-foreground">Area</span>
            <select className={selectCls} value={filters.areaId} onChange={(e) => setFilters({ ...filters, areaId: e.target.value })}>
              <option value="">All</option>
              <option value="none">No area</option>
              {areaOptions(data).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-muted-foreground">Status</span>
            <select className={selectCls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All</option>
              {Object.entries(STATUS_TEXT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-muted-foreground">Search</span>
            <Input className="h-8 w-44" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="ID, name, notes" />
          </label>
          <label className="flex items-center gap-1 pb-1.5">
            <input type="checkbox" checked={filters.showArchived} onChange={(e) => setFilters({ ...filters, showArchived: e.target.checked })} /> Show archived
          </label>
          <label>
            <span className="block text-muted-foreground">Group</span>
            <select className={selectCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="phase">By phase</option>
              <option value="area">By area</option>
              <option value="system">By system</option>
              <option value="none">No grouping</option>
            </select>
          </label>
          {Object.values(filters).some((v) => v) ? (
            <Button size="sm" variant="ghost" onClick={() => setFilters({ phaseId: "", systemId: "", areaId: "", status: "", search: "", showArchived: false })}>
              <X className="size-3.5" /> Clear
            </Button>
          ) : null}
          {editor.canEdit ? (
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" disabled={checked.size === 0} onClick={() => setBulk(true)}>
                <MoveHorizontal className="size-3.5" /> Move selected ({checked.size})
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" /> Activity
              </Button>
            </div>
          ) : null}
        </div>

        <Tabs defaultValue="table">
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="issues">Planning flags ({issues.filter((i) => i.severity !== "info").length})</TabsTrigger>
            </TabsList>
            <span className="text-xs text-muted-foreground">
              {visible.length} of {data.activities.filter((a) => !a.archived).length} activities · selection and filters are shared by table and timeline
            </span>
          </div>
          <TabsContent value="table">
            {visible.length === 0 ? (
              <EmptyState title="No activities" action={editor.canEdit ? <Button onClick={() => setAdding(true)}>Add an activity</Button> : undefined}>
                Manual activities can be added without an imported schedule. Project-level manpower does not require activities.
              </EmptyState>
            ) : (
              <div className="max-h-[65dvh] overflow-auto rounded-lg border bg-background">
                <table className="w-full min-w-[64rem] text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id}>
                        {hg.headers.map((h) => (
                          <th key={h.id} className="px-2 py-1.5 font-medium">
                            {h.column.getCanSort() ? (
                              <button type="button" className="inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}>
                                {flexRender(h.column.columnDef.header, h.getContext())}
                                <ArrowDownUp className="size-3" aria-hidden />
                                <span className="sr-only">{h.column.getIsSorted() ? `sorted ${h.column.getIsSorted()}` : "sortable"}</span>
                              </button>
                            ) : (
                              flexRender(h.column.columnDef.header, h.getContext())
                            )}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <GroupRows key={g.id} label={groupBy === "none" ? null : g.label} keys={g.items.map((a) => a.key)} colSpan={columns.length}>
                        {g.items.map((a) => {
                          const row = sortedRows.find((r) => r.id === a.key)!;
                          return (
                            <tr key={a.key} className={cn("cursor-pointer border-t hover:bg-muted/40", selectedKey === a.key && "bg-accent", a.archived && "text-muted-foreground line-through")} onClick={(e) => (e.target as HTMLElement).tagName !== "INPUT" && setSelectedKey(a.key)}>
                              {row.getVisibleCells().map((c) => (
                                <td key={c.id} className="px-2 py-1.5 tabular">
                                  {flexRender(c.column.columnDef.cell ?? ((ctx) => String(ctx.getValue() ?? "")), c.getContext())}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </GroupRows>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
          <TabsContent value="timeline">
            <div className="mb-2 flex justify-end">
              <select aria-label="Zoom" className={selectCls} value={zoom} onChange={(e) => setZoom(e.target.value as "day" | "week")}>
                <option value="week">Week zoom</option>
                <option value="day">Day zoom</option>
              </select>
            </div>
            {visible.length ? <ScheduleTimeline data={data} activities={sortedRows.map((r) => r.original)} groupBy={groupBy} zoom={zoom} from={range.from} to={range.to} selectedKey={selectedKey} onSelect={setSelectedKey} canEdit={editor.canEdit} onRequestMove={setMoveRequest} /> : <EmptyState title="No activities to show" />}
            <p className="mt-1 text-[11px] text-muted-foreground">Drag a bar to move it, drag its right edge to change the finish, or focus a bar and use ←/→ (Shift to resize). Every change opens a preview. Diamonds: filled = confirmed milestone, hollow = candidate. Thin gray bars under activities are linked source windows.</p>
          </TabsContent>
          <TabsContent value="issues">
            <ul className="space-y-1 rounded-lg border bg-background p-3 text-sm">
              {issues.length === 0 ? <li className="text-muted-foreground">No planning flags.</li> : null}
              {issues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-start gap-2 border-b py-1 last:border-0">
                  <span className={cn("rounded px-1.5 text-xs font-medium", i.severity === "error" ? "bg-destructive/10 text-destructive" : i.severity === "warning" ? "bg-warning-bg text-warning" : "bg-muted text-muted-foreground")}>
                    {i.severity === "error" ? "✕" : i.severity === "warning" ? "⚠" : "ℹ"} {ISSUE_CATEGORY_LABELS[i.category]}
                  </span>
                  <span className="flex-1">{i.message}</span>
                  {i.refs
                    .filter((r) => r.kind === "activity")
                    .map((r) => (
                      <button key={r.key} type="button" className="text-xs underline" onClick={() => setSelectedKey(r.key)}>
                        Open {r.label.split(" ")[0]}
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      </div>
      <aside className="sticky top-0 hidden h-dvh w-[380px] shrink-0 overflow-y-auto border-l bg-background p-4 xl:block" aria-label="Activity details">
        {panel ?? <p className="text-sm text-muted-foreground">Select an activity in the table or timeline.</p>}
      </aside>
      <Sheet open={Boolean(panel) && !wide} onOpenChange={(o) => !o && setSelectedKey(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-md xl:hidden">
          <SheetTitle className="sr-only">Activity details</SheetTitle>
          {panel}
        </SheetContent>
      </Sheet>
      {moveRequest ? <MovePreviewDialog key={JSON.stringify(moveRequest)} data={data} request={moveRequest} onCancel={() => setMoveRequest(null)} onApply={apply} /> : null}
      {bulk ? (
        <BulkMoveDialog
          count={checked.size}
          onCancel={() => setBulk(false)}
          onPreview={(amount, unit) => {
            setBulk(false);
            setMoveRequest({ kind: "shift", keys: [...checked], amount, unit });
          }}
        />
      ) : null}
      {adding ? <AddActivityDialog data={data} onClose={() => setAdding(false)} apply={apply} onAdded={(k) => setSelectedKey(k)} /> : null}
      <CapacityDialog problem={capacityProblem} editor={editor} onRetry={(ops, summary) => apply(ops, summary)} onClose={() => setCapacityProblem(null)} />
    </div>
  );
}

function GroupRows({ label, keys, colSpan, children }: { label: string | null; keys: string[]; colSpan: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {label !== null ? (
        <tr className="bg-muted/50">
          <td colSpan={colSpan} className="px-2 py-1 text-xs font-semibold">
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "▾" : "▸"} {label} <span className="font-normal text-muted-foreground">({keys.length})</span>
            </button>
          </td>
        </tr>
      ) : null}
      {open ? children : null}
    </>
  );
}

function BulkMoveDialog({ count, onCancel, onPreview }: { count: number; onCancel: () => void; onPreview: (amount: number, unit: "workingDays" | "weeks") => void }) {
  const [amount, setAmount] = useState("5");
  const [unit, setUnit] = useState<"workingDays" | "weeks">("workingDays");
  const n = Number(amount);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {count} selected activities</DialogTitle>
          <DialogDescription>Completed activities keep their actual dates. In-progress work keeps its start. The next step previews links, staffing, and milestones before anything changes.</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="bulk-amount">Shift by</Label>
            <Input id="bulk-amount" inputMode="numeric" className="w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <select aria-label="Unit" className="h-9 rounded-md border bg-background px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as "workingDays" | "weeks")}>
            <option value="workingDays">working days</option>
            <option value="weeks">calendar weeks</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">Use a negative number to move earlier.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!Number.isInteger(n) || n === 0} onClick={() => onPreview(n, unit)}>
            Preview move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddActivityDialog({ data, onClose, apply, onAdded }: { data: PlanView["data"]; onClose: () => void; apply: (ops: PlanOp[], summary?: string) => boolean; onAdded: (key: string) => void }) {
  const today = todayInTimeZone(data.project.timezone);
  const [f, setF] = useState({ name: "", code: "", phaseId: "", areaId: "", systemId: "", start: today, days: "5" });
  const cal = projectResolver(data);
  const days = Number(f.days);
  const finish = Number.isInteger(days) && days >= 1 && f.start ? finishForDuration(cal, f.start, days) : null;
  const submit = () => {
    if (!f.name.trim() || !finish) return;
    const key = crypto.randomUUID();
    const act: ActivityInput = { key, code: f.code.trim(), name: f.name.trim(), phaseId: f.phaseId || null, areaId: f.areaId || null, systemId: f.systemId || null, calendarKey: null, plannedStart: f.start, plannedFinish: finish, notes: null, sortOrder: data.activities.length, archived: false };
    if (apply([{ type: "addActivity", activity: act }], `Add activity ${act.name}`)) {
      onAdded(key);
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add installation activity</DialogTitle>
          <DialogDescription>Phase, area, and system are optional. Labor can stay at project or phase level; this activity does not require its own staffing.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="aa-name">Name</Label>
            <Input id="aa-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fire alarm rough-in — electrical room" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-code">Activity ID (optional)</Label>
            <Input id="aa-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="Auto (A-0001)" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-system">System</Label>
            <select id="aa-system" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.systemId} onChange={(e) => setF({ ...f, systemId: e.target.value })}>
              <option value="">Shared systems</option>
              {data.systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-phase">Phase</Label>
            <select id="aa-phase" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.phaseId} onChange={(e) => setF({ ...f, phaseId: e.target.value })}>
              <option value="">No phase</option>
              {data.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-area">Area</Label>
            <select id="aa-area" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}>
              <option value="">No area</option>
              {areaOptions(data).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-start">Planned start</Label>
            <Input id="aa-start" type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-days">Working days</Label>
            <Input id="aa-days" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Finish (project calendar): {finish ? formatDate(finish) : "—"}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!f.name.trim() || !finish} onClick={submit}>
            Add activity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
