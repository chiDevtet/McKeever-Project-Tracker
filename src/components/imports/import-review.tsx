"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, CheckCircle2, Loader2, RotateCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/domain/dates";
import { rpc, RpcError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import type { getImport, Reviewed } from "@/server/services/imports";

type ImportView = Awaited<ReturnType<typeof getImport>>;
type Row = ImportView["rows"][number];

interface Structure {
  phases: { id: string; name: string }[];
  areas: { id: string; name: string }[];
  systems: { id: string; name: string; sourceAliases: string[] }[];
}

const STATUS_LABEL: Record<string, string> = { UPLOADED: "Uploaded", EXTRACTING: "Extracting", EXTRACTED: "Extracted", NEEDS_REVIEW: "Needs review", VALIDATED: "Validated", COMMITTED: "Committed", CANCELED: "Canceled", FAILED: "Failed" };
const MATCH_LABEL: Record<string, string> = { ADDED: "Added", UNCHANGED: "Unchanged", CHANGED: "Changed", RENAMED: "Renamed", DUPLICATE_ID: "Duplicate ID", UNCERTAIN: "Uncertain match", NO_ID: "No ID", WBS: "WBS" };
const STAGES = ["UPLOADED", "EXTRACTED", "NEEDS_REVIEW", "VALIDATED", "COMMITTED"];

export function ImportReview({ initial, structure, canEdit }: { initial: ImportView; structure: Structure; canEdit: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [rows, setRows] = useState(initial.rows);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState({ search: "", kind: "ACTIVITY_MILESTONE", match: "", included: "", page: "" });
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Latest known session revision (optimistic concurrency token for review edits).
  const rev = useRef(initial.session.revision);
  const s = view.session;
  const editable = canEdit && ["NEEDS_REVIEW", "VALIDATED", "EXTRACTED"].includes(s.status);

  const reload = useCallback(async () => {
    const v = await rpc("imports.get", { sessionId: s.id });
    rev.current = v.session.revision;
    setView(v);
    setRows(v.rows);
    return v;
  }, [s.id]);

  // Poll while the worker is extracting.
  useEffect(() => {
    if (s.status !== "EXTRACTING" && s.status !== "UPLOADED") return;
    if (s.status === "UPLOADED" && s.format !== "PDF") return;
    const t = setInterval(() => void reload().catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [s.status, s.format, reload]);

  const visible = useMemo(() => {
    const q = filter.search.toLowerCase();
    const terms = q.split("|").map((t) => t.trim()).filter(Boolean);
    return rows.filter(
      (r) =>
        (filter.kind === "" || (filter.kind === "ACTIVITY_MILESTONE" ? r.kind !== "WBS" : r.kind === filter.kind)) &&
        (!filter.match || r.matchStatus === filter.match) &&
        (!filter.included || (filter.included === "yes" ? r.include : !r.include)) &&
        (!filter.page || String(r.page) === filter.page) &&
        (!terms.length || terms.some((t) => `${r.externalId ?? ""} ${r.reviewed.name} ${r.wbsPath.join(" ")}`.toLowerCase().includes(t))),
    );
  }, [rows, filter]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const previewPage = selected?.page ?? visible[0]?.page ?? 1;

  async function save(changes: { rowId: string; include?: boolean; reviewed?: Partial<Reviewed>; phaseId?: string | null; areaId?: string | null; systemId?: string | null }[]) {
    if (!changes.length) return;
    const prev = rows;
    setRows(rows.map((r) => {
      const c = changes.find((x) => x.rowId === r.id);
      if (!c) return r;
      return { ...r, include: c.include ?? r.include, reviewed: { ...r.reviewed, ...(c.reviewed ?? {}) }, phaseId: c.phaseId === undefined ? r.phaseId : c.phaseId, areaId: c.areaId === undefined ? r.areaId : c.areaId, systemId: c.systemId === undefined ? r.systemId : c.systemId };
    }));
    setSaving("saving");
    try {
      for (let i = 0; i < changes.length; i += 2000) {
        const res = await rpc("imports.updateRows", { sessionId: s.id, expectedRevision: rev.current, changes: changes.slice(i, i + 2000) });
        rev.current = res.revision;
      }
      setView((v) => ({ ...v, session: { ...v.session, status: "NEEDS_REVIEW", revision: rev.current } }));
      setSaving("saved");
    } catch (e) {
      setRows(prev);
      setSaving("failed");
      toast.error(e instanceof RpcError ? e.message : "Review edit not saved");
      if (e instanceof RpcError && (e.details as { stale?: boolean })?.stale) await reload();
    }
  }

  const bulk = (patch: Omit<Parameters<typeof save>[0][number], "rowId">) => save(visible.filter((r) => r.kind !== "WBS").map((r) => ({ rowId: r.id, ...patch })));

  async function act(name: "validate" | "commit" | "cancel" | "retry") {
    setBusy(true);
    try {
      if (name === "validate") {
        const r = await rpc("imports.validate", { sessionId: s.id, expectedRevision: rev.current });
        setProblems(r.problems.map((p) => p.message));
        if (r.valid) toast.success("Validated. Review the summary and commit.");
      } else if (name === "commit") {
        const r = await rpc("imports.commit", { sessionId: s.id, expectedRevision: rev.current });
        toast.success(`Committed as source version ${r.versionNumber}. The working plan is unchanged until you apply selected changes.`);
      } else if (name === "cancel") {
        if (!window.confirm("Cancel this import? Nothing in the plan changes.")) return;
        await rpc("imports.cancel", { sessionId: s.id });
      } else await rpc("imports.retry", { sessionId: s.id });
      await reload();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = (s.meta.counts ?? {}) as Record<string, number>;
  const pagesWithRows = [...new Set(rows.map((r) => r.page).filter(Boolean))] as number[];

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${s.projectId}/imports`} className="text-sm underline">
          ← Imports
        </Link>
        <h2 className="text-base font-semibold">{s.label}</h2>
        <Badge variant="outline">{view.lineage.name}</Badge>
        <Badge variant="secondary">{s.format}</Badge>
        {view.compareTo ? <span className="text-xs text-muted-foreground">compared with v{view.compareTo.versionNumber} “{view.compareTo.label}”</span> : <span className="text-xs text-muted-foreground">first version of this lineage</span>}
        <a className="ml-auto text-xs underline" href={`/api/files/${s.fileId}`}>
          Download original file
        </a>
      </div>

      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Import stages">
        {STAGES.map((st, i) => {
          const reached = STAGES.indexOf(s.status === "EXTRACTING" ? "UPLOADED" : s.status) >= i || (s.status === "NEEDS_REVIEW" && i <= 2);
          return (
            <li key={st} className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5", reached ? "border-brand bg-brand/10 text-foreground" : "text-muted-foreground")}>
              {reached ? <CheckCircle2 className="size-3" aria-hidden /> : <span className="size-3 rounded-full border" aria-hidden />}
              {STATUS_LABEL[st]}
            </li>
          );
        })}
        <li className="ml-2 font-medium">
          Current: {STATUS_LABEL[s.status]}
          {s.status === "CANCELED" || s.status === "FAILED" ? <XCircle className="ml-1 inline size-3.5 text-destructive" aria-hidden /> : null}
        </li>
      </ol>

      {view.identicalTo ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4" aria-hidden /> This file is byte-for-byte identical to version {view.identicalTo.versionNumber} “{view.identicalTo.label}”. Re-importing it would add nothing; cancel this import.
        </div>
      ) : null}

      {s.status === "EXTRACTING" || (s.status === "UPLOADED" && s.format === "PDF") ? (
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {view.job?.message ?? "Waiting for the worker"} · {view.job?.progress ?? 0}%{view.job?.status === "QUEUED" ? " · if this does not start, check that the worker is running (pnpm worker)" : ""}
        </div>
      ) : null}

      {s.issues.length ? (
        <details open={s.status === "FAILED"} className="rounded-md border bg-background px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            Extraction issues ({s.issues.length}) — shown, never hidden behind success
          </summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {s.issues.map((i, k) => (
              <li key={k} className={i.severity === "error" ? "text-destructive" : "text-warning"}>
                {i.severity === "error" ? "✕" : "⚠"} {i.message}
              </li>
            ))}
          </ul>
          {s.status === "FAILED" ? (
            <p className="mt-2 text-xs">
              Supported fallbacks: upload a CSV or Excel export of the schedule from the Imports page, or add installation activities manually on the{" "}
              <Link className="underline" href={`/projects/${s.projectId}/schedule`}>
                Schedule
              </Link>{" "}
              tab. Current activities and staffing are unchanged.
            </p>
          ) : null}
        </details>
      ) : null}

      {s.format !== "PDF" && (s.status === "UPLOADED" || s.status === "FAILED" || s.status === "NEEDS_REVIEW") && canEdit ? <ColumnMapping sessionId={s.id} current={s.columnMapping} onDone={reload} /> : null}

      {rows.length ? (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-2 text-xs">
            <label>
              <span className="block text-muted-foreground">Search (use | for any of several terms)</span>
              <Input className="h-8 w-72" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Fire Alarm | VESDA | ERRS | ERRC" />
            </label>
            <label>
              <span className="block text-muted-foreground">Rows</span>
              <select className="h-8 rounded border bg-background px-1" value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
                <option value="ACTIVITY_MILESTONE">Activities and milestones</option>
                <option value="ACTIVITY">Activities</option>
                <option value="MILESTONE">Milestones</option>
                <option value="WBS">WBS summaries</option>
                <option value="">All rows</option>
              </select>
            </label>
            <label>
              <span className="block text-muted-foreground">Comparison</span>
              <select className="h-8 rounded border bg-background px-1" value={filter.match} onChange={(e) => setFilter({ ...filter, match: e.target.value })}>
                <option value="">All</option>
                {Object.entries(MATCH_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v} {counts[k] ? `(${counts[k]})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-muted-foreground">Included</span>
              <select className="h-8 rounded border bg-background px-1" value={filter.included} onChange={(e) => setFilter({ ...filter, included: e.target.value })}>
                <option value="">All</option>
                <option value="yes">Included</option>
                <option value="no">Not included</option>
              </select>
            </label>
            <label>
              <span className="block text-muted-foreground">Page</span>
              <select className="h-8 rounded border bg-background px-1" value={filter.page} onChange={(e) => setFilter({ ...filter, page: e.target.value })}>
                <option value="">All</option>
                {pagesWithRows.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <span className="self-center text-muted-foreground">
              {visible.length} shown · {rows.filter((r) => r.include).length} included · removed since prior: {counts.removed ?? 0}
            </span>
            <span className="ml-auto self-center" role="status">
              {saving === "saving" ? "Saving…" : saving === "saved" ? "✓ Saved" : saving === "failed" ? "✕ Not saved" : ""}
            </span>
          </div>
          {editable ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" role="toolbar" aria-label="Bulk review actions">
              <span className="font-medium">Shown rows:</span>
              <Button size="sm" variant="outline" onClick={() => bulk({ include: true, reviewed: { role: "scope" } })}>
                Include as our scope
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulk({ include: true, reviewed: { role: "prerequisite" } })}>
                Include as external prerequisite
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulk({ include: true, reviewed: { role: "reference" } })}>
                Include as reference
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulk({ include: false })}>
                Exclude
              </Button>
              <MapSelect label="Phase" options={structure.phases} onPick={(id) => bulk({ phaseId: id })} />
              <MapSelect label="Area" options={structure.areas} onPick={(id) => bulk({ areaId: id })} />
              <MapSelect label="System" options={structure.systems} onPick={(id) => bulk({ systemId: id })} />
            </div>
          ) : null}
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
            <ReviewGrid rows={visible} structure={structure} selectedId={selectedId} onSelect={setSelectedId} editable={editable} onSave={save} sessionId={s.id} revision={s.revision} onResolved={reload} />
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Source preview · page {previewPage} of {String(s.meta.pageCount ?? "?")}
                {selected ? ` · ${selected.externalId ?? "row"} on page ${selected.page}` : ""}
              </div>
              {s.format === "PDF" ? <PagePreview session={s} page={previewPage} highlight={selected && selected.page === previewPage ? selected.original.top ?? null : null} /> : <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">Spreadsheet source: rows show their original spreadsheet row number.</p>}
              {selected ? <RowDetail row={selected} /> : null}
            </div>
          </div>
        </>
      ) : null}

      {problems.length ? <FormError message={`Fix before committing:\n${problems.slice(0, 20).join("\n")}${problems.length > 20 ? `\n…and ${problems.length - 20} more` : ""}`} /> : null}

      {canEdit && s.status !== "COMMITTED" && s.status !== "CANCELED" ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-canvas py-2">
          {editable ? (
            <Button variant="outline" disabled={busy} onClick={() => act("validate")}>
              Validate
            </Button>
          ) : null}
          {s.status === "VALIDATED" ? (
            <Button disabled={busy} onClick={() => act("commit")}>
              Commit source version
            </Button>
          ) : null}
          {s.status === "FAILED" || (s.status === "NEEDS_REVIEW" && s.format === "PDF") ? (
            <Button variant="outline" disabled={busy} onClick={() => act("retry")}>
              <RotateCw className="size-3.5" /> Re-extract
            </Button>
          ) : null}
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => act("cancel")}>
            Cancel import
          </Button>
          <span className="text-xs text-muted-foreground">Committing records a source version only. The working plan changes later, through a reviewed preview of selected changes.</span>
        </div>
      ) : s.status === "COMMITTED" ? (
        <div className="rounded-md border bg-background px-3 py-2 text-sm">
          Committed. Review changes and create or update installation work from the{" "}
          <Link className="underline" href={`/projects/${s.projectId}/imports?lineage=${view.lineage.id}`}>
            source versions
          </Link>{" "}
          view.
        </div>
      ) : null}
    </div>
  );
}

