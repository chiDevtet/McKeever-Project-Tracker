"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, eachWeek, formatDate, formatDateWithWeekday, type ISODate } from "@/domain/dates";
import { nodeWeekDetail, targetsLabel, type GridModel } from "@/domain/grid";
import type { PlanOp } from "@/domain/ops";
import type { NodeInput, PlanData } from "@/domain/plan";
import { calendarByKey } from "@/domain/plan";
import { nodeCalendarKey } from "@/domain/staffing";
import { cn } from "@/lib/utils";
import { NodeFormDialog } from "./node-form";

interface Props {
  data: PlanData;
  model: GridModel;
  node: NodeInput;
  week: ISODate | null;
  canEdit: boolean;
  apply: (ops: PlanOp[], summary?: string) => boolean;
  onSelectWeek: (w: ISODate) => void;
}

const newKey = () => crypto.randomUUID();

export function NodePanel({ data, model, node, week, canEdit, apply, onSelectWeek }: Props) {
  const row = model.nodeRows.find((r) => r.node.key === node.key);
  const parent = node.parentKey ? data.nodes.find((n) => n.key === node.parentKey) : null;
  const parentRow = parent ? model.nodeRows.find((r) => r.node.key === parent.key) : null;
  const days = useMemo(() => (week ? nodeWeekDetail(data, node.key, week) : []), [data, node.key, week]);
  const calendar = calendarByKey(data, nodeCalendarKey(data, node));
  const [blockDay, setBlockDay] = useState<ISODate | null>(null);
  const [dialog, setDialog] = useState<null | "edit" | "reservation" | "crew">(null);
  const cell = week ? row?.cells.get(week) : null;
  const remaining = week ? row?.remaining?.get(week) : null;
  const parentRemaining = week && parentRow ? parentRow.remaining?.get(week) : null;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{node.name}</h2>
          <Badge variant="outline">{node.kind === "POOL" ? "Workforce pool" : node.kind === "CREW" ? "Dedicated crew" : "Reservation"}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{targetsLabel(data, node) || "No phase, area, system, or activity (broad assignment)"}</p>
        {parent ? <p className="mt-1 text-xs text-muted-foreground">Reserves capacity from: {parent.name}</p> : <p className="mt-1 text-xs text-muted-foreground">Supplies {node.role.toLowerCase()} capacity. Reservations below subdivide it and never add people.</p>}
        <p className="text-xs text-muted-foreground">Calendar: {calendar.name}</p>
        {canEdit ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
              Edit row
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("reservation")}>
              <Plus className="size-3.5" /> Reservation
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("crew")}>
              <Plus className="size-3.5" /> Dedicated crew
            </Button>
          </div>
        ) : null}
      </div>

      {week ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Week of {formatDate(week)}</h3>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onSelectWeek(addDays(week, -7))} aria-label="Previous week">
                ‹
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onSelectWeek(addDays(week, 7))} aria-label="Next week">
                ›
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Peak in week</div>
              <div className="text-lg font-semibold tabular">{cell?.value ?? 0}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Person-hours</div>
              <div className="text-lg font-semibold tabular">{cell?.hours ?? 0}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">{row?.childKeys.length ? "Unreserved" : parent ? `Left in ${parent.kind === "POOL" ? "pool" : "parent"}` : "—"}</div>
              <div className="text-lg font-semibold tabular">{fmtRange(row?.childKeys.length ? remaining : parentRemaining)}</div>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 font-medium">Calendar</th>
                <th className="py-1 text-right font-medium">Counted</th>
                <th className="py-1 text-right font-medium">Day value</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className={cn("border-t", !d.open && "text-muted-foreground")}>
                  <td className="py-1">{formatDateWithWeekday(d.date).slice(0, 10)}</td>
                  <td className="py-1">{d.open ? `${d.calendarHours} h from ${d.calendarStart}` : `Closed${d.calendarLabel ? ` · ${d.calendarLabel}` : ""}`}</td>
                  <td className="py-1 text-right tabular">
                    {d.effective.headcount > 0 ? `${d.effective.headcount} × ${d.effective.hours} h` : "—"}
                    {d.effective.source === "block" ? <span className="ml-1 rounded bg-muted px-1">blocks</span> : d.effective.source === "day" ? <span className="ml-1 rounded bg-muted px-1">day</span> : null}
                  </td>
                  <td className="py-1 text-right">
                    <DayOverrideInput key={`${d.date}:${d.dayEntry?.headcount ?? ""}`} disabled={!canEdit} value={d.dayEntry?.headcount ?? null} placeholder={d.open && d.weekly !== null ? String(d.weekly) : "—"} onCommit={(v) => apply([{ type: "setDay", nodeKey: node.key, date: d.date, headcount: v }], `Day override ${formatDate(d.date)}`)} />
                    <button type="button" className="ml-1 text-[11px] underline" onClick={() => setBlockDay(blockDay === d.date ? null : d.date)}>
                      {d.blocks.length ? `${d.blocks.length} block${d.blocks.length > 1 ? "s" : ""}` : "time"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground">Blank day value uses the weekly count on open days. Enter 0 to clear one day. Timed blocks replace the whole day and allow partial days or shifts.</p>
          {blockDay ? <BlockEditor key={blockDay} date={blockDay} node={node} data={data} canEdit={canEdit} apply={apply} onDone={() => setBlockDay(null)} /> : null}
          {canEdit && days.some((d) => d.dayEntry || d.blocks.length) ? (
            <Button size="sm" variant="outline" onClick={() => apply([{ type: "clearOverrides", nodeKey: node.key, from: week, to: addDays(week, 6) }], "Clear overrides")}>
              Clear day overrides and blocks this week
            </Button>
          ) : null}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Select a week cell to see daily detail, overrides, and timed blocks.</p>
      )}

      {canEdit ? <FillTools node={node} week={week ?? model.weeks[0]?.week ?? null} weeks={model.weeks.map((w) => w.week)} apply={apply} /> : null}
      {canEdit ? <NodeActions data={data} node={node} week={week} apply={apply} /> : null}

      {dialog === "edit" ? <NodeFormDialog data={data} mode="edit" node={node} onClose={() => setDialog(null)} apply={apply} /> : null}
      {dialog === "reservation" || dialog === "crew" ? <NodeFormDialog data={data} mode="add" kind={dialog === "crew" ? "CREW" : "RESERVATION"} parentKey={node.key} onClose={() => setDialog(null)} apply={apply} /> : null}
    </div>
  );
}

