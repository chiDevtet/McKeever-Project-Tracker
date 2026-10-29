"use client";

import { GitBranch, GitCompare, History, Plus, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/domain/dates";
import { ISSUE_CATEGORY_LABELS, type PlanningIssue } from "@/domain/issues";
import { formatHours, formatNumber, formatTimestamp } from "@/lib/format";
import { rpc, RpcError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import type { comparePlan, getHistory } from "@/server/services/history";

type HistoryView = Awaited<ReturnType<typeof getHistory>>;
type Compared = Awaited<ReturnType<typeof comparePlan>>;
type Ref = { planId?: string; snapshotId?: string };

const SNAPSHOT_LABEL: Record<string, string> = { BASELINE: "Baseline", REPORT: "Report snapshot", REVISION_BACKUP: "Revision backup" };
const PLAN_STATUS: Record<string, string> = { ACTIVE: "Active", PROMOTED: "Promoted", ARCHIVED: "Archived" };

export function PlansWorkspace({ projectId, history, canEdit }: { projectId: string; history: HistoryView; canEdit: boolean }) {
  const router = useRouter();
  const working = history.plans.find((p) => p.kind === "WORKING")!;
  const [creating, setCreating] = useState<null | { fromSnapshotId?: string; fromPlanId?: string }>(null);
  const [baseline, setBaseline] = useState(false);
  const [compare, setCompare] = useState<null | { other: Ref; label: string; action?: "promote" | "restore"; expectedOtherRevision?: number }>(null);
  const [auditFilter, setAuditFilter] = useState("");
  const snapshotsByPlan = new Map(history.plans.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <section className="space-y-2 rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold">
            <GitBranch className="size-4" aria-hidden /> Plans and scenarios
          </h2>
          <p className="text-xs text-muted-foreground">Scenarios are editable branches. Their demand stays out of the division forecast until promoted; promotion creates a new working revision and never rewrites baselines or submissions.</p>
          {canEdit ? (
            <Button size="sm" className="ml-auto" onClick={() => setCreating({ fromPlanId: working.id })}>
              <Plus className="size-4" /> New scenario
            </Button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Plan</th>
                <th>Status</th>
                <th>Revision</th>
                <th>Based on</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.plans.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1.5">
                    <span className="font-medium">{p.name}</span> {p.kind === "WORKING" ? <Badge>Working</Badge> : <Badge variant="outline">Scenario</Badge>}
                    {p.description ? <div className="text-xs text-muted-foreground">{p.description}</div> : null}
                  </td>
                  <td className="text-xs">{PLAN_STATUS[p.status]}</td>
                  <td className="tabular">{p.revision}</td>
                  <td className="text-xs text-muted-foreground">{p.basedOnPlanId ? `${snapshotsByPlan.get(p.basedOnPlanId) ?? "plan"} r${p.basedOnRevision}${p.basedOnSnapshotId ? " (snapshot)" : ""}` : "—"}</td>
                  <td className="text-xs text-muted-foreground">{formatTimestamp(p.updatedAt)}</td>
                  <td className="space-x-1 py-1 text-right whitespace-nowrap">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/projects/${projectId}/manpower${p.kind === "WORKING" ? "" : `?plan=${p.id}`}`}>Open</Link>
                    </Button>
                    {p.kind === "SCENARIO" ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setCompare({ other: { planId: p.id }, label: p.name })}>
                          <GitCompare className="size-3.5" /> Compare
                        </Button>
                        {canEdit && p.status === "ACTIVE" ? (
                          <>
                            <Button size="sm" onClick={() => setCompare({ other: { planId: p.id }, label: p.name, action: "promote", expectedOtherRevision: p.revision })}>
                              <Upload className="size-3.5" /> Promote…
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                if (!window.confirm(`Archive scenario “${p.name}”? It stays in history but can no longer be edited.`)) return;
                                try {
                                  await rpc("history.archiveScenario", { planId: p.id });
                                  router.refresh();
                                } catch (e) {
                                  toast.error(e instanceof RpcError ? e.message : "Not archived");
                                }
                              }}
                            >
                              Archive
                            </Button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Baselines and snapshots</h2>
          <p className="text-xs text-muted-foreground">Snapshots are immutable. Reports and submissions keep the snapshot they were generated from.</p>
          {canEdit ? (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setBaseline(true)}>
              <Plus className="size-4" /> Capture baseline
            </Button>
          ) : null}
        </div>
        {history.snapshots.length === 0 ? <p className="text-sm text-muted-foreground">No snapshots yet.</p> : null}
        <ul className="divide-y text-sm">
          {history.snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Badge variant={s.kind === "BASELINE" ? "default" : "outline"}>{SNAPSHOT_LABEL[s.kind]}</Badge>
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">
                {s.planName} r{s.planRevision} · {s.createdBy ?? "system"} · {formatTimestamp(s.createdAt)} · <span className="font-mono">{s.dataHash.slice(0, 10)}</span>
              </span>
              {s.submissions.map((x) => (
                <Badge key={x.id} variant="secondary">
                  Submission #{x.sequence} to {x.recipient} ({formatDate(x.issueDate)})
                </Badge>
              ))}
              <span className="ml-auto space-x-1 whitespace-nowrap">
                <Button size="sm" variant="outline" onClick={() => setCompare({ other: { snapshotId: s.id }, label: s.name })}>
                  <GitCompare className="size-3.5" /> Compare
                </Button>
                {canEdit ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setCreating({ fromSnapshotId: s.id })}>
                      <GitBranch className="size-3.5" /> Scenario from this
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCompare({ other: { snapshotId: s.id }, label: s.name, action: "restore" })}>
                      <RotateCcw className="size-3.5" /> Restore…
                    </Button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-2 rounded-lg border bg-background p-3">
          <h2 className="flex items-center gap-1 text-sm font-semibold">
            <History className="size-4" aria-hidden /> Working plan revisions
          </h2>
          <ul className="max-h-[28rem] divide-y overflow-y-auto text-sm">
            {history.revisions.map((r) => (
              <li key={r.revision} className="py-1">
                <span className="tabular font-medium">r{r.revision}</span> <Badge variant="outline">{r.kind.toLowerCase().replace("_", " ")}</Badge> {r.summary}
                <div className="text-xs text-muted-foreground">
                  {r.actor} · {formatTimestamp(r.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2 rounded-lg border bg-background p-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Audit log</h2>
            <Input aria-label="Filter audit log" className="ml-auto h-8 w-56" placeholder="Filter" value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)} />
          </div>
          <ul className="max-h-[28rem] divide-y overflow-y-auto text-sm">
            {history.audit
              .filter((a) => !auditFilter || `${a.action} ${a.summary} ${a.actor}`.toLowerCase().includes(auditFilter.toLowerCase()))
              .map((a) => (
                <li key={a.id} className="py-1">
                  <span className="font-mono text-xs text-muted-foreground">{a.action}</span> {a.summary}
                  <div className="text-xs text-muted-foreground">
                    {a.actor} · {formatTimestamp(a.createdAt)}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      </div>

      {creating ? <ScenarioDialog projectId={projectId} source={creating} history={history} onClose={() => setCreating(null)} /> : null}
      {baseline ? <BaselineDialog planId={working.id} revision={working.revision} onClose={() => setBaseline(false)} /> : null}
      {compare ? <CompareDialog projectId={projectId} {...compare} workingRevision={working.revision} onClose={() => setCompare(null)} /> : null}
    </div>
  );
}

function ScenarioDialog({ projectId, source, history, onClose }: { projectId: string; source: { fromSnapshotId?: string; fromPlanId?: string }; history: HistoryView; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = source.fromSnapshotId ? `snapshot “${history.snapshots.find((s) => s.id === source.fromSnapshotId)?.name}”` : `${history.plans.find((p) => p.id === source.fromPlanId)?.name ?? "working plan"}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New scenario</DialogTitle>
          <DialogDescription>Copies the schedule, staffing, allocations, leadership, and calendars from the {label}. Edit it freely; nothing changes in the working plan or the division forecast until you promote it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="sc-name">Name</Label>
            <Input id="sc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Six 10-hour days in June" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-desc">Description (optional)</Label>
            <Textarea id="sc-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !form.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await rpc("history.createScenario", { projectId, name: form.name.trim(), description: form.description.trim() || null, fromPlanId: source.fromPlanId ?? null, fromSnapshotId: source.fromSnapshotId ?? null });
                toast.success("Scenario created");
                router.push(`/projects/${projectId}/manpower?plan=${r.id}`);
              } catch (e) {
                setError(e instanceof RpcError ? e.message : "Not created");
                setBusy(false);
              }
            }}
          >
            Create scenario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BaselineDialog({ planId, revision, onClose }: { planId: string; revision: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Capture baseline</DialogTitle>
          <DialogDescription>Freezes the working plan at revision {revision} as a named, immutable baseline for later comparison.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="bl-name">Name</Label>
            <Input id="bl-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Preliminary baseline" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bl-desc">Description (optional)</Label>
            <Textarea id="bl-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !form.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await rpc("history.createBaseline", { planId, name: form.name.trim(), description: form.description.trim() || null });
                toast.success("Baseline captured");
                router.refresh();
                onClose();
              } catch (e) {
                setError(e instanceof RpcError ? e.message : "Not captured");
                setBusy(false);
              }
            }}
          >
            Capture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Delta({ a, b, fmt }: { a: number; b: number; fmt: (n: number) => string }) {
  const d = Math.round((b - a) * 100) / 100;
  return <span className={cn("tabular", d > 0 ? "text-warning" : d < 0 ? "text-success" : "text-muted-foreground")}>{d === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`}</span>;
}

function CompareDialog({ projectId, other, label, action, expectedOtherRevision, workingRevision, onClose }: { projectId: string; other: Ref; label: string; action?: "promote" | "restore"; expectedOtherRevision?: number; workingRevision: number; onClose: () => void }) {
  const router = useRouter();
  const [result, setResult] = useState<Compared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void rpc("history.compare", { projectId, other }).then(setResult, (e) => setError(e instanceof RpcError ? e.message : "Comparison failed"));
  }, [projectId, other]);
  const c = result?.comparison;
  const changed = c?.activities.filter((a) => a.change !== "unchanged") ?? [];
  const categories = c ? [...new Set([...Object.keys(c.issues.base), ...Object.keys(c.issues.other)])] : [];
  const rows: [string, number, number, (n: number) => string][] = c
    ? [
        ["Peak onsite (total)", c.totals.base.peakTotal, c.totals.other.peakTotal, (n) => formatNumber(n)],
        ["Peak installers", c.totals.base.peakInstallers, c.totals.other.peakInstallers, (n) => formatNumber(n)],
        ["Peak leadership", c.totals.base.peakLeadership, c.totals.other.peakLeadership, (n) => formatNumber(n)],
        ["Installer hours", c.totals.base.installerHours, c.totals.other.installerHours, formatHours],
        ["Leadership hours", c.totals.base.leadershipHours, c.totals.other.leadershipHours, formatHours],
        ["Total onsite hours", c.totals.base.totalHours, c.totals.other.totalHours, formatHours],
      ]
    : [];
  const differingWeeks = c?.weeks.filter((w) => w.basePeak !== w.otherPeak || w.baseHours !== w.otherHours) ?? [];

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const r: { revision: number } =
        action === "promote"
          ? await rpc("history.promote", { scenarioId: other.planId!, expectedScenarioRevision: expectedOtherRevision!, expectedWorkingRevision: workingRevision })
          : await rpc("history.restore", { snapshotId: other.snapshotId!, expectedWorkingRevision: workingRevision });
      toast.success(`${action === "promote" ? "Promoted" : "Restored"}; working plan is now revision ${r.revision}. The prior state is kept as a revision backup.`);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof RpcError ? e.message : "Not applied");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{action === "promote" ? `Promote “${label}”` : action === "restore" ? `Restore “${label}”` : `Compare “${label}”`}</DialogTitle>
          <DialogDescription>
            {result ? `${result.otherLabel} compared with ${result.baseLabel}.` : "Calculating…"}{" "}
            {action === "promote" ? "Promotion replaces the working plan's schedule, staffing, and calendars with the scenario's as a new revision. Actual progress, baselines, and submissions are untouched." : action === "restore" ? "Restoring creates a new working revision with this snapshot's schedule, staffing, and calendars. Later history and actual progress are kept." : ""}
          </DialogDescription>
        </DialogHeader>
        {c ? (
          <div className="space-y-4 text-sm">
            <table className="w-full">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Measure</th>
                  <th className="text-right">Working plan</th>
                  <th className="text-right">{action === "restore" ? "Snapshot" : "Compared plan"}</th>
                  <th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, a, b, fmt]) => (
                  <tr key={name} className="border-t">
                    <td className="py-1">{name}</td>
                    <td className="text-right tabular">{fmt(a)}</td>
                    <td className="text-right tabular">{fmt(b)}</td>
                    <td className="text-right">
                      <Delta a={a} b={b} fmt={fmt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {c.range ? `Reporting range ${formatDate(c.range.start)} – ${formatDate(c.range.end)}. ` : "No dated work in either plan. "}
              {c.staffingRowsChanged} staffing row(s) and {c.leadershipChanged} leadership assignment(s) differ.
            </p>
            {differingWeeks.length ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">{differingWeeks.length} week(s) with different peak or hours</summary>
                <table className="mt-1 w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th>Week of</th>
                      <th className="text-right">Peak (working → other)</th>
                      <th className="text-right">Hours (working → other)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differingWeeks.map((w) => (
                      <tr key={w.week} className="border-t">
                        <td className="py-0.5">{formatDate(w.week)}</td>
                        <td className="text-right tabular">
                          {w.basePeak} → {w.otherPeak}
                        </td>
                        <td className="text-right tabular">
                          {formatHours(w.baseHours)} → {formatHours(w.otherHours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
            <div>
              <h3 className="text-sm font-semibold">Activity dates ({changed.length} changed)</h3>
              {changed.length === 0 ? <p className="text-xs text-muted-foreground">No activity dates differ.</p> : null}
              <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                {changed.map((a) => (
                  <li key={a.key}>
                    <Badge variant="outline">{a.change}</Badge> {a.code} {a.name}: {a.base ? `${formatDate(a.base.start)} – ${formatDate(a.base.finish)}` : "—"} → {a.other ? `${formatDate(a.other.start)} – ${formatDate(a.other.finish)}` : "—"}
                    {a.finishDelta ? ` (finish ${a.finishDelta > 0 ? "+" : ""}${a.finishDelta} working days)` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Planning issues</h3>
              <ul className="text-xs">
                {categories.map((k) => (
                  <li key={k}>
                    {ISSUE_CATEGORY_LABELS[k as PlanningIssue["category"]] ?? k}: {c.issues.base[k] ?? 0} → {c.issues.other[k] ?? 0}
                  </li>
                ))}
                {categories.length === 0 ? <li className="text-muted-foreground">No planning issues in either plan.</li> : null}
              </ul>
              {c.issues.added.length ? (
                <ul className="mt-1 space-y-0.5 text-xs text-warning">
                  {c.issues.added.slice(0, 12).map((i) => (
                    <li key={i.id}>⚠ {i.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {action ? "Cancel" : "Close"}
          </Button>
          {action ? (
            <Button disabled={busy || !c} onClick={run}>
              {action === "promote" ? "Promote to working plan" : "Restore as new revision"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