function MapSelect({ label, options, onPick }: { label: string; options: { id: string; name: string }[]; onPick: (id: string | null) => void }) {
  return (
    <select
      aria-label={`Map shown rows to ${label}`}
      className="h-8 rounded border bg-background px-1"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value === "__none" ? null : e.target.value);
      }}
    >
      <option value="">Map {label.toLowerCase()}…</option>
      <option value="__none">Clear {label.toLowerCase()}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function RowDetail({ row }: { row: Row }) {
  const o = row.original;
  const d = row.matchDetail as { changes?: { field: string; before: unknown; after: unknown }[]; prior?: { name: string; start: string | null; finish: string | null } | null; candidates?: string[] };
  return (
    <div className="space-y-1 rounded-md border bg-background p-3 text-xs">
      <div className="font-medium">
        {row.externalId ?? "(no ID)"} · {MATCH_LABEL[row.matchStatus] ?? row.matchStatus}
      </div>
      <div>Original name: {o.name}</div>
      <div>
        Original Start: {o.start?.raw ?? "—"}
        {o.start?.actual ? " (actual)" : ""}
        {o.start?.constraint ? " (constraint *)" : ""} · Finish: {o.finish?.raw ?? "—"}
        {o.finish?.actual ? " (actual)" : ""}
        {o.finish?.constraint ? " (constraint *)" : ""} · OD {o.od ?? "—"} · RD {o.rd ?? "—"}
      </div>
      {o.embeddedDates?.length ? <div className="text-muted-foreground">Dates inside the name (not used as Start/Finish): {o.embeddedDates.map((x) => formatDate(x)).join(", ")}</div> : null}
      <div className="text-muted-foreground">WBS: {row.wbsPath.join(" › ") || "—"}</div>
      {d.changes?.length ? (
        <div>
          Changes since prior version:{" "}
          {d.changes.map((c) => `${c.field} ${String(c.before ?? "—")} → ${String(c.after ?? "—")}`).join("; ")}
        </div>
      ) : null}
      {d.candidates?.length ? <div className="text-warning">Possible renumbering of removed ID(s): {d.candidates.join(", ")}</div> : null}
      <div className="text-muted-foreground">Printed durations are source data only; they are never used as crew sizes or labor hours.</div>
    </div>
  );
}

