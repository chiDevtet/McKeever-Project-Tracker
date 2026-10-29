"use client";

import { AlertTriangle, History, Scissors } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate } from "@/domain/dates";
import type { ActivityInput, ProgressStatus } from "@/domain/plan";
import { PROGRESS_STATUS_LABELS, validateProgress, type ProgressDraft } from "@/domain/progress";
import { formatTimestamp } from "@/lib/format";
import { rpc, RpcError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import type { getProgressView } from "@/server/services/progress";

type View = Awaited<ReturnType<typeof getProgressView>>;
type Row = View["rows"][number];

const STATUS_TONE: Record<ProgressStatus, string> = { NOT_STARTED: "text-muted-foreground", IN_PROGRESS: "text-foreground", COMPLETE: "text-success", ON_HOLD: "text-warning" };
const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

export function ProgressWorkspace({ view, projectId, canEdit }: { view: View; projectId: string; canEdit: boolean }) {
  const { data } = view;
  const [filter, setFilter] = useState({ search: "", status: "", systemId: "" });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [splitKey, setSplitKey] = useState<string | null>(null);
  const progress = useMemo(() => new Map(data.progress.map((p) => [p.activityKey, p])), [data.progress]);
  const systems = new Map(data.systems.map((s) => [s.id, s.name]));
  const rowByKey = new Map(view.rows.map((r) => [r.key, r]));
  const activities = data.activities
    .filter((a) => !a.archived)
    .filter((a) => {
      const st = progress.get(a.key)?.status ?? "NOT_STARTED";
      const q = filter.search.toLowerCase();
      return (!filter.status || st === filter.status) && (!filter.systemId || (filter.systemId === "shared" ? a.systemId === null : a.systemId === filter.systemId)) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q));
    })
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart) || a.code.localeCompare(b.code));
  const counts = data.activities.filter((a) => !a.archived).reduce<Record<string, number>>((acc, a) => ((acc[progress.get(a.key)?.status ?? "NOT_STARTED"] = (acc[progress.get(a.key)?.status ?? "NOT_STARTED"] ?? 0) + 1), acc), {});
  const open = openKey ? data.activities.find((a) => a.key === openKey) : null;
  const split = splitKey ? data.activities.find((a) => a.key === splitKey) : null;

  if (!data.activities.some((a) => !a.archived)) {
    return (
      <div className="p-4">
        <EmptyState title="No installation activities yet">
          Progress is recorded against installation activities. Add them on the{" "}
          <Link className="underline" href={`/projects/${projectId}/schedule`}>
            Schedule
          </Link>{" "}
          tab or create them from a committed source schedule on the{" "}
          <Link className="underline" href={`/projects/${projectId}/imports`}>
            Imports
          </Link>{" "}
          tab.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>
          <span className="block text-muted-foreground">Search</span>
          <Input aria-label="Search activities" className="h-9 w-56" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Code or name" />
        </label>
        <label>
          <span className="block text-muted-foreground">Status</span>
          <select className={selectCls} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All ({data.activities.filter((a) => !a.archived).length})</option>
            {(Object.keys(PROGRESS_STATUS_LABELS) as ProgressStatus[]).map((s) => (
              <option key={s} value={s}>
                {PROGRESS_STATUS_LABELS[s]} ({counts[s] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-muted-foreground">System</span>
          <select className={selectCls} value={filter.systemId} onChange={(e) => setFilter({ ...filter, systemId: e.target.value })}>
            <option value="">All systems</option>
            <option value="shared">Shared systems</option>
            {data.systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto max-w-md self-center text-muted-foreground">
          {view.baseline ? `Baseline dates from “${view.baseline.name}” (${formatTimestamp(view.baseline.createdAt)}).` : "No baseline captured yet; capture one on Plans & history to compare planned dates."} Percentages are reported progress, not installed quantities or actual labor.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Activity</th>
              <th className="px-2">System</th>
              <th className="px-2">Current plan</th>
              <th className="px-2">Baseline</th>
              <th className="px-2">Status</th>
              <th className="px-2">Actual start</th>
              <th className="px-2">Actual finish</th>
              <th className="px-2 text-right">%</th>
              <th className="px-2">Last update</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((a) => {
              const p = progress.get(a.key);
              const r = rowByKey.get(a.key);
              const st = p?.status ?? "NOT_STARTED";
              const moved = r?.baseline && (r.baseline.start !== a.plannedStart || r.baseline.finish !== a.plannedFinish);
              const reviewDue = st === "ON_HOLD" && p?.holdReviewDate && p.holdReviewDate <= view.today;
              return (
                <tr key={a.key} className="cursor-pointer border-t hover:bg-accent/50" onClick={() => setOpenKey(a.key)}>
                  <td className="px-2 py-1.5">
                    <button type="button" className="text-left hover:underline" onClick={() => setOpenKey(a.key)}>
                      <span className="font-mono text-xs">{a.code}</span> {a.name}
                    </button>
                  </td>
                  <td className="px-2 text-xs">{a.systemId ? systems.get(a.systemId) : "Shared"}</td>
                  <td className="px-2 text-xs tabular whitespace-nowrap">
                    {formatDate(a.plannedStart)} – {formatDate(a.plannedFinish)}
                  </td>
                  <td className={cn("px-2 text-xs tabular whitespace-nowrap", moved ? "text-warning" : "text-muted-foreground")}>{r?.baseline ? `${formatDate(r.baseline.start)} – ${formatDate(r.baseline.finish)}` : "—"}</td>
                  <td className={cn("px-2 text-xs font-medium whitespace-nowrap", STATUS_TONE[st])}>
                    {PROGRESS_STATUS_LABELS[st]}
                    {st === "ON_HOLD" && r?.reservations.length ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 font-normal" title="Reservations are kept for review while on hold">
                        <AlertTriangle className="size-3" aria-hidden /> {r.reservations.length} reserved
                      </span>
                    ) : null}
                    {reviewDue ? <div className="font-normal text-destructive">Review due {formatDate(p!.holdReviewDate)}</div> : null}
                  </td>
                  <td className="px-2 text-xs tabular">{formatDate(p?.actualStart) || "—"}</td>
                  <td className="px-2 text-xs tabular">{formatDate(p?.actualFinish) || "—"}</td>
                  <td className="px-2 text-right text-xs tabular">{p?.percentComplete ?? "—"}</td>
                  <td className="px-2 text-xs text-muted-foreground">{r?.updatedAt ? `${r.updatedBy ?? "Unknown"} · ${formatTimestamp(r.updatedAt)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {activities.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No activities match the filters.</p> : null}
      </div>

      {open ? <ProgressDialog key={open.key} projectId={projectId} activity={open} row={rowByKey.get(open.key)!} view={view} canEdit={canEdit} onClose={() => setOpenKey(null)} onSplit={() => setSplitKey(open.key)} /> : null}
      {split ? <SplitDialog activity={split} view={view} onClose={() => setSplitKey(null)} /> : null}
    </div>
  );
}

function ProgressDialog({ projectId, activity, row, view, canEdit, onClose, onSplit }: { projectId: string; activity: ActivityInput; row: Row; view: View; canEdit: boolean; onClose: () => void; onSplit: () => void }) {
  const router = useRouter();
  const prev = view.data.progress.find((p) => p.activityKey === activity.key) ?? null;
  const [form, setForm] = useState({
    status: (prev?.status ?? "NOT_STARTED") as ProgressStatus,
    actualStart: prev?.actualStart ?? "",
    actualFinish: prev?.actualFinish ?? "",
    percent: prev?.percentComplete === null || prev?.percentComplete === undefined ? "" : String(prev.percentComplete),
    holdReason: prev?.holdReason ?? "",
    holdReviewDate: prev?.holdReviewDate ?? "",
    reopenReason: "",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const events = view.events.filter((e) => e.activityKey === activity.key);
  const reopening = prev?.status === "COMPLETE" && form.status !== "COMPLETE";
  const pct = form.percent.trim() === "" ? null : Number(form.percent);
  const draft: ProgressDraft = { status: form.status, actualStart: form.actualStart || null, actualFinish: form.actualFinish || null, percentComplete: pct, holdReason: form.holdReason || null, holdReviewDate: form.holdReviewDate || null, reopenReason: form.reopenReason || null };
  const problems = validateProgress(prev, draft, view.today);

  async function save() {
    if (pct !== null && !Number.isFinite(pct)) return setError("Percent complete must be a number between 0 and 100.");
    if (problems.length) return setError(problems.map((p) => p.message).join("\n"));
    setBusy(true);
    setError(null);
    try {
      await rpc("progress.update", { projectId, activityKey: activity.key, expectedVersion: row.version, ...draft, note: form.note.trim() || null });
      toast.success(`${activity.code} progress recorded`);
      router.refresh();
      onClose();
    } catch (e) {
      if (e instanceof RpcError && e.status === 409) setStale(true);
      setError(e instanceof RpcError ? e.message : "Progress was not saved. Your entry is kept; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {activity.code} · {activity.name}
          </DialogTitle>
          <DialogDescription>
            Current plan {formatDate(activity.plannedStart)} – {formatDate(activity.plannedFinish)}
            {row.baseline ? ` · baseline ${formatDate(row.baseline.start)} – ${formatDate(row.baseline.finish)}` : ""}. Recording progress never changes staffing, reservations, or milestones.
          </DialogDescription>
        </DialogHeader>
        {canEdit ? (
          <div className="space-y-3">
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1 text-xs text-muted-foreground">Status</legend>
              {(Object.keys(PROGRESS_STATUS_LABELS) as ProgressStatus[]).map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="radio" name="status" checked={form.status === s} onChange={() => setForm({ ...form, status: s })} /> {PROGRESS_STATUS_LABELS[s]}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="ps">Actual start</Label>
                <Input id="ps" type="date" max={view.today} value={form.actualStart} onChange={(e) => setForm({ ...form, actualStart: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf">Actual finish</Label>
                <Input id="pf" type="date" max={view.today} value={form.actualFinish} onChange={(e) => setForm({ ...form, actualFinish: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pp">Percent complete (reported)</Label>
                <Input id="pp" inputMode="decimal" value={form.status === "COMPLETE" ? "100" : form.percent} disabled={form.status === "COMPLETE"} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
              </div>
            </div>
            {form.status === "ON_HOLD" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                <div className="space-y-1">
                  <Label htmlFor="hr">Hold reason</Label>
                  <Input id="hr" value={form.holdReason} onChange={(e) => setForm({ ...form, holdReason: e.target.value })} placeholder="Access restriction, predecessor delay, coordination…" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="hd">Review by (optional)</Label>
                  <Input id="hd" type="date" value={form.holdReviewDate} onChange={(e) => setForm({ ...form, holdReviewDate: e.target.value })} />
                </div>
                {row.reservations.length ? <p className="text-xs text-warning sm:col-span-2">{row.reservations.length} staffing reservation(s) stay in place and are flagged for review: {row.reservations.map((r) => r.name).join(", ")}.</p> : null}
              </div>
            ) : null}
            {reopening ? (
              <div className="space-y-1">
                <Label htmlFor="rr">Reason for reopening completed work</Label>
                <Input id="rr" value={form.reopenReason} onChange={(e) => setForm({ ...form, reopenReason: e.target.value })} />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="pn">Progress note</Label>
              <Textarea id="pn" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Conditions, coordination, or access notes" />
            </div>
            {problems.length && !error ? (
              <ul className="space-y-0.5 text-xs text-warning">
                {problems.map((p) => (
                  <li key={p.message}>⚠ {p.message}</li>
                ))}
              </ul>
            ) : null}
            <FormError message={error} />
            {stale ? (
              <Button size="sm" variant="outline" onClick={() => router.refresh()}>
                Reload latest progress
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">You have read-only access to this project.</p>
        )}

        <section className="space-y-1">
          <h3 className="flex items-center gap-1 text-sm font-semibold">
            <History className="size-4" aria-hidden /> History
          </h3>
          {events.length === 0 ? <p className="text-xs text-muted-foreground">No progress recorded yet.</p> : null}
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {events.map((e) => (
              <li key={e.id} className="rounded border px-2 py-1">
                <div className="flex flex-wrap gap-1">
                  <Badge variant={e.kind === "REOPEN" ? "destructive" : "outline"}>{e.kind.toLowerCase()}</Badge>
                  <span className="font-medium">{e.actor}</span>
                  <span className="text-muted-foreground">{formatTimestamp(e.createdAt)}</span>
                </div>
                <div>
                  {String(e.before?.status ? PROGRESS_STATUS_LABELS[e.before.status as ProgressStatus] : "Not started")} → {PROGRESS_STATUS_LABELS[(e.after?.status as ProgressStatus) ?? "NOT_STARTED"]}
                  {e.after?.actualStart ? ` · start ${formatDate(e.after.actualStart as string)}` : ""}
                  {e.after?.actualFinish ? ` · finish ${formatDate(e.after.actualFinish as string)}` : ""}
                  {e.after?.percentComplete !== null && e.after?.percentComplete !== undefined ? ` · ${String(e.after.percentComplete)}%` : ""}
                </div>
                {e.note ? <div className="whitespace-pre-wrap text-muted-foreground">{e.note}</div> : null}
              </li>
            ))}
          </ul>
        </section>

        <DialogFooter className="gap-2">
          {canEdit && (prev?.status === "IN_PROGRESS" || prev?.status === "ON_HOLD") ? (
            <Button variant="outline" className="sm:mr-auto" onClick={onSplit}>
              <Scissors className="size-4" /> Split remaining work
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit ? (
            <Button disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Record progress"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitDialog({ activity, view, onClose }: { activity: ActivityInput; view: View; onClose: () => void }) {
  const router = useRouter();
  const reservations = view.data.nodes.filter((n) => n.activityKey === activity.key);
  const defaultStart = view.today >= activity.plannedFinish ? addDays(view.today, 1) : view.today > activity.plannedStart ? view.today : addDays(activity.plannedStart, 1);
  const [form, setForm] = useState({ start: defaultStart, finish: activity.plannedFinish > defaultStart ? activity.plannedFinish : defaultStart, name: `${activity.name} (remaining)` });
  const [moveRes, setMoveRes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split remaining work from {activity.code}</DialogTitle>
          <DialogDescription>The original keeps its start and recorded actual dates and ends the working day before the remainder. Successors and milestone links follow the remaining activity, which you can then reschedule on the Schedule tab.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="sn">Remaining activity name</Label>
            <Input id="sn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ss">Remaining start</Label>
              <Input id="ss" type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf">Remaining finish</Label>
              <Input id="sf" type="date" value={form.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} />
            </div>
          </div>
          {reservations.length ? (
            <fieldset className="space-y-1 text-sm">
              <legend className="text-xs text-muted-foreground">Reservations to attach to the remaining work (unselected stay with the original)</legend>
              {reservations.map((n) => (
                <label key={n.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={moveRes.has(n.key)} onChange={() => setMoveRes((s) => (s.has(n.key) ? new Set([...s].filter((k) => k !== n.key)) : new Set([...s, n.key])))} /> {n.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !form.name.trim() || !form.start || !form.finish}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await rpc("plans.applyOps", { planId: view.data.plan.id, expectedRevision: view.data.plan.revision, ops: [{ type: "splitActivity", key: activity.key, newKey: crypto.randomUUID(), remainingStart: form.start, remainingFinish: form.finish, name: form.name.trim(), moveReservations: [...moveRes] }] });
                toast.success(`Split saved (working plan revision ${r.revision})`);
                router.refresh();
                onClose();
              } catch (e) {
                setError(e instanceof RpcError ? e.message : "Not saved");
              } finally {
                setBusy(false);
              }
            }}
          >
            Split
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
