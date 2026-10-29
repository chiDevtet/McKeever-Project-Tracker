"use client";

import { Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/domain/dates";
import type { MoveRequest } from "@/domain/move";
import type { PlanOp } from "@/domain/ops";
import type { ActivityInput, PlanData } from "@/domain/plan";
import { wouldCreateCycle, workingDuration } from "@/domain/schedule";
import { areaOptions } from "@/components/manpower/node-form";

interface Props {
  data: PlanData;
  activity: ActivityInput;
  canEdit: boolean;
  apply: (ops: PlanOp[], summary?: string) => boolean;
  onRequestMove: (req: MoveRequest) => void;
  onSelectNode?: (nodeKey: string) => void;
}

const STATUS_TEXT: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETE: "Complete", ON_HOLD: "On hold" };
const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function ActivityPanel({ data, activity, canEdit, apply, onRequestMove, onSelectNode }: Props) {
  const [form, setForm] = useState({ name: activity.name, code: activity.code, phaseId: activity.phaseId ?? "", areaId: activity.areaId ?? "", systemId: activity.systemId ?? "", calendarKey: activity.calendarKey ?? "", costCode: activity.costCode ?? "", notes: activity.notes ?? "" });
  const [dates, setDates] = useState({ start: activity.plannedStart, finish: activity.plannedFinish });
  const [link, setLink] = useState({ other: "", lag: "0", direction: "successor" as "successor" | "predecessor" });
  const [milestone, setMilestone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const progress = data.progress.find((p) => p.activityKey === activity.key);
  const preds = data.links.filter((l) => l.successorKey === activity.key);
  const succs = data.links.filter((l) => l.predecessorKey === activity.key);
  const byKey = new Map(data.activities.map((a) => [a.key, a]));
  const reserved = data.nodes.filter((n) => n.activityKey === activity.key);
  const milestoneLinks = data.activityMilestones.filter((m) => m.activityKey === activity.key);
  const sources = data.sourceWindows.filter((s) => s.activityKey === activity.key);

  function saveDetails() {
    if (!form.name.trim()) return setError("Name is required.");
    setError(null);
    apply([{ type: "updateActivity", key: activity.key, patch: { name: form.name.trim(), code: form.code.trim(), phaseId: form.phaseId || null, areaId: form.areaId || null, systemId: form.systemId || null, calendarKey: form.calendarKey || null, costCode: form.costCode.trim() || null, notes: form.notes || null } }], `Edit ${activity.code}`);
  }

  function addLink() {
    if (!link.other) return;
    const lag = Number(link.lag);
    if (!Number.isInteger(lag) || lag < 0) return setError("Lag must be a whole number of working days (0 or more).");
    const [p, s] = link.direction === "successor" ? [activity.key, link.other] : [link.other, activity.key];
    if (wouldCreateCycle(data.links, p, s)) return setError("That link would create a circular dependency, so it was not added.");
    setError(null);
    apply([{ type: "addLink", predecessorKey: p, successorKey: s, lagDays: lag }], "Add dependency");
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            {activity.code} · {activity.name}
          </h2>
          <Badge variant="outline">{STATUS_TEXT[progress?.status ?? "NOT_STARTED"]}</Badge>
          {activity.archived ? <Badge variant="secondary">Archived</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Planned {formatDate(activity.plannedStart)} – {formatDate(activity.plannedFinish)} · {workingDuration(data, activity)} working days
          {progress?.actualStart ? ` · actual start ${formatDate(progress.actualStart)}` : ""}
          {progress?.actualFinish ? ` · actual finish ${formatDate(progress.actualFinish)}` : ""}
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Dates</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="act-start" className="text-xs">
              Planned start
            </Label>
            <Input id="act-start" type="date" disabled={!canEdit} value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-finish" className="text-xs">
              Planned finish
            </Label>
            <Input id="act-finish" type="date" disabled={!canEdit} value={dates.finish} onChange={(e) => setDates({ ...dates, finish: e.target.value })} />
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={!dates.start || dates.start === activity.plannedStart} onClick={() => onRequestMove({ kind: "dates", moves: [{ key: activity.key, start: dates.start }], rule: "preserve-working-duration" })}>
              Move to new start (keep duration)
            </Button>
            <Button size="sm" variant="outline" disabled={!dates.start || !dates.finish || (dates.start === activity.plannedStart && dates.finish === activity.plannedFinish)} onClick={() => onRequestMove({ kind: "dates", moves: [{ key: activity.key, start: dates.start, finish: dates.finish }], rule: "keep-finish" })}>
              Use these exact dates
            </Button>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">Every date change opens a preview of successors, staffing, and milestones before anything is saved.</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Details</h3>
        <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-2">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="act-name" className="text-xs">
              Name
            </Label>
            <Input id="act-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-code" className="text-xs">
              Activity ID
            </Label>
            <Input id="act-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-cost" className="text-xs">
              Cost code (optional)
            </Label>
            <Input id="act-cost" maxLength={40} value={form.costCode} onChange={(e) => setForm({ ...form, costCode: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-system" className="text-xs">
              System
            </Label>
            <select id="act-system" className={selectCls} value={form.systemId} onChange={(e) => setForm({ ...form, systemId: e.target.value })}>
              <option value="">Shared systems</option>
              {data.systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-phase" className="text-xs">
              Phase
            </Label>
            <select id="act-phase" className={selectCls} value={form.phaseId} onChange={(e) => setForm({ ...form, phaseId: e.target.value })}>
              <option value="">No phase</option>
              {data.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-area" className="text-xs">
              Area
            </Label>
            <select id="act-area" className={selectCls} value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
              <option value="">No area</option>
              {areaOptions(data).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="act-cal" className="text-xs">
              Calendar
            </Label>
            <select id="act-cal" className={selectCls} value={form.calendarKey} onChange={(e) => setForm({ ...form, calendarKey: e.target.value })}>
              <option value="">Project calendar</option>
              {data.calendars
                .filter((c) => !c.isDefault)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="act-notes" className="text-xs">
              Notes
            </Label>
            <Textarea id="act-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </fieldset>
        {canEdit ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={saveDetails}>
              Save details
            </Button>
            <Button size="sm" variant="outline" onClick={() => apply([{ type: "updateActivity", key: activity.key, patch: { archived: !activity.archived } }], activity.archived ? `Restore ${activity.code}` : `Archive ${activity.code}`)}>
              {activity.archived ? "Restore from archive" : "Archive activity"}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Dependencies (finish-to-start)</h3>
        <ul className="space-y-1 text-xs">
          {preds.map((l) => (
            <li key={`p:${l.predecessorKey}`} className="flex items-center justify-between rounded bg-muted px-2 py-1">
              <span>
                After <strong>{byKey.get(l.predecessorKey)?.code}</strong> {byKey.get(l.predecessorKey)?.name} + {l.lagDays} working-day lag
              </span>
              {canEdit ? (
                <button type="button" aria-label="Remove dependency" onClick={() => apply([{ type: "removeLink", predecessorKey: l.predecessorKey, successorKey: l.successorKey }], "Remove dependency")}>
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
          {succs.map((l) => (
            <li key={`s:${l.successorKey}`} className="flex items-center justify-between rounded bg-muted px-2 py-1">
              <span>
                Before <strong>{byKey.get(l.successorKey)?.code}</strong> {byKey.get(l.successorKey)?.name} + {l.lagDays} working-day lag
              </span>
              {canEdit ? (
                <button type="button" aria-label="Remove dependency" onClick={() => apply([{ type: "removeLink", predecessorKey: l.predecessorKey, successorKey: l.successorKey }], "Remove dependency")}>
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
          {!preds.length && !succs.length ? <li className="text-muted-foreground">No links. Links are optional.</li> : null}
        </ul>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <select aria-label="Link direction" className="h-8 rounded border bg-background px-1" value={link.direction} onChange={(e) => setLink({ ...link, direction: e.target.value as "successor" | "predecessor" })}>
              <option value="successor">Followed by</option>
              <option value="predecessor">After</option>
            </select>
            <select aria-label="Other activity" className="h-8 max-w-[11rem] rounded border bg-background px-1" value={link.other} onChange={(e) => setLink({ ...link, other: e.target.value })}>
              <option value="">Choose activity…</option>
              {data.activities
                .filter((a) => a.key !== activity.key && !a.archived)
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.code} {a.name}
                  </option>
                ))}
            </select>
            <Input aria-label="Lag in working days" className="h-8 w-14" inputMode="numeric" value={link.lag} onChange={(e) => setLink({ ...link, lag: e.target.value })} />
            <span>day lag</span>
            <Button size="sm" variant="outline" onClick={addLink} disabled={!link.other}>
              <Link2 className="size-3.5" /> Link
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Linked milestones</h3>
        <p className="text-[11px] text-muted-foreground">A milestone constrains this activity only when you link it here.</p>
        <ul className="space-y-1 text-xs">
          {milestoneLinks.map((ml) => {
            const m = data.milestones.find((x) => x.id === ml.milestoneId);
            if (!m) return null;
            const date = m.date ?? m.candidates.find((c) => c.date)?.date ?? null;
            return (
              <li key={m.id} className="flex items-center justify-between rounded bg-muted px-2 py-1">
                <span>
                  {m.code} {m.name}: {formatDate(date)} {m.reviewStatus === "CONFIRMED" ? "" : "(candidate)"}
                  {date && activity.plannedFinish > date ? <strong className="ml-1 text-warning">finishes after</strong> : null}
                </span>
                {canEdit ? (
                  <button type="button" aria-label="Unlink milestone" onClick={() => apply([{ type: "unlinkMilestone", activityKey: activity.key, milestoneId: m.id }], "Unlink milestone")}>
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {canEdit && data.milestones.length ? (
          <div className="flex gap-1">
            <select aria-label="Milestone" className="h-8 flex-1 rounded border bg-background px-1 text-xs" value={milestone} onChange={(e) => setMilestone(e.target.value)}>
              <option value="">Choose milestone…</option>
              {data.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {data.phases.find((p) => p.id === m.phaseId)?.name ?? "Project"} · {m.code} {m.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={!milestone} onClick={() => apply([{ type: "linkMilestone", activityKey: activity.key, milestoneId: milestone }], "Link milestone")}>
              Link
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Source references</h3>
        {sources.length === 0 ? <p className="text-xs text-muted-foreground">Not linked to an imported source activity.</p> : null}
        <ul className="space-y-1 text-xs">
          {sources.map((s) => (
            <li key={s.lineageId + s.externalId} className="rounded bg-muted px-2 py-1">
              <strong>{s.externalId}</strong> {s.name} · {formatDate(s.start)} – {formatDate(s.finish)} · {s.lineageName} {s.versionLabel}
              {s.removed ? <span className="ml-1 font-medium text-destructive">removed in latest version</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Staffing reserved for this activity</h3>
        {reserved.length === 0 ? <p className="text-xs text-muted-foreground">Not allocated. Activity labor is unspecified (not zero); project-level staffing still counts.</p> : null}
        <ul className="space-y-1 text-xs">
          {reserved.map((n) => (
            <li key={n.key}>
              <button type="button" className="underline" onClick={() => onSelectNode?.(n.key)}>
                {n.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <FormError message={error} />
    </div>
  );
}