/**
 * Rendered page image with the selected row highlighted. Falls back to the
 * browser's PDF viewer when previews were not rendered (older sessions or a
 * renderer failure).
 */
function PagePreview({ session, page, highlight }: { session: ImportView["session"]; page: number; highlight: number | null }) {
  const meta = session.meta as { previews?: { pages: number } | null; pages?: { number: number; width?: number; height?: number }[] };
  const info = meta.pages?.find((p) => p.number === page);
  const pdfHref = `/api/files/${session.fileId}?inline=1#page=${page}&view=FitH`;
  if (!meta.previews || page > meta.previews.pages) return <iframe key={page} title={`Source page ${page}`} src={pdfHref} className="h-[70dvh] w-full rounded-md border bg-white" />;
  const height = info?.height ?? 0;
  return (
    <div className="space-y-1">
      <div className="relative overflow-hidden rounded-md border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, access-checked image */}
        <img src={`/api/imports/${session.id}/pages/${page}`} alt={`Source schedule page ${page}`} className="block h-auto w-full" />
        {highlight !== null && height ? <div aria-hidden className="pointer-events-none absolute inset-x-0 border-y-2 border-brand bg-brand/15" style={{ top: `${((highlight - 5) / height) * 100}%`, height: `${(20 / height) * 100}%` }} /> : null}
      </div>
      <a className="text-xs underline" href={pdfHref} target="_blank" rel="noreferrer">
        Open page {page} of the original PDF
      </a>
    </div>
  );
}