function fmtRange(r: { min: number; max: number } | null | undefined) {
  if (!r) return "—";
  return r.min === r.max ? String(r.min) : `${r.min}–${r.max}`;
}

function DayOverrideInput({ value, placeholder, disabled, onCommit }: { value: number | null; placeholder: string; disabled: boolean; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [bad, setBad] = useState(false);
  const commit = () => {
    const t = text.trim();
    if (t === (value === null ? "" : String(value))) return;
    if (t === "") return onCommit(null);
    if (!/^\d+$/.test(t)) {
      setBad(true);
      return;
    }
    setBad(false);
    onCommit(Number(t));
  };
  return (
    <input
      aria-label="Day override"
      aria-invalid={bad}
      disabled={disabled}
      inputMode="numeric"
      className={cn("h-6 w-12 rounded border px-1 text-right tabular", bad && "border-destructive")}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      title={bad ? "Whole numbers only" : undefined}
    />
  );
}

function BlockEditor({ date, node, data, canEdit, apply, onDone }: { date: ISODate; node: NodeInput; data: PlanData; canEdit: boolean; apply: Props["apply"]; onDone: () => void }) {
  const existing = data.entries.filter((e) => e.nodeKey === node.key && e.kind === "BLOCK" && e.date === date);
  const [blocks, setBlocks] = useState(existing.map((b) => ({ startTime: b.startTime ?? "07:00", endTime: b.endTime ?? "15:00", headcount: String(b.headcount), label: b.label ?? "" })));
  const [error, setError] = useState<string | null>(null);
  const presets = calendarByKey(data, nodeCalendarKey(data, node)).definition.shifts;
  const save = () => {
    const parsed = blocks.map((b) => ({ startTime: b.startTime, endTime: b.endTime, headcount: Number(b.headcount), label: b.label || null }));
    if (parsed.some((b) => !Number.isInteger(b.headcount) || b.headcount < 0)) return setError("Headcount must be a whole number.");
    setError(null);
    if (apply([{ type: "setBlocks", nodeKey: node.key, date, blocks: parsed }], `Time blocks on ${formatDate(date)}`)) onDone();
  };
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <div className="text-xs font-medium">Timed blocks starting {formatDateWithWeekday(date)}</div>
      {blocks.length === 0 ? <p className="text-xs text-muted-foreground">No blocks: the day uses the whole-day value.</p> : null}
      {blocks.map((b, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input aria-label="Start" type="time" className="h-7 w-24 text-xs" value={b.startTime} disabled={!canEdit} onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
          <span className="text-xs">to</span>
          <Input aria-label="End" type="time" className="h-7 w-24 text-xs" value={b.endTime} disabled={!canEdit} onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
          <Input aria-label="People" inputMode="numeric" className="h-7 w-14 text-right text-xs" value={b.headcount} disabled={!canEdit} onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, headcount: e.target.value } : x)))} />
          {b.endTime <= b.startTime ? <span className="text-[10px] text-muted-foreground">next day</span> : null}
          {canEdit ? (
            <button type="button" aria-label="Remove block" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button key={p.id} size="sm" variant="outline" className="h-6 text-xs" onClick={() => setBlocks([...blocks, { startTime: p.start, endTime: p.end, headcount: "1", label: p.name }])}>
              + {p.name} {p.start}–{p.end}
            </Button>
          ))}
        </div>
      ) : null}
      <FormError message={error} />
      {canEdit ? (
        <div className="flex gap-1">
          <Button size="sm" onClick={save}>
            Save blocks
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FillTools({ node, week, weeks, apply }: { node: NodeInput; week: ISODate | null; weeks: ISODate[]; apply: Props["apply"] }) {
  const [from, setFrom] = useState(week ?? weeks[0] ?? "");
  const [to, setTo] = useState(weeks[weeks.length - 1] ?? "");
  const [mode, setMode] = useState<"fill" | "ramp">("fill");
  const [a, setA] = useState("8");
  const [b, setB] = useState("8");
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    const range = from && to && from <= to ? eachWeek(from, to) : [];
    if (!range.length) return setError("Choose a start week on or before the end week.");
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isInteger(na) || na < 0 || (mode === "ramp" && (!Number.isInteger(nb) || nb < 0))) return setError("Use whole numbers of people.");
    setError(null);
    const values = range.map((w, i) => ({ week: w, headcount: mode === "fill" ? na : Math.round(na + ((nb - na) * i) / Math.max(1, range.length - 1)) }));
    apply([{ type: "setWeeks", nodeKey: node.key, values }], mode === "fill" ? `Fill ${values.length} weeks with ${na}` : `Ramp ${na}→${nb} over ${values.length} weeks`);
  };
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Fill or ramp weeks</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="fill-from" className="text-xs">
            From week (Mon)
          </Label>
          <Input id="fill-from" type="date" className="h-8 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fill-to" className="text-xs">
            To week (Mon)
          </Label>
          <Input id="fill-to" type="date" className="h-8 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex rounded border text-xs" role="radiogroup" aria-label="Fill mode">
          {(["fill", "ramp"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={cn("px-2 py-1", mode === m && "bg-brand text-white")} onClick={() => setMode(m)}>
              {m === "fill" ? "Same count" : "Ramp"}
            </button>
          ))}
        </div>
        <Input aria-label={mode === "fill" ? "Count" : "Start count"} inputMode="numeric" className="h-8 w-16 text-right" value={a} onChange={(e) => setA(e.target.value)} />
        {mode === "ramp" ? (
          <>
            <span className="pb-2 text-xs">→</span>
            <Input aria-label="End count" inputMode="numeric" className="h-8 w-16 text-right" value={b} onChange={(e) => setB(e.target.value)} />
          </>
        ) : null}
        <Button size="sm" onClick={run}>
          Apply
        </Button>
      </div>
      <FormError message={error} />
      <p className="text-[11px] text-muted-foreground">Weekly counts expand to the open days of each week. Partial weeks use only their open dates.</p>
    </section>
  );
}

