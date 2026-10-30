"use client";

import { Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MovePreviewDialog } from "@/components/schedule/move-preview";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/domain/dates";
import type { MoveRequest } from "@/domain/move";
import type { PlanOp } from "@/domain/ops";
import type { PlanData } from "@/domain/plan";
import { proposeFromSource, sourceChangesFromRecords, sourceMoveRequest, type SourceRule } from "@/domain/source-apply";
import { formatTimestamp } from "@/lib/format";
import { rpc, RpcError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import type { listImports, SourceRecordView, versionRecords } from "@/server/services/imports";

type Lists = Awaited<ReturnType<typeof listImports>>;
type VersionView = Awaited<ReturnType<typeof versionRecords>>;

const STATUS_TONE: Record<string, string> = { COMMITTED: "text-success", FAILED: "text-destructive", CANCELED: "text-muted-foreground", NEEDS_REVIEW: "text-warning", VALIDATED: "text-foreground", EXTRACTING: "text-muted-foreground", UPLOADED: "text-muted-foreground" };
const CHANGE_LABEL: Record<string, string> = { ADDED: "Added", UNCHANGED: "Unchanged", CHANGED: "Changed", RENAMED: "Renamed", REMOVED: "Removed" };

export function ImportsHome({ projectId, lists, plan, canEdit, initialLineage }: { projectId: string; lists: Lists; plan: PlanData; canEdit: boolean; initialLineage: string | null }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [lineageChoice, setLineageChoice] = useState(lists.lineages.find((l) => l.kind === "PDF_SCHEDULE")?.id ?? "__new");
  const pickVersion = (lid: string | null) => lists.lineages.find((l) => l.id === lid)?.versions[0]?.id ?? lists.lineages.find((l) => l.versions.length && l.kind !== "MANUAL_TABLE")?.versions[0]?.id ?? null;
  const [versionId, setVersionId] = useState<string | null>(pickVersion(initialLineage));

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (lineageChoice !== "__new") fd.set("lineageId", lineageChoice);
    setUploading(true);
    const res = await fetch(`/api/projects/${projectId}/imports`, { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    setUploading(false);
    if (!body?.ok) return toast.error(body?.error?.message ?? "Upload failed");
    router.push(`/projects/${projectId}/imports/${body.result.id}`);
  }

  return (
    <div className="space-y-4 p-3 sm:p-4">
      {canEdit ? (
        <form onSubmit={upload} className="space-y-2 rounded-lg border bg-background p-3">
          <h2 className="text-sm font-semibold">Import a schedule</h2>
          <p className="text-xs text-muted-foreground">Text-based PDF (Primavera-style layouts), CSV, or Excel .xlsx. Extraction runs in the background and changes nothing until you review, commit, and then apply selected changes.</p>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label>
              <span className="block text-muted-foreground">File</span>
              <Input name="file" type="file" accept=".pdf,.csv,.xlsx,application/pdf,text/csv" required className="h-9 w-72" />
            </label>
            <label>
              <span className="block text-muted-foreground">Source lineage</span>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={lineageChoice} onChange={(e) => setLineageChoice(e.target.value)}>
                {lists.lineages
                  .filter((l) => l.kind !== "MANUAL_TABLE")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.versions.length} version{l.versions.length === 1 ? "" : "s"})
                    </option>
                  ))}
                <option value="__new">New lineage…</option>
              </select>
            </label>
            {lineageChoice === "__new" ? (
              <label>
                <span className="block text-muted-foreground">New lineage name</span>
                <Input name="newLineageName" className="h-9 w-56" placeholder="e.g. Gray master schedule" required />
              </label>
            ) : null}
            <label>
              <span className="block text-muted-foreground">Version label</span>
              <Input name="label" className="h-9 w-56" placeholder="2026.10.15 Preliminary" />
            </label>
            <label>
              <span className="block text-muted-foreground">Source date</span>
              <Input name="sourceDate" type="date" className="h-9 w-40" />
            </label>
            <Button type="submit" disabled={uploading}>
              <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload and extract"}
            </Button>
          </div>
        </form>
      ) : null}

      <section className="rounded-lg border bg-background p-3">
        <h2 className="mb-2 text-sm font-semibold">Import sessions</h2>
        {lists.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {lists.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Link href={`/projects/${projectId}/imports/${s.id}`} className="font-medium hover:underline">
                  {s.label}
                </Link>
                <Badge variant="outline">{s.format}</Badge>
                <span className={cn("text-xs font-medium", STATUS_TONE[s.status])}>{s.status.replace("_", " ").toLowerCase()}</span>
                {s.identical ? <Badge variant="secondary">identical to a committed version</Badge> : null}
                <span className="text-xs text-muted-foreground">{formatTimestamp(s.createdAt)}</span>
                <span className="text-xs text-muted-foreground">
                  {Object.entries(s.counts)
                    .filter(([, n]) => n)
                    .map(([k, n]) => `${k.toLowerCase().replace("_", " ")} ${n}`)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-3">
        <h2 className="text-sm font-semibold">Source versions</h2>
        {lists.lineages.map((l) => (
          <div key={l.id} className="text-sm">
            <div className="font-medium">
              {l.name} <span className="text-xs font-normal text-muted-foreground">({l.kind.replace("_", " ").toLowerCase()})</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {l.versions.length === 0 ? <span className="text-xs text-muted-foreground">No committed versions.</span> : null}
              {l.versions.map((v) => (
                <button key={v.id} type="button" onClick={() => setVersionId(v.id)} className={cn("rounded border px-2 py-0.5 text-xs", versionId === v.id ? "border-brand-line bg-brand text-white" : "bg-background")}>
                  v{v.versionNumber} {v.label}
                  {v.dataDate ? ` · data date ${formatDate(v.dataDate)}` : ""}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {versionId ? <VersionPanel key={versionId} versionId={versionId} plan={plan} canEdit={canEdit} /> : <EmptyState title="No source version selected">Commit a reviewed import to compare versions and link installation work.</EmptyState>}
    </div>
  );
}

function VersionPanel({ versionId, plan, canEdit }: { versionId: string; plan: PlanData; canEdit: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<VersionView | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [onlyScope, setOnlyScope] = useState(true);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<SourceRecordView[] | null>(null);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    void rpc("imports.versionRecords", { versionId }).then(setView, (e) => toast.error(e instanceof RpcError ? e.message : "Could not load version"));
  }, [versionId]);
  const records = useMemo(() => {
    if (!view) return [];
    const q = search.toLowerCase();
    return view.records.filter((r) => (!onlyChanged || r.changeKind !== "UNCHANGED") && (!onlyScope || (r.included && r.role === "scope") || r.linkedActivityKeys.length) && (!q || `${r.externalId} ${r.name}`.toLowerCase().includes(q)));
  }, [view, onlyChanged, onlyScope, search]);
  if (!view) return <p className="text-sm text-muted-foreground">Loading version…</p>;
  const acts = new Map(plan.activities.map((a) => [a.key, a]));
  const changedLinked = view.records.filter((r) => r.linkedActivityKeys.length && (r.changeKind === "CHANGED" || r.changeKind === "REMOVED"));

  return (
    <section className="space-y-2 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">
          {view.version.lineageName} v{view.version.versionNumber} “{view.version.label}”
        </h2>
        <span className="text-xs text-muted-foreground">{view.records.filter((r) => r.included).length} reviewed records of {view.records.length} source rows{view.version.comparedToId ? " · compared with the prior version" : ""}</span>
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={onlyScope} onChange={(e) => setOnlyScope(e.target.checked)} /> Our scope and linked rows
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Changes only
          </label>
          <Input aria-label="Search records" className="h-7 w-48" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {changedLinked.length && canEdit ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning">
          {changedLinked.length} changed or removed source row(s) are linked to installation work.
          <Button size="sm" variant="outline" onClick={() => setApplying(true)}>
            Review source changes for the plan
          </Button>
        </div>
      ) : null}
      {canEdit ? (
        <div className="flex gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={!checked.size} onClick={() => setCreating(view.records.filter((r) => checked.has(r.id)))}>
            <Plus className="size-3.5" /> Create installation activities from {checked.size} selected
          </Button>
        </div>
      ) : null}
      <div className="max-h-[55dvh] overflow-auto rounded border">
        <table className="w-full min-w-[60rem] text-xs">
          <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-1 py-1" />
              <th className="px-1">ID</th>
              <th className="px-1">Name</th>
              <th className="px-1">Page</th>
              <th className="px-1">Start</th>
              <th className="px-1">Finish</th>
              <th className="px-1">Role</th>
              <th className="px-1">Change</th>
              <th className="px-1">Linked activities</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 1500).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-1">
                  <input type="checkbox" aria-label={`Select ${r.externalId}`} disabled={r.changeKind === "REMOVED"} checked={checked.has(r.id)} onChange={() => {
                    const n = new Set(checked);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    setChecked(n);
                  }} />
                </td>
                <td className="px-1 font-mono">{r.externalId}</td>
                <td className="px-1">{r.name}</td>
                <td className="px-1">{r.page ?? ""}</td>
                <td className="px-1 tabular">
                  {formatDate(r.start)}
                  {r.startActual ? " A" : ""}
                  {r.startConstrained ? "*" : ""}
                </td>
                <td className="px-1 tabular">
                  {formatDate(r.finish)}
                  {r.finishActual ? " A" : ""}
                  {r.finishConstrained ? "*" : ""}
                </td>
                <td className="px-1">{r.included ? r.role : <span className="text-muted-foreground">not selected</span>}</td>
                <td className={cn("px-1", r.changeKind === "REMOVED" ? "text-destructive" : r.changeKind === "CHANGED" || r.changeKind === "RENAMED" ? "text-warning" : "text-muted-foreground")}>
                  {CHANGE_LABEL[r.changeKind] ?? r.changeKind}
                  {r.changes.length ? <div className="text-[10px]">{r.changes.map((c) => `${c.field}: ${String(c.before ?? "—")} → ${String(c.after ?? "—")}`).join("; ")}</div> : null}
                </td>
                <td className="px-1">{r.linkedActivityKeys.map((k) => acts.get(k)?.code ?? "?").join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.length > 1500 ? <p className="p-2 text-xs text-muted-foreground">Showing the first 1,500; refine the search.</p> : null}
      </div>
      {creating ? <CreateActivitiesDialog plan={plan} versionId={versionId} records={creating} onClose={() => setCreating(null)} onDone={() => { setChecked(new Set()); router.refresh(); void rpc("imports.versionRecords", { versionId }).then(setView); }} /> : null}
      {applying ? <SourceChangesDialog plan={plan} version={view} onClose={() => setApplying(false)} onDone={() => router.refresh()} /> : null}
    </section>
  );
}

function CreateActivitiesDialog({ plan, versionId, records, onClose, onDone }: { plan: PlanData; versionId: string; records: SourceRecordView[]; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState(() =>
    records.map((r) => ({
      externalId: r.externalId,
      sourceName: r.name,
      activities: [{ name: r.name, systemId: r.systemId, phaseId: r.phaseId, areaId: r.areaId, start: r.start ?? r.finish ?? "", finish: r.finish ?? r.start ?? "" }],
    })),
  );
  const [busy, setBusy] = useState(false);
  const sel = "h-7 rounded border bg-background px-1 text-xs";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Create installation activities</DialogTitle>
          <DialogDescription>Each source row can support several installation activities (for example separate fire alarm and VESDA work from one combined row). Activities start with source links and no staffing, so no capacity is duplicated.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={it.externalId} className="space-y-1 rounded border p-2">
              <div className="text-xs font-medium">
                {it.externalId} · {it.sourceName}
              </div>
              {it.activities.map((a, j) => (
                <div key={j} className="flex flex-wrap items-center gap-1">
                  <Input aria-label="Activity name" className="h-7 w-72 text-xs" value={a.name} onChange={(e) => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.map((y, yj) => (yj === j ? { ...y, name: e.target.value } : y)) } : x)))} />
                  <select aria-label="System" className={sel} value={a.systemId ?? ""} onChange={(e) => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.map((y, yj) => (yj === j ? { ...y, systemId: e.target.value || null } : y)) } : x)))}>
                    <option value="">Shared systems</option>
                    {plan.systems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Phase" className={sel} value={a.phaseId ?? ""} onChange={(e) => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.map((y, yj) => (yj === j ? { ...y, phaseId: e.target.value || null } : y)) } : x)))}>
                    <option value="">No phase</option>
                    {plan.phases.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Area" className={sel} value={a.areaId ?? ""} onChange={(e) => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.map((y, yj) => (yj === j ? { ...y, areaId: e.target.value || null } : y)) } : x)))}>
                    <option value="">No area</option>
                    {plan.areas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Input aria-label="Start" type="date" className="h-7 w-36 text-xs" value={a.start} onChange={(e) => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.map((y, yj) => (yj === j ? { ...y, start: e.target.value } : y)) } : x)))} />
                  <Input aria-label="Finish" type="date" className="h-7 w-36 text-xs" value={a.finish} onChange={(e) => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.map((y, yj) => (yj === j ? { ...y, finish: e.target.value } : y)) } : x)))} />
                  {it.activities.length > 1 ? (
                    <button type="button" aria-label="Remove" onClick={() => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: x.activities.filter((_, yj) => yj !== j) } : x)))}>
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              ))}
              <button type="button" className="text-xs underline" onClick={() => setItems(items.map((x, xi) => (xi === i ? { ...x, activities: [...x.activities, { ...x.activities[0], name: `${x.sourceName} (2)` }] } : x)))}>
                + another activity from this source row
              </button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || items.some((it) => it.activities.some((a) => !a.name.trim() || !a.start || !a.finish || a.finish < a.start))}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await rpc("imports.createActivities", { planId: plan.plan.id, expectedRevision: plan.plan.revision, versionId, items: items.map((it) => ({ externalId: it.externalId, activities: it.activities })) });
                toast.success(`Created ${r.created} activities (revision ${r.revision})`);
                onDone();
                onClose();
              } catch (e) {
                toast.error(e instanceof RpcError ? e.message : "Not created");
              } finally {
                setBusy(false);
              }
            }}
          >
            Create activities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceChangesDialog({ plan, version, onClose, onDone }: { plan: PlanData; version: VersionView; onClose: () => void; onDone: () => void }) {
  const [rule, setRule] = useState<SourceRule>("shift-with-source");
  const changes = sourceChangesFromRecords(version.records);
  const proposals = proposeFromSource(plan, changes, rule);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.filter((p) => p.to).map((p) => `${p.externalId}|${p.activityKey}`)));
  const [preview, setPreview] = useState<MoveRequest | null>(null);
  const request = sourceMoveRequest(proposals, selected, rule);
  return (
    <>
      <Dialog open={!preview} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Source changes affecting the working plan</DialogTitle>
            <DialogDescription>Accept or reject each change. The next step previews successors and staffing; crew sizes, actual dates, notes, and mappings are preserved.</DialogDescription>
          </DialogHeader>
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={rule === "shift-with-source"} onChange={() => setRule("shift-with-source")} /> Shift with the source start (keep working duration)
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={rule === "align-to-source"} onChange={() => setRule("align-to-source")} /> Align to the new source window
            </label>
          </fieldset>
          <ul className="space-y-1 text-xs">
            {proposals.map((p) => {
              const k = `${p.externalId}|${p.activityKey}`;
              return (
                <li key={k} className="flex items-start gap-2 rounded border px-2 py-1">
                  <input type="checkbox" aria-label={`Accept ${p.externalId} for ${p.code}`} disabled={!p.to} checked={selected.has(k)} onChange={() => {
                    const n = new Set(selected);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    setSelected(n);
                  }} />
                  <span>
                    <strong>{p.externalId}</strong> → {p.code} {p.name}: {formatDate(p.from.start)}–{formatDate(p.from.finish)}
                    {p.to ? ` → from ${formatDate(p.to.start)}` : ""} · {p.note}
                  </span>
                </li>
              );
            })}
            {proposals.length === 0 ? <li className="text-muted-foreground">No linked activity needs a date change.</li> : null}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!request} onClick={() => setPreview(request)}>
              Preview selected changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {preview ? (
        <MovePreviewDialog
          data={plan}
          request={preview}
          onCancel={() => setPreview(null)}
          onApply={(ops: PlanOp[]) => {
            void rpc("imports.applySourceChanges", { planId: plan.plan.id, expectedRevision: plan.plan.revision, versionId: version.version.id, ops, selected: [...selected] }).then(
              (r) => {
                toast.success(`Applied; working plan revision ${r.revision}`);
                onDone();
                onClose();
              },
              (e) => toast.error(e instanceof RpcError ? e.message : "Not applied"),
            );
            return true;
          }}
        />
      ) : null}
    </>
  );
}