function ReviewGrid({ rows, structure, selectedId, onSelect, editable, onSave, sessionId, revision, onResolved }: { rows: Row[]; structure: Structure; selectedId: string | null; onSelect: (id: string) => void; editable: boolean; onSave: (c: { rowId: string; include?: boolean; reviewed?: Partial<Reviewed>; phaseId?: string | null; areaId?: string | null; systemId?: string | null }[]) => Promise<void>; sessionId: string; revision: number; onResolved: () => Promise<unknown> }) {
  const parent = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table/Virtual return unmemoizable functions; React Compiler skips this component by design.
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 34, overscan: 12 });
  const cols = "grid grid-cols-[28px_70px_34px_96px_minmax(180px,1fr)_96px_96px_40px_84px_100px_100px_100px] items-center gap-1";
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <div className="min-w-[1080px]">
        <div className={cn(cols, "border-b bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground")} role="row">
          <span role="columnheader">In</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Pg</span>
          <span role="columnheader">Activity ID</span>
          <span role="columnheader">Name (reviewed)</span>
          <span role="columnheader">Start</span>
          <span role="columnheader">Finish</span>
          <span role="columnheader">OD</span>
          <span role="columnheader">Match</span>
          <span role="columnheader">Phase</span>
          <span role="columnheader">Area</span>
          <span role="columnheader">System</span>
        </div>
        <div ref={parent} className="h-[62dvh] overflow-y-auto" role="rowgroup">
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index];
              const rv = r.reviewed;
              const wbs = r.kind === "WBS";
              const markers = [r.original.start?.actual || r.original.finish?.actual ? "A" : "", r.original.start?.constraint || r.original.finish?.constraint ? "*" : ""].join("");
              return (
                <div key={r.id} role="row" aria-selected={selectedId === r.id} className={cn(cols, "absolute inset-x-0 border-b px-2 text-xs", selectedId === r.id && "bg-accent", wbs && "bg-muted/40 font-semibold", r.matchStatus === "DUPLICATE_ID" && "bg-destructive/5")} style={{ top: vi.start, height: 34 }} onClick={() => onSelect(r.id)}>
                  <input type="checkbox" aria-label={`Include ${r.externalId ?? r.reviewed.name}`} disabled={!editable || wbs} checked={r.include} onChange={(e) => void onSave([{ rowId: r.id, include: e.target.checked, reviewed: e.target.checked && rv.role === "reference" && !r.include ? { role: "scope" } : undefined }])} />
                  <select aria-label="Role" disabled={!editable || wbs} className="h-6 rounded border bg-background text-[11px]" value={rv.role} onChange={(e) => void onSave([{ rowId: r.id, include: true, reviewed: { role: e.target.value as Reviewed["role"] } }])}>
                    <option value="scope">Scope</option>
                    <option value="prerequisite">Prereq.</option>
                    <option value="reference">Ref.</option>
                  </select>
                  <span className="tabular text-muted-foreground">{r.page ?? ""}</span>
                  <span className="truncate font-mono text-[11px]" title={r.externalId ?? ""}>
                    {r.externalId ?? (wbs ? "" : "—")}
                  </span>
                  <EditableText disabled={!editable || wbs} value={rv.name} title={`${r.wbsPath.join(" › ")}\n${rv.name}`} onCommit={(name) => onSave([{ rowId: r.id, reviewed: { name } }])} />
                  <EditableDate disabled={!editable || wbs} value={rv.start} original={r.original.start?.date ?? null} onCommit={(start) => onSave([{ rowId: r.id, reviewed: { start } }])} />
                  <EditableDate disabled={!editable || wbs} value={rv.finish} original={r.original.finish?.date ?? null} onCommit={(finish) => onSave([{ rowId: r.id, reviewed: { finish } }])} />
                  <span className="tabular">
                    {r.original.od ?? ""}
                    {markers ? <sup className="ml-0.5 text-[9px]">{markers}</sup> : null}
                  </span>
                  <span className={cn("truncate", r.matchStatus === "DUPLICATE_ID" || r.matchStatus === "UNCERTAIN" ? "font-medium text-destructive" : r.matchStatus === "CHANGED" || r.matchStatus === "RENAMED" ? "text-warning" : "text-muted-foreground")}>
                    {MATCH_LABEL[r.matchStatus] ?? r.matchStatus}
                    {r.matchStatus === "UNCERTAIN" && editable ? <UncertainResolver row={r} sessionId={sessionId} revision={revision} onResolved={onResolved} /> : null}
                  </span>
                  {(["phaseId", "areaId", "systemId"] as const).map((k) => {
                    const opts = k === "phaseId" ? structure.phases : k === "areaId" ? structure.areas : structure.systems;
                    return (
                      <select key={k} aria-label={k.replace("Id", "")} disabled={!editable || wbs} className="h-6 w-full truncate rounded border bg-background text-[11px]" value={r[k] ?? ""} onChange={(e) => void onSave([{ rowId: r.id, [k]: e.target.value || null }])}>
                        <option value="">—</option>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableText({ value, disabled, title, onCommit }: { value: string; disabled: boolean; title: string; onCommit: (v: string) => void }) {
  const [t, setT] = useState(value);
  return <input aria-label="Reviewed name" disabled={disabled} title={title} className="h-6 w-full truncate rounded border border-transparent bg-transparent px-1 hover:border-border focus:border-brand disabled:hover:border-transparent" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t.trim() && t !== value && onCommit(t.trim())} />;
}

function EditableDate({ value, original, disabled, onCommit }: { value: string | null; original: string | null; disabled: boolean; onCommit: (v: string | null) => void }) {
  return <input aria-label="Reviewed date" type="date" disabled={disabled} className={cn("h-6 w-full rounded border bg-transparent px-0.5 text-[11px]", value !== original && "border-warning bg-warning-bg")} value={value ?? ""} title={value !== original ? `Corrected from ${original ?? "blank"}` : undefined} onChange={(e) => onCommit(e.target.value || null)} />;
}

function UncertainResolver({ row, sessionId, revision, onResolved }: { row: Row; sessionId: string; revision: number; onResolved: () => Promise<unknown> }) {
  const candidates = ((row.matchDetail as { candidates?: string[] }).candidates ?? []) as string[];
  return (
    <select
      aria-label="Resolve uncertain match"
      className="ml-1 h-5 rounded border text-[10px]"
      value={(row.reviewed.sameAs as string | null) ?? ((row.matchDetail as { resolvedNew?: boolean }).resolvedNew ? "__new" : "")}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        try {
          await rpc("imports.resolveUncertain", { sessionId, rowId: row.id, expectedRevision: revision, sameAs: e.target.value === "__new" ? null : e.target.value });
          await onResolved();
        } catch (err) {
          toast.error(err instanceof RpcError ? err.message : "Not resolved");
        }
      }}
    >
      <option value="">Resolve…</option>
      <option value="__new">Treat as new</option>
      {candidates.map((c) => (
        <option key={c} value={c}>
          Same as {c}
        </option>
      ))}
    </select>
  );
}

const HEADER_GUESSES: Record<string, RegExp> = {
  externalId: /^(activity|task)?\s*id$/i,
  name: /^(activity|task)?\s*(name|description)$/i,
  start: /^(early\s*)?start(\s*date)?$/i,
  finish: /^(early\s*)?finish(\s*date)?$|^end(\s*date)?$/i,
  originalDuration: /^(od|orig(inal)?\s*dur(ation)?|duration)$/i,
  remainingDuration: /^(rd|rem(aining)?\s*dur(ation)?)$/i,
  wbs: /^wbs(\s*(path|code|name))?$/i,
};

function guessColumns(header: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, re] of Object.entries(HEADER_GUESSES)) {
    const i = header.findIndex((h) => re.test(h.trim()));
    out[k] = i >= 0 ? i + 1 : null;
  }
  return out;
}