function NodeActions({ data, node, week, apply }: { data: PlanData; node: NodeInput; week: ISODate | null; apply: Props["apply"] }) {
  const [releaseFrom, setReleaseFrom] = useState(week ?? "");
  const [split, setSplit] = useState({ name: `${node.name} B`, count: "1", from: week ?? "", to: week ? addDays(week, 6) : "" });
  const [shift, setShift] = useState({ amount: "1", mode: "weeks" as "weeks" | "workingDays", children: true });
  const [inc, setInc] = useState({ add: "1", from: week ?? "", to: week ?? "" });
  const hasChildren = data.nodes.some((n) => n.parentKey === node.key);
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Allocation actions</h3>
      {node.kind === "POOL" ? (
        <div className="space-y-1 rounded-md border p-2">
          <div className="text-xs font-medium">Increase workforce (explicit capacity change)</div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            Add
            <Input aria-label="People to add" inputMode="numeric" className="h-7 w-14 text-right" value={inc.add} onChange={(e) => setInc({ ...inc, add: e.target.value })} />
            from
            <Input aria-label="From week" type="date" className="h-7 w-36" value={inc.from} onChange={(e) => setInc({ ...inc, from: e.target.value })} />
            to
            <Input aria-label="To week" type="date" className="h-7 w-36" value={inc.to} onChange={(e) => setInc({ ...inc, to: e.target.value })} />
            <Button
              size="sm"
              variant="outline"
              disabled={!inc.from || !inc.to || !/^\d+$/.test(inc.add) || Number(inc.add) < 1}
              onClick={() => apply([{ type: "increaseWorkforce", nodeKey: node.key, values: eachWeek(inc.from, inc.to).map((w) => ({ week: w, add: Number(inc.add) })) }], `Increase workforce by ${inc.add}`)}
            >
              Increase
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1 rounded-md border p-2">
            <div className="text-xs font-medium">Return to shared work</div>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              From
              <Input aria-label="Return from date" type="date" className="h-7 w-36" value={releaseFrom} onChange={(e) => setReleaseFrom(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!releaseFrom} onClick={() => apply([{ type: "releaseNode", key: node.key, from: releaseFrom }], `Return ${node.name} to shared from ${formatDate(releaseFrom)}`)}>
                Return
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Removes this reservation (and its children) from that date; the people stay in the parent capacity.</p>
          </div>
          <div className="space-y-1 rounded-md border p-2">
            <div className="text-xs font-medium">Split into another crew</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <Input aria-label="New crew name" className="col-span-2 h-7" value={split.name} onChange={(e) => setSplit({ ...split, name: e.target.value })} />
              <Input aria-label="People to move" inputMode="numeric" className="h-7" value={split.count} onChange={(e) => setSplit({ ...split, count: e.target.value })} />
              <span className="self-center text-muted-foreground">people</span>
              <Input aria-label="Split from" type="date" className="h-7" value={split.from} onChange={(e) => setSplit({ ...split, from: e.target.value })} />
              <Input aria-label="Split to" type="date" className="h-7" value={split.to} onChange={(e) => setSplit({ ...split, to: e.target.value })} />
            </div>
            <Button size="sm" variant="outline" disabled={!split.from || !split.to || !/^\d+$/.test(split.count)} onClick={() => apply([{ type: "splitCrew", key: node.key, newKey: newKey(), name: split.name, headcount: Number(split.count), from: split.from, to: split.to }], `Split ${split.count} into ${split.name}`)}>
              Split
            </Button>
          </div>
        </>
      )}
      <div className="space-y-1 rounded-md border p-2">
        <div className="text-xs font-medium">Move this row&apos;s staffing</div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          by
          <Input aria-label="Amount" inputMode="numeric" className="h-7 w-14 text-right" value={shift.amount} onChange={(e) => setShift({ ...shift, amount: e.target.value })} />
          <select aria-label="Unit" className="h-7 rounded border bg-background px-1" value={shift.mode} onChange={(e) => setShift({ ...shift, mode: e.target.value as "weeks" | "workingDays" })}>
            <option value="weeks">weeks</option>
            <option value="workingDays">working days</option>
          </select>
          {hasChildren ? (
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={shift.children} onChange={(e) => setShift({ ...shift, children: e.target.checked })} /> include reservations below
            </label>
          ) : null}
          <Button size="sm" variant="outline" disabled={!/^-?\d+$/.test(shift.amount)} onClick={() => apply([{ type: "shiftNodeEntries", key: node.key, includeDescendants: shift.children, from: null, to: null, mode: shift.mode, amount: Number(shift.amount) }], `Move ${node.name} ${shift.amount} ${shift.mode === "weeks" ? "week(s)" : "working day(s)"}`)}>
            Move
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Use a negative number to move earlier. Parent capacity does not move unless you move it too; conflicts are rejected with an explanation.</p>
      </div>
      {node.kind !== "POOL" || !data.entries.some((e) => e.nodeKey === node.key && e.headcount > 0) ? (
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          onClick={() => {
            if (window.confirm(`Delete "${node.name}"${hasChildren ? " and the reservations below it" : ""}? Its people return to the parent capacity.`)) apply([{ type: "removeNode", key: node.key }], `Delete ${node.name}`);
          }}
        >
          <Trash2 className="size-3.5" /> Delete row
        </Button>
      ) : null}
    </section>
  );
}
