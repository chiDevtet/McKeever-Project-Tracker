"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PlanBar } from "@/components/plan/plan-bar";
import type { PlanEditor } from "@/components/plan/use-plan-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { changedDays, defaultWeekPattern, type CalendarDefinition, type CalendarException, type DayRule } from "@/domain/calendar";
import type { CalendarInput } from "@/domain/calendar";
import { addDays, formatDate, formatDateWithWeekday, startOfWeek, WEEKDAY_SHORT } from "@/domain/dates";
import { todayInTimeZone } from "@/domain/tz";
import { computeMeasures, planDateRange } from "@/domain/metrics";
import { applyOps, validatePlan, type PlanOp } from "@/domain/ops";
import type { PlanData } from "@/domain/plan";
import { workingDuration } from "@/domain/schedule";
import type { PlanView } from "@/server/services/plans";

const newId = () => crypto.randomUUID().slice(0, 8);

function PatternEditor({ pattern, onChange, disabled }: { pattern: DayRule[]; onChange: (p: DayRule[]) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-7 gap-1 text-xs">
      {pattern.map((d, i) => (
        <div key={i} className="space-y-1 rounded border p-1.5 text-center">
          <label className="flex items-center justify-center gap-1 font-medium">
            <input type="checkbox" disabled={disabled} checked={d.open} onChange={(e) => onChange(pattern.map((x, j) => (j === i ? { ...x, open: e.target.checked, hours: e.target.checked ? x.hours || 8 : 0 } : x)))} />
            {WEEKDAY_SHORT[i]}
          </label>
          <Input aria-label={`${WEEKDAY_SHORT[i]} hours`} disabled={disabled || !d.open} inputMode="decimal" className="h-7 px-1 text-center text-xs" value={d.open ? String(d.hours) : "closed"} onChange={(e) => onChange(pattern.map((x, j) => (j === i ? { ...x, hours: Number(e.target.value) || 0 } : x)))} />
          <Input aria-label={`${WEEKDAY_SHORT[i]} start`} disabled={disabled || !d.open} type="time" className="h-7 px-1 text-xs" value={d.start} onChange={(e) => onChange(pattern.map((x, j) => (j === i ? { ...x, start: e.target.value || x.start } : x)))} />
        </div>
      ))}
    </div>
  );
}

