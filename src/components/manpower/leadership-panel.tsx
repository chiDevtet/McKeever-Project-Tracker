"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, WEEKDAY_SHORT, type ISODate } from "@/domain/dates";
import type { PlanOp } from "@/domain/ops";
import type { DayOverride, LeadershipInput, PlanData } from "@/domain/plan";
import { rpc, RpcError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

interface Props {
  data: PlanData;
  assignment: LeadershipInput | null;
  people: { id: string; displayName: string; title: string | null }[];
  roles: string[];
  canEdit: boolean;
  week: ISODate | null;
  weekSummary: { onsiteDays: number; hours: number } | null;
  apply: (ops: PlanOp[], summary?: string) => boolean;
  onPeopleChanged: (p: { id: string; displayName: string; title: string | null }) => void;
  onDone: () => void;
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function LeadershipPanel({ data, assignment, people, roles, canEdit, week, weekSummary, apply, onPeopleChanged, onDone }: Props) {
  const isNew = !assignment;
  const [a, setA] = useState<LeadershipInput>(
    assignment ?? {
      key: crypto.randomUUID(),
      personId: null,
      personName: "TBD",
      role: roles[0] ?? "Project manager",
      responsibilitySystemIds: [],
      responsibilityPhaseIds: [],
      responsibilityNote: null,
      startDate: null,
      endDate: null,
      onsiteMode: "PROJECT_CALENDAR",
      onsiteWeekdays: [1, 2, 3, 4, 5],
      onsiteHours: null,
      onsiteStart: null,
      offsiteHoursPerWeek: null,
      dayOverrides: [],
      notes: null,
      sortOrder: data.leadership.length,
    },
  );
  const [hours, setHours] = useState(a.onsiteHours === null ? "" : String(a.onsiteHours));
  const [offsite, setOffsite] = useState(a.offsiteHoursPerWeek === null ? "" : String(a.offsiteHoursPerWeek));
  const [newPerson, setNewPerson] = useState<{ name: string; title: string } | null>(null);
  const [override, setOverride] = useState<{ date: string; kind: DayOverride["kind"]; hours: string }>({ date: week ?? "", kind: "offsite", hours: "" });
  const [error, setError] = useState<string | null>(null);

  async function addPerson() {
    if (!newPerson?.name.trim()) return;
    try {
      const p = await rpc("people.create", { displayName: newPerson.name, title: newPerson.title || null });
      onPeopleChanged(p);
      setA({ ...a, personId: p.id, personName: p.displayName });
      setNewPerson(null);
    } catch (e) {
      setError(e instanceof RpcError ? e.message : "Could not add the person.");
    }
  }

  function save() {
    const h = num(hours);
    const o = num(offsite);
    if (h !== null && (!(h > 0) || h > 24)) return setError("Onsite hours per day must be above 0 and at most 24, or blank for calendar hours.");
    if (o !== null && (!(o >= 0) || o > 168)) return setError("Offsite hours per week must be between 0 and 168.");
    if ((a.startDate === null) !== (a.endDate === null)) return setError("Select both assignment dates, or leave both blank (not counted onsite until dates are selected).");
    if (a.startDate && a.endDate && a.endDate < a.startDate) return setError("The end date is before the start date.");
    setError(null);
    const next = { ...a, onsiteHours: h, offsiteHoursPerWeek: o };
    if (apply([{ type: "upsertLeadership", assignment: next }], `${isNew ? "Add" : "Update"} leadership ${next.personName} (${next.role})`)) onDone();
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{isNew ? "Add onsite leadership" : `${a.personName} · ${a.role}`}</h2>
        <p className="text-xs text-muted-foreground">Leadership is scheduled separately from installer pools. A person counts once onsite no matter how many responsibilities they hold.</p>
        {week && weekSummary ? (
          <p className="mt-1 text-xs">
            Week of {formatDate(week)}: <strong>{weekSummary.onsiteDays}</strong> onsite day(s), <strong>{weekSummary.hours}</strong> onsite h
          </p>
        ) : null}
      </div>
      <fieldset disabled={!canEdit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ld-person">Person</Label>
          <select
            id="ld-person"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={a.personId ?? ""}
            onChange={(e) => {
              const p = people.find((x) => x.id === e.target.value);
              setA({ ...a, personId: p?.id ?? null, personName: p?.displayName ?? "TBD" });
            }}
          >
            <option value="">TBD (to be named)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.title ? ` — ${p.title}` : ""}
              </option>
            ))}
          </select>
          {newPerson ? (
            <div className="flex gap-1">
              <Input aria-label="New person name" placeholder="Name" value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
              <Input aria-label="Title" placeholder="Title" value={newPerson.title} onChange={(e) => setNewPerson({ ...newPerson, title: e.target.value })} />
              <Button size="sm" onClick={addPerson}>
                Add
              </Button>
            </div>
          ) : (
            <button type="button" className="text-xs underline" onClick={() => setNewPerson({ name: "", title: "" })}>
              + New personnel record (no login required)
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ld-role">Project role</Label>
          <Input id="ld-role" list="ld-roles" value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })} />
          <datalist id="ld-roles">
            {roles.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Responsible for systems</div>
          <div className="flex flex-wrap gap-1.5">
            {data.systems.map((s) => {
              const on = a.responsibilitySystemIds.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on} onClick={() => setA({ ...a, responsibilitySystemIds: toggle(a.responsibilitySystemIds, s.id) })} className={cn("rounded border px-2 py-0.5 text-xs", on ? "border-brand bg-brand text-white" : "bg-background")}>
                  {on ? "✓ " : ""}
                  {s.name}
                </button>
              );
            })}
          </div>
          {data.phases.length ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {data.phases.map((p) => {
                const on = a.responsibilityPhaseIds.includes(p.id);
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => setA({ ...a, responsibilityPhaseIds: toggle(a.responsibilityPhaseIds, p.id) })} className={cn("rounded border px-2 py-0.5 text-xs", on ? "border-brand bg-brand text-white" : "bg-background")}>
                    {on ? "✓ " : ""}
                    {p.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Scope labels do not add headcount. Leave blank for the whole project.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="ld-start">Onsite from</Label>
            <Input id="ld-start" type="date" value={a.startDate ?? ""} onChange={(e) => setA({ ...a, startDate: e.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ld-end">Onsite to</Label>
            <Input id="ld-end" type="date" value={a.endDate ?? ""} onChange={(e) => setA({ ...a, endDate: e.target.value || null })} />
          </div>
        </div>
        {!a.startDate || !a.endDate ? <p className="text-xs text-warning">Assignment dates are not selected: this person is listed but not counted onsite.</p> : null}
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Onsite days</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="ld-mode" checked={a.onsiteMode === "PROJECT_CALENDAR"} onChange={() => setA({ ...a, onsiteMode: "PROJECT_CALENDAR" })} /> Every open project calendar day (full time)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="ld-mode" checked={a.onsiteMode === "WEEKDAYS"} onChange={() => setA({ ...a, onsiteMode: "WEEKDAYS" })} /> Selected weekdays
          </label>
          {a.onsiteMode === "WEEKDAYS" ? (
            <div className="flex flex-wrap gap-1 pl-6">
              {WEEKDAY_SHORT.map((d, i) => {
                const on = a.onsiteWeekdays.includes(i + 1);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setA({ ...a, onsiteWeekdays: on ? a.onsiteWeekdays.filter((x) => x !== i + 1) : [...a.onsiteWeekdays, i + 1].sort() })} className={cn("rounded border px-2 py-0.5 text-xs", on ? "border-brand bg-brand text-white" : "bg-background")}>
                    {on ? "✓ " : ""}
                    {d}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="ld-hours">Onsite hours per day</Label>
            <Input id="ld-hours" inputMode="decimal" placeholder="Calendar hours" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ld-startt">Arrives</Label>
            <Input id="ld-startt" type="time" value={a.onsiteStart ?? ""} onChange={(e) => setA({ ...a, onsiteStart: e.target.value || null })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ld-offsite">Offsite management hours per week</Label>
          <Input id="ld-offsite" inputMode="decimal" placeholder="Optional" value={offsite} onChange={(e) => setOffsite(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Recorded for reference; never counted in onsite headcount or onsite hours.</p>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Day exceptions</div>
          {a.dayOverrides.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : null}
          <ul className="space-y-0.5 text-xs">
            {a.dayOverrides.map((o) => (
              <li key={o.date} className="flex items-center justify-between rounded bg-muted px-2 py-0.5">
                <span>
                  {formatDate(o.date)} · {o.kind === "offsite" ? "Offsite" : o.kind === "onsite" ? "Onsite" : `${o.hours} h`}
                </span>
                <button type="button" aria-label="Remove exception" onClick={() => setA({ ...a, dayOverrides: a.dayOverrides.filter((x) => x.date !== o.date) })}>
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-1">
            <Input aria-label="Exception date" type="date" className="h-8 w-36 text-xs" value={override.date} onChange={(e) => setOverride({ ...override, date: e.target.value })} />
            <select aria-label="Exception type" className="h-8 rounded border bg-background px-1 text-xs" value={override.kind} onChange={(e) => setOverride({ ...override, kind: e.target.value as DayOverride["kind"] })}>
              <option value="offsite">Offsite</option>
              <option value="onsite">Onsite</option>
              <option value="hours">Different hours</option>
            </select>
            {override.kind !== "offsite" ? <Input aria-label="Hours" inputMode="decimal" className="h-8 w-16 text-xs" placeholder="h" value={override.hours} onChange={(e) => setOverride({ ...override, hours: e.target.value })} /> : null}
            <Button
              size="sm"
              variant="outline"
              disabled={!override.date}
              onClick={() => {
                const h = num(override.hours);
                setA({ ...a, dayOverrides: [...a.dayOverrides.filter((x) => x.date !== override.date), { date: override.date, kind: override.kind, hours: override.kind === "offsite" ? null : h, start: null }].sort((x, y) => x.date.localeCompare(y.date)) });
              }}
            >
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ld-notes">Notes</Label>
          <Textarea id="ld-notes" rows={2} value={a.notes ?? ""} onChange={(e) => setA({ ...a, notes: e.target.value || null })} />
        </div>
      </fieldset>
      <FormError message={error} />
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={save}>{isNew ? "Add assignment" : "Save assignment"}</Button>
          {!isNew ? (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => {
                if (window.confirm(`Remove ${a.personName} (${a.role}) from this plan?`) && apply([{ type: "removeLeadership", key: a.key }], `Remove leadership ${a.personName}`)) onDone();
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