function ColumnMapping({ sessionId, current, onDone }: { sessionId: string; current: unknown; onDone: () => Promise<unknown> }) {
  const [preview, setPreview] = useState<{ sheets: string[]; rows: string[][] } | null>(null);
  const cur = (current ?? {}) as { sheet?: string | null; headerRow?: number; dateFormat?: string; columns?: Record<string, number | null> };
  const [m, setM] = useState({ sheet: cur.sheet ?? null, headerRow: cur.headerRow ?? 1, dateFormat: cur.dateFormat ?? "auto", columns: { externalId: null, name: null, start: null, finish: null, originalDuration: null, remainingDuration: null, wbs: null, ...(cur.columns ?? {}) } as Record<string, number | null> });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void rpc("imports.sheetPreview", { sessionId, sheet: m.sheet }).then(
      (p) => {
        setPreview(p);
        // Suggest columns from common header names when nothing is mapped yet.
        setM((prev) => (Object.values(prev.columns).some((c) => c !== null) ? prev : { ...prev, columns: guessColumns(p.rows[prev.headerRow - 1] ?? []) }));
      },
      (e) => setError(e instanceof RpcError ? e.message : "Could not read the file"),
    );
  }, [sessionId, m.sheet]);
  const header = preview?.rows[m.headerRow - 1] ?? [];
  const fields: [string, string][] = [
    ["externalId", "Activity ID"],
    ["name", "Activity name *"],
    ["start", "Start"],
    ["finish", "Finish"],
    ["originalDuration", "Original duration"],
    ["remainingDuration", "Remaining duration"],
    ["wbs", "WBS / grouping"],
  ];
  return (
    <section className="space-y-2 rounded-lg border bg-background p-3 text-sm">
      <h3 className="font-semibold">Map spreadsheet columns</h3>
      <div className="flex flex-wrap gap-2 text-xs">
        {preview && preview.sheets.length > 1 ? (
          <label>
            Sheet{" "}
            <select className="h-8 rounded border bg-background px-1" value={m.sheet ?? preview.sheets[0]} onChange={(e) => setM({ ...m, sheet: e.target.value })}>
              {preview.sheets.map((sh) => (
                <option key={sh}>{sh}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Header row <Input className="inline-block h-8 w-16" inputMode="numeric" value={m.headerRow} onChange={(e) => setM({ ...m, headerRow: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label>
          Text dates are{" "}
          <select className="h-8 rounded border bg-background px-1" value={m.dateFormat} onChange={(e) => setM({ ...m, dateFormat: e.target.value })}>
            <option value="auto">Auto (ISO, 01-Jun-27, or US M/D/YYYY)</option>
            <option value="ISO">YYYY-MM-DD</option>
            <option value="MDY">M/D/YYYY</option>
            <option value="DMY">D/M/YYYY</option>
            <option value="DMonYY">DD-Mon-YY</option>
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {fields.map(([k, label]) => (
          <label key={k} className="text-xs">
            <span className="block text-muted-foreground">{label}</span>
            <select className="h-8 w-full rounded border bg-background px-1" value={m.columns[k] ?? ""} onChange={(e) => setM({ ...m, columns: { ...m.columns, [k]: e.target.value ? Number(e.target.value) : null } })}>
              <option value="">— not mapped —</option>
              {header.map((h, i) => (
                <option key={i} value={i + 1}>
                  {String.fromCharCode(65 + (i % 26))}: {h || `(column ${i + 1})`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {preview ? (
        <div className="max-h-56 overflow-auto rounded border text-[11px]">
          <table className="w-full">
            <tbody>
              {preview.rows.slice(0, 12).map((r, i) => (
                <tr key={i} className={cn("border-b", i === m.headerRow - 1 && "bg-muted font-semibold")}>
                  <td className="px-1 text-muted-foreground">{i + 1}</td>
                  {r.slice(0, 12).map((c, j) => (
                    <td key={j} className="max-w-[12rem] truncate px-1">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <FormError message={error} />
      <Button
        size="sm"
        disabled={!m.columns.name}
        onClick={async () => {
          try {
            await rpc("imports.setMapping", { sessionId, mapping: { sheet: m.sheet, headerRow: m.headerRow, dateFormat: m.dateFormat as "auto", columns: { externalId: m.columns.externalId, name: m.columns.name!, start: m.columns.start, finish: m.columns.finish, originalDuration: m.columns.originalDuration, remainingDuration: m.columns.remainingDuration, wbs: m.columns.wbs } } });
            toast.success("Mapping saved; extracting rows");
            await onDone();
          } catch (e) {
            setError(e instanceof RpcError ? e.message : "Mapping not saved");
          }
        }}
      >
        Extract rows with this mapping
      </Button>
    </section>
  );
}