export function CalendarEditor({ editor, plans }: { editor: PlanEditor; plans: PlanView["plans"] }) {
  const { data } = editor;
  const [calKey, setCalKey] = useState(() => data.calendars.find((c) => c.isDefault)?.key ?? data.calendars[0].key);
  const current = data.calendars.find((c) => c.key === calKey) ?? data.calendars[0];
  const [draft, setDraft] = useState<CalendarDefinition>(current.definition);
  const [draftFor, setDraftFor] = useState(`${current.key}:${data.plan.revision}`);
  if (draftFor !== `${current.key}:${data.plan.revision}`) {
    setDraft(current.definition);
    setDraftFor(`${current.key}:${data.plan.revision}`);
  }
  const [exc, setExc] = useState<{ date: string; kind: CalendarException["kind"]; hours: string; label: string }>({ date: "", kind: "closed", hours: "", label: "" });
  const [period, setPeriod] = useState<{ start: string; end: string; label: string; pattern: DayRule[] } | null>(null);
  const [preview, setPreview] = useState(false);
  const [newCal, setNewCal] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(current.definition);

  const addException = () => {
    if (!exc.date) return;
    const hours = exc.hours.trim() === "" ? null : Number(exc.hours);
    if (exc.kind === "hours" && !(hours && hours > 0)) return toast.error("Changed-hours exceptions need hours above zero.");
    setDraft({ ...draft, exceptions: [...draft.exceptions.filter((e) => e.date !== exc.date), { id: newId(), date: exc.date, kind: exc.kind, hours, start: null, label: exc.label }].sort((a, b) => a.date.localeCompare(b.date)) });
    setExc({ date: "", kind: "closed", hours: "", label: "" });
  };

  const addPeriod = () => {
    if (!period?.start || !period.end || period.end < period.start) return toast.error("Choose a period start on or before its end.");
    setDraft({ ...draft, periods: [...draft.periods, { id: newId(), label: period.label, start: period.start, end: period.end, weekPattern: period.pattern }].sort((a, b) => a.start.localeCompare(b.start)) });
    setPeriod(null);
  };

  return (
    <div className="space-y-3">
      <PlanBar editor={editor} plans={plans} basePath={`/projects/${data.project.id}/setup`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="cal-pick" className="text-muted-foreground">
          Calendar
        </label>
        <select id="cal-pick" className="h-8 rounded-md border bg-background px-2" value={calKey} onChange={(e) => setCalKey(e.target.value)}>
          {data.calendars.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
              {c.isDefault ? " (project)" : " (crew/activity)"}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">Timezone {current.timezone} · weeks start Monday</span>
        {editor.canEdit ? (
          <span className="ml-auto inline-flex gap-1">
            <Input aria-label="New calendar name" className="h-8 w-44" placeholder="New crew calendar" value={newCal} onChange={(e) => setNewCal(e.target.value)} />
            <Button
              size="sm"
              variant="outline"
              disabled={!newCal.trim()}
              onClick={() => {
                const key = `cal-${newId()}`;
                const r = editor.apply([{ type: "setCalendar", calendar: { key, name: newCal.trim(), timezone: current.timezone, isDefault: false, definition: structuredClone(current.definition) } }], `Add calendar ${newCal}`);
                if (r.ok) {
                  setCalKey(key);
                  setNewCal("");
                }
              }}
            >
              <Plus className="size-3.5" /> Add calendar
            </Button>
          </span>
        ) : null}
      </div>

      <section className="space-y-2 rounded-lg border bg-background p-3">
        <h3 className="text-sm font-semibold">Base working week</h3>
        <PatternEditor pattern={draft.weekPattern} disabled={!editor.canEdit} onChange={(p) => setDraft({ ...draft, weekPattern: p })} />
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-3">
        <h3 className="text-sm font-semibold">Effective-dated periods</h3>
        <p className="text-xs text-muted-foreground">Replace the weekly pattern for a date range, for example one week of six ten-hour days.</p>
        <ul className="space-y-1 text-xs">
          {draft.periods.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded bg-muted px-2 py-1">
              <span>
                {formatDate(p.start)} – {formatDate(p.end)} {p.label ? `· ${p.label}` : ""}: {p.weekPattern.map((d, i) => (d.open ? `${WEEKDAY_SHORT[i]} ${d.hours}h` : null)).filter(Boolean).join(", ")}
              </span>
              {editor.canEdit ? (
                <button type="button" aria-label="Remove period" onClick={() => setDraft({ ...draft, periods: draft.periods.filter((x) => x.id !== p.id) })}>
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {editor.canEdit ? (
          period ? (
            <div className="space-y-2 rounded border p-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <Input aria-label="Period start" type="date" className="h-8 w-40" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
                <Input aria-label="Period end" type="date" className="h-8 w-40" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
                <Input aria-label="Period label" className="h-8 w-56" placeholder="Label (e.g. Acceleration week)" value={period.label} onChange={(e) => setPeriod({ ...period, label: e.target.value })} />
              </div>
              <PatternEditor pattern={period.pattern} disabled={false} onChange={(p) => setPeriod({ ...period, pattern: p })} />
              <div className="flex gap-1">
                <Button size="sm" onClick={addPeriod}>
                  Add period to draft
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPeriod(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setPeriod({ start: "", end: "", label: "", pattern: defaultWeekPattern(10).map((d, i) => (i < 6 ? { ...d, open: true, hours: 10 } : d)) })}>
              <Plus className="size-3.5" /> Add period
            </Button>
          )
        ) : null}
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-3">
        <h3 className="text-sm font-semibold">Dated exceptions</h3>
        <p className="text-xs text-muted-foreground">Holidays are entered here; no holiday calendar is downloaded or assumed.</p>
        <ul className="space-y-1 text-xs">
          {draft.exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between rounded bg-muted px-2 py-1">
              <span>
                {formatDateWithWeekday(e.date)}: {e.kind === "closed" ? "Closed" : e.kind === "open" ? `Added workday${e.hours ? ` ${e.hours} h` : ""}` : `${e.hours} h`} {e.label ? `· ${e.label}` : ""}
              </span>
              {editor.canEdit ? (
                <button type="button" aria-label="Remove exception" onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((x) => x.id !== e.id) })}>
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
          {draft.exceptions.length === 0 ? <li className="text-muted-foreground">None configured.</li> : null}
        </ul>
        {editor.canEdit ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Input aria-label="Exception date" type="date" className="h-8 w-40" value={exc.date} onChange={(e) => setExc({ ...exc, date: e.target.value })} />
            <select aria-label="Exception type" className="h-8 rounded border bg-background px-1" value={exc.kind} onChange={(e) => setExc({ ...exc, kind: e.target.value as CalendarException["kind"] })}>
              <option value="closed">Closed (holiday or shutdown)</option>
              <option value="open">Added workday</option>
              <option value="hours">Changed hours</option>
            </select>
            {exc.kind !== "closed" ? <Input aria-label="Hours" className="h-8 w-16" inputMode="decimal" placeholder="hours" value={exc.hours} onChange={(e) => setExc({ ...exc, hours: e.target.value })} /> : null}
            <Input aria-label="Label" className="h-8 w-52" placeholder="Label" value={exc.label} onChange={(e) => setExc({ ...exc, label: e.target.value })} />
            <Button size="sm" variant="outline" onClick={addException} disabled={!exc.date}>
              Add to draft
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-1 rounded-lg border bg-background p-3">
        <h3 className="text-sm font-semibold">Shift presets</h3>
        <p className="text-xs text-muted-foreground">Used when entering timed blocks; an end time at or before the start ends the next day.</p>
        <ul className="text-xs">
          {draft.shifts.map((s) => (
            <li key={s.id}>
              {s.name}: {s.start}–{s.end}
            </li>
          ))}
        </ul>
      </section>

      {editor.canEdit ? (
        <div className="flex gap-2">
          <Button disabled={!dirty} onClick={() => setPreview(true)}>
            Preview calendar change
          </Button>
          <Button variant="outline" disabled={!dirty} onClick={() => setDraft(current.definition)}>
            Discard draft
          </Button>
          {dirty ? <span className="self-center text-xs text-warning">Draft not applied</span> : null}
        </div>
      ) : null}

      {preview ? (
        <CalendarImpactDialog
          data={data}
          calendar={current}
          draft={draft}
          onCancel={() => setPreview(false)}
          onApply={(ops) => {
            const r = editor.apply(ops, `Calendar "${current.name}" changed`);
            if (r.ok) setPreview(false);
            else toast.error(r.message ?? "Not applied");
          }}
        />
      ) : null}
    </div>
  );
}

function CalendarImpactDialog({ data, calendar, draft, onCancel, onApply }: { data: PlanData; calendar: CalendarInput; draft: CalendarDefinition; onCancel: () => void; onApply: (ops: PlanOp[]) => void }) {
  const result = useMemo(() => {
    const ops: PlanOp[] = [{ type: "setCalendar", calendar: { ...calendar, definition: draft } }];
    const after = applyOps(data, ops);
    const thisWeek = startOfWeek(todayInTimeZone(data.project.timezone));
    const range = planDateRange(data) ?? { start: thisWeek, end: addDays(thisWeek, 7 * 26) };
    const lo = [range.start, ...draft.periods.map((p) => p.start), ...draft.exceptions.map((e) => e.date), ...calendar.definition.periods.map((p) => p.start), ...calendar.definition.exceptions.map((e) => e.date)].sort()[0];
    const hi = [range.end, ...draft.periods.map((p) => p.end), ...draft.exceptions.map((e) => e.date), ...calendar.definition.periods.map((p) => p.end), ...calendar.definition.exceptions.map((e) => e.date)].sort().at(-1)!;
    const days = changedDays(calendar.definition, draft, lo, hi);
    const weeks = [...new Set(days.map((d) => startOfWeek(d.date)))].sort();
    const before = weeks.length ? computeMeasures(data, weeks[0], weeks.at(-1)!) : null;
    const afterM = weeks.length ? computeMeasures(after, weeks[0], weeks.at(-1)!) : null;
    const weekRows = weeks.map((w) => ({ week: w, b: before!.weeks.find((x) => x.start === w)!, a: afterM!.weeks.find((x) => x.start === w)! }));
    const acts = data.activities
      .filter((a) => !a.archived && (a.calendarKey ?? data.calendars.find((c) => c.isDefault)!.key) === calendar.key)
      .map((a) => ({ a, before: workingDuration(data, a), after: workingDuration(after, after.activities.find((x) => x.key === a.key)!) }))
      .filter((x) => x.before !== x.after);
    return { ops, days, weekRows, acts, blocking: validatePlan(after, data) };
  }, [data, calendar, draft]);

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview: calendar “{calendar.name}”</DialogTitle>
          <DialogDescription>Weekly staffing re-expands to the new open days and hours. Frozen snapshots, submissions, and actual dates are not changed. Cancel leaves the calendar as it is.</DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {result.days.length} day(s) change across {result.weekRows.length} week(s).
        </p>
        {result.weekRows.length ? (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Week of</th>
                <th>Open days</th>
                <th>Calendar h</th>
                <th>Installer h</th>
                <th>Leadership h</th>
                <th>Peak installers</th>
              </tr>
            </thead>
            <tbody>
              {result.weekRows.map((r) => (
                <tr key={r.week} className="border-t tabular">
                  <td className="py-1">{formatDate(r.week)}</td>
                  <td>
                    {r.b.openDays} → <strong>{r.a.openDays}</strong>
                  </td>
                  <td>
                    {r.b.calendarHours} → <strong>{r.a.calendarHours}</strong>
                  </td>
                  <td>
                    {r.b.installerHours} → <strong>{r.a.installerHours}</strong>
                  </td>
                  <td>
                    {r.b.leadershipHours} → <strong>{r.a.leadershipHours}</strong>
                  </td>
                  <td>
                    {r.b.installerPeak} → <strong>{r.a.installerPeak}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {result.acts.length ? (
          <div className="text-xs">
            <div className="font-medium">Activity working durations that change (dates are not moved)</div>
            <ul>
              {result.acts.map(({ a, before, after }) => (
                <li key={a.key}>
                  {a.code} {a.name}: {before} → {after} working days
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.blocking.length ? (
          <div role="alert" className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {result.blocking.slice(0, 5).map((b, i) => (
              <div key={i}>{b.message}</div>
            ))}
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">Headcounts are unchanged; only open days and hours change.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={result.blocking.length > 0} onClick={() => onApply(result.ops)}>
            Apply calendar change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
