"use client";

import { Download, FileSpreadsheet, FileText, Loader2, Save, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PlanData } from "@/domain/plan";
import { buildReportDataset, DETAIL_LEVELS, PRESENTATIONS, reportSettingsSchema, type ReportSettings } from "@/domain/report";
import { todayInTimeZone } from "@/domain/tz";
import { formatTimestamp } from "@/lib/format";
import { rpc, RpcError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import { buildPages, ReportDocument } from "@/reporting/document";
import type { listPresets, listReports, listReportSources } from "@/server/services/reports";

type Presets = Awaited<ReturnType<typeof listPresets>>;
type Reports = Awaited<ReturnType<typeof listReports>>;
type Sources = Awaited<ReturnType<typeof listReportSources>>;
type Source = { kind: "plan"; planId: string } | { kind: "snapshot"; snapshotId: string };

interface Props {
  projectId: string;
  canEdit: boolean;
  companyName: string;
  viewerName: string;
  initialPlan: PlanData;
  sourceSummary: { label: string; detail: string }[];
  presets: Presets;
  sources: Sources;
  reports: Reports;
  installerRoles: string[];
}

const ACE_PRESET: Partial<ReportSettings> = { title: "ACE Preliminary Manpower", detail: "PHASE_OVERVIEW", presentation: "COMBINED", formats: ["PDF", "XLSX"] };

function Preview({ ds }: { ds: ReturnType<typeof buildReportDataset> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(0.6);
  const { orientation, pages } = buildPages(ds);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (doc) {
      // Standards mode, matching the generated PDF (quirks mode changes table font inheritance).
      doc.open();
      doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report preview</title></head><body></body></html>');
      doc.close();
      setBody(doc.body);
    }
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setZoom(Math.min(1, (el.clientWidth - 24) / ((orientation === "landscape" ? 11 : 8.5) * 96 + 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation]);
  useEffect(() => {
    if (body) body.style.setProperty("zoom", String(zoom));
  }, [body, zoom]);
  return (
    <div ref={box} className="min-w-0">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Preview · {pages.length} page{pages.length === 1 ? "" : "s"} · Letter {orientation} · same template and data as the generated PDF
        </span>
      </div>
      <iframe ref={frame} title="Report preview" className="h-[75dvh] w-full rounded-md border bg-[#e9e9e6]" sandbox="allow-same-origin" />
      {body ? createPortal(<ReportDocument ds={ds} />, body) : null}
    </div>
  );
}

export function ReportsWorkspace(props: Props) {
  const { projectId, canEdit } = props;
  const [settings, setSettings] = useState<ReportSettings>(() => reportSettingsSchema.parse(props.presets[0]?.settings ?? ACE_PRESET));
  const [presetId, setPresetId] = useState<string | null>(props.presets[0]?.id ?? null);
  const [presets, setPresets] = useState(props.presets);
  const [source, setSource] = useState<Source>({ kind: "plan", planId: props.initialPlan.plan.id });
  const [sourceData, setSourceData] = useState<{ plan: PlanData; snapshotName: string | null; sources: { label: string; detail: string }[] }>({ plan: props.initialPlan, snapshotName: null, sources: props.sourceSummary });
  const [loadingSource, setLoadingSource] = useState(false);
  const [reports, setReports] = useState(props.reports);
  const [generating, setGenerating] = useState(false);
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [savePreset, setSavePreset] = useState<{ name: string; scope: "project" | "workspace" } | null>(null);
  const set = <K extends keyof ReportSettings>(k: K, v: ReportSettings[K]) => setSettings({ ...settings, [k]: v });
  const data = sourceData.plan;

  const ds = useMemo(() => buildReportDataset(data, settings, { companyName: props.companyName, preparedBy: props.viewerName, generatedAt: new Date().toISOString(), snapshotId: null, snapshotName: sourceData.snapshotName, sources: sourceData.sources }), [data, settings, props.companyName, props.viewerName, sourceData]);

  const refresh = useCallback(async () => setReports(await rpc("reports.list", { projectId })), [projectId]);
  const pending = reports.reports.some((r) => r.status === "QUEUED" || r.status === "RENDERING");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [pending, refresh]);

  async function chooseSource(value: string) {
    const [kind, id] = value.split(":");
    setLoadingSource(true);
    try {
      if (kind === "plan") {
        const view = await rpc("plans.view", { projectId, planId: id });
        setSource({ kind: "plan", planId: id });
        setSourceData({ plan: view.data, snapshotName: null, sources: props.sourceSummary });
      } else {
        const snap = await rpc("reports.snapshotData", { snapshotId: id });
        setSource({ kind: "snapshot", snapshotId: id });
        setSourceData({ plan: snap.plan, snapshotName: `Baseline “${snap.name}”`, sources: snap.sources });
      }
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : "Could not load that plan");
    } finally {
      setLoadingSource(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const preset = presets.find((p) => p.id === presetId);
      await rpc("reports.generate", { projectId, source, settings, presetId, presetName: preset?.name ?? null, requestId: crypto.randomUUID() });
      toast.success("Snapshot captured; files are being generated");
      await refresh();
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : "Could not start generation");
    } finally {
      setGenerating(false);
    }
  }

  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const sel = "h-8 w-full rounded-md border bg-background px-2 text-sm";
  const isScenario = data.plan.kind === "SCENARIO";

  return (
    <div className="grid gap-4 p-3 sm:p-4 2xl:grid-cols-[400px_1fr]">
      <div className="space-y-3">
        <section className="space-y-2 rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Preset</h2>
            {canEdit ? (
              <div className="flex gap-1">
                {presetId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const p = presets.find((x) => x.id === presetId)!;
                      try {
                        const r = await rpc("reports.savePreset", { projectId, scope: p.projectId ? "project" : "workspace", id: p.id, name: p.name, settings, expectedRevision: p.revision });
                        setPresets(presets.map((x) => (x.id === p.id ? { ...x, settings, revision: r.revision } : x)));
                        toast.success(`Preset “${p.name}” updated (settings only)`);
                      } catch (e) {
                        toast.error(e instanceof RpcError ? e.message : "Not saved");
                      }
                    }}
                  >
                    <Save className="size-3.5" /> Update
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setSavePreset({ name: settings.title, scope: "project" })}>
                  Save as…
                </Button>
                {presetId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete preset"
                    onClick={async () => {
                      const p = presets.find((x) => x.id === presetId);
                      if (!p || !window.confirm(`Delete preset “${p.name}”? Issued reports are not affected.`)) return;
                      try {
                        await rpc("reports.deletePreset", { projectId, id: p.id });
                        setPresets(presets.filter((x) => x.id !== p.id));
                        setPresetId(null);
                      } catch (e) {
                        toast.error(e instanceof RpcError ? e.message : "Not deleted");
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <select aria-label="Preset" className={sel} value={presetId ?? ""} onChange={(e) => {
            const p = presets.find((x) => x.id === e.target.value);
            setPresetId(p?.id ?? null);
            if (p) setSettings(p.settings);
          }}>
            <option value="">No preset (custom settings)</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.projectId ? "" : " (all projects)"}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">Presets save settings only. Generating always uses the plan you choose below.</p>
        </section>

        <section className="space-y-2 rounded-lg border bg-background p-3">
          <h2 className="text-sm font-semibold">Plan to report</h2>
          <select aria-label="Plan source" className={sel} disabled={loadingSource} value={source.kind === "plan" ? `plan:${source.planId}` : `snap:${source.snapshotId}`} onChange={(e) => void chooseSource(e.target.value)}>
            {props.sources.plans.map((p) => (
              <option key={p.id} value={`plan:${p.id}`}>
                {p.kind === "WORKING" ? `Working plan (current, rev ${p.revision})` : `Scenario: ${p.name} (rev ${p.revision}) — exploratory`}
              </option>
            ))}
            {props.sources.baselines.map((b) => (
              <option key={b.id} value={`snap:${b.id}`}>
                Baseline: {b.name} (rev {b.planRevision})
              </option>
            ))}
          </select>
          {isScenario ? <p className="text-xs text-warning">Scenario exports are exploratory and cannot be recorded as submissions.</p> : null}
          {loadingSource ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
        </section>

        <fieldset disabled={!canEdit} className="space-y-3 rounded-lg border bg-background p-3">
          <legend className="sr-only">Report settings</legend>
          <div className="space-y-1">
            <Label htmlFor="r-title">Title</Label>
            <Input id="r-title" value={settings.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="r-detail">Detail</Label>
              <select id="r-detail" className={sel} value={settings.detail} onChange={(e) => set("detail", e.target.value as ReportSettings["detail"])}>
                {Object.entries(DETAIL_LEVELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-pres">Presentation</Label>
              <select id="r-pres" className={sel} value={settings.presentation} onChange={(e) => set("presentation", e.target.value as ReportSettings["presentation"])}>
                {Object.entries(PRESENTATIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">Formats</span>
              <div className="flex gap-3 text-sm">
                {(["PDF", "XLSX"] as const).map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={settings.formats.includes(f)}
                      onChange={() => {
                        const next = toggleIn(settings.formats, f) as ReportSettings["formats"];
                        if (next.length) set("formats", next);
                      }}
                    />{" "}
                    {f === "PDF" ? "PDF" : "Excel .xlsx"}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-orient">Orientation</Label>
              <select id="r-orient" className={sel} value={settings.orientation} onChange={(e) => set("orientation", e.target.value as ReportSettings["orientation"])}>
                <option value="AUTO">Automatic</option>
                <option value="PORTRAIT">Portrait</option>
                <option value="LANDSCAPE">Landscape</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-from">Period from</Label>
              <Input id="r-from" type="date" value={settings.period.from ?? ""} onChange={(e) => set("period", { ...settings.period, from: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-to">Period to</Label>
              <Input id="r-to" type="date" value={settings.period.to ?? ""} onChange={(e) => set("period", { ...settings.period, to: e.target.value || null })} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="r-measure">Chart measure</Label>
              <select id="r-measure" className={sel} value={settings.measure} onChange={(e) => set("measure", e.target.value as ReportSettings["measure"])}>
                <option value="peak">Peak concurrent onsite headcount</option>
                <option value="hours">Planned labor hours</option>
                <option value="average">Average equivalent staffing</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">Filters</span>
            <FilterChips label="Phases" options={data.phases.map((p) => ({ id: p.id, name: p.name }))} value={settings.filters.phaseIds} onChange={(v) => set("filters", { ...settings.filters, phaseIds: v })} />
            <FilterChips label="Systems" options={data.systems.map((s) => ({ id: s.id, name: s.name }))} value={settings.filters.systemIds} onChange={(v) => set("filters", { ...settings.filters, systemIds: v })} />
            <FilterChips label="Areas" options={data.areas.map((a) => ({ id: a.id, name: a.name }))} value={settings.filters.areaIds} onChange={(v) => set("filters", { ...settings.filters, areaIds: v })} />
            <FilterChips label="Roles" options={[...props.installerRoles.map((r) => ({ id: r, name: r })), { id: "leadership", name: "Leadership" }]} value={settings.filters.roles} onChange={(v) => set("filters", { ...settings.filters, roles: v })} />
            <p className="text-[11px] text-muted-foreground">With no filters, figures are all project labor. Phase, area, or system filters produce a labeled allocation view.</p>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">Contents</span>
            <div className="grid grid-cols-2 gap-1 text-sm">
              {(
                [
                  ["leadershipNames", "Leadership names"],
                  ["milestones", "Milestones"],
                  ["unconfirmedMilestones", "Include candidate milestones"],
                  ["assumptions", "Assumptions and open items"],
                  ["notes", "Activity notes"],
                  ["allocationDetail", "Allocation detail"],
                  ["hours", "Labor hours"],
                  ["averageEquivalent", "Average equivalent staffing"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={settings.contents[k]} onChange={(e) => set("contents", { ...settings.contents, [k]: e.target.checked })} /> {label}
                </label>
              ))}
            </div>
          </div>
          {settings.contents.assumptions ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="r-assume">Planning assumptions</Label>
                <Textarea id="r-assume" rows={3} value={settings.assumptions} onChange={(e) => set("assumptions", e.target.value)} placeholder="e.g. Crew sizes are preliminary and assume continuous access to each area." />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-excl">Exclusions</Label>
                <Textarea id="r-excl" rows={2} value={settings.exclusions} onChange={(e) => set("exclusions", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-confirm">Dates needing confirmation</Label>
                <Textarea id="r-confirm" rows={2} value={settings.datesToConfirm} onChange={(e) => set("datesToConfirm", e.target.value)} />
              </div>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="r-prepared">Prepared by</Label>
            <Input id="r-prepared" value={settings.preparedBy ?? ""} placeholder={props.viewerName} onChange={(e) => set("preparedBy", e.target.value || null)} />
          </div>
        </fieldset>
        {canEdit ? (
          <Button className="w-full" disabled={generating || loadingSource} onClick={generate}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Generate {settings.formats.join(" + ")} from a frozen snapshot
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Your role can download issued reports but not generate new ones.</p>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <Preview ds={ds} />
        <GeneratedList reports={reports} canEdit={canEdit} onSubmit={setSubmitFor} />
      </div>

      {savePreset ? (
        <Dialog open onOpenChange={(o) => !o && setSavePreset(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save preset</DialogTitle>
              <DialogDescription>Saves the presentation settings only, not project values.</DialogDescription>
            </DialogHeader>
            <Input aria-label="Preset name" value={savePreset.name} onChange={(e) => setSavePreset({ ...savePreset, name: e.target.value })} />
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={savePreset.scope === "project"} onChange={() => setSavePreset({ ...savePreset, scope: "project" })} /> This project
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={savePreset.scope === "workspace"} onChange={() => setSavePreset({ ...savePreset, scope: "workspace" })} /> All projects
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSavePreset(null)}>
                Cancel
              </Button>
              <Button
                disabled={!savePreset.name.trim()}
                onClick={async () => {
                  try {
                    const r = await rpc("reports.savePreset", { projectId, scope: savePreset.scope, name: savePreset.name, settings });
                    const list = await rpc("reports.presets", { projectId });
                    setPresets(list);
                    setPresetId(r.id);
                    setSavePreset(null);
                    toast.success("Preset saved");
                  } catch (e) {
                    toast.error(e instanceof RpcError ? e.message : "Not saved");
                  }
                }}
              >
                Save preset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {submitFor ? <SubmissionDialog projectId={projectId} snapshotId={submitFor} reports={reports.reports.filter((r) => r.snapshotId === submitFor && r.status === "READY" && !r.submissionId)} defaultRecipient={data.project.customer ?? ""} timezone={data.project.timezone} onClose={() => setSubmitFor(null)} onDone={refresh} /> : null}
    </div>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="w-14 text-muted-foreground">{label}</span>
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className={cn("rounded border px-1.5 py-0.5", on ? "border-brand bg-brand text-white" : "bg-background")}>
            {on ? "✓ " : ""}
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

function GeneratedList({ reports, canEdit, onSubmit }: { reports: Reports; canEdit: boolean; onSubmit: (snapshotId: string) => void }) {
  const bySnapshot = new Map<string, Reports["reports"]>();
  for (const r of reports.reports) bySnapshot.set(r.snapshotId, [...(bySnapshot.get(r.snapshotId) ?? []), r]);
  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-background p-3">
        <h2 className="mb-2 text-sm font-semibold">Generated files</h2>
        {reports.reports.length === 0 ? (
          <EmptyState title="No generated files yet">Generated files are stored with the exact snapshot, settings, author, and timestamp.</EmptyState>
        ) : (
          <ul className="divide-y text-sm">
            {[...bySnapshot.entries()].map(([snapshotId, files]) => (
              <li key={snapshotId} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{files[0].title}</span>
                  <Badge variant="outline">{files[0].planLabel}</Badge>
                  {files[0].exploratory ? <Badge variant="secondary" className="border-warning/40 bg-warning-bg text-warning">Exploratory scenario</Badge> : null}
                  {files.some((f) => f.submissionId) ? <Badge variant="outline">Submitted</Badge> : null}
                  <span className="text-xs text-muted-foreground">
                    {files[0].authorName} · {formatTimestamp(files[0].createdAt)} · snapshot {snapshotId.slice(0, 8)}
                  </span>
                  {canEdit && !files[0].exploratory && files.every((f) => f.status === "READY") && files.some((f) => !f.submissionId) ? (
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => onSubmit(snapshotId)}>
                      <Send className="size-3.5" /> Record as submission
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {files.map((f) => (
                    <span key={f.id} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
                      {f.format === "PDF" ? <FileText className="size-3.5" aria-hidden /> : <FileSpreadsheet className="size-3.5" aria-hidden />}
                      {f.format}
                      {f.status === "READY" && f.fileId ? (
                        <a className="inline-flex items-center gap-1 underline" href={`/api/files/${f.fileId}`}>
                          <Download className="size-3" /> Download ({Math.round((f.sizeBytes ?? 0) / 1024)} KB)
                        </a>
                      ) : f.status === "FAILED" ? (
                        <span className="text-destructive">Failed: {f.error}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" /> {f.status === "QUEUED" ? (f.job?.message ?? "Queued (start the worker if this does not change)") : `Rendering ${f.job?.progress ?? 0}%`}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-lg border bg-background p-3">
        <h2 className="mb-2 text-sm font-semibold">Recorded submissions</h2>
        {reports.submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions recorded. Recording does not email anyone; send the downloaded files yourself.</p>
        ) : (
          <ul className="divide-y text-sm">
            {reports.submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground">
                  Issued {s.issueDate} to {s.recipientLabel}
                  {s.reference ? ` · ref ${s.reference}` : ""} · plan rev {s.planRevision} · recorded by {s.recordedByName} {formatTimestamp(s.createdAt)} · {s.acknowledgedIssues} item(s) acknowledged
                </span>
                {s.files.map((f) =>
                  f.fileId ? (
                    <a key={f.id} className="inline-flex items-center gap-1 text-xs underline" href={`/api/files/${f.fileId}`}>
                      <Download className="size-3" /> {f.format}
                    </a>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SubmissionDialog({ projectId, snapshotId, reports, defaultRecipient, timezone, onClose, onDone }: { projectId: string; snapshotId: string; reports: Reports["reports"]; defaultRecipient: string; timezone: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [checks, setChecks] = useState<{ blocking: string[]; issues: { id: string; message: string; severity: string }[] } | null>(null);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ issueDate: todayInTimeZone(timezone), recipient: defaultRecipient, reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void rpc("reports.submissionChecks", { projectId, snapshotId }).then(setChecks, (e) => setError(e instanceof RpcError ? e.message : "Could not load planning items"));
  }, [projectId, snapshotId]);
  const allAcked = checks ? checks.issues.every((i) => acked.has(i.id)) : false;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record submission</DialogTitle>
          <DialogDescription>Records the issued files with their frozen snapshot. Later edits cannot change them. The app does not send anything to the recipient.</DialogDescription>
        </DialogHeader>
        <p className="text-sm">Files: {reports.map((r) => r.format).join(", ")}</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="s-date">Issue date</Label>
            <Input id="s-date" type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-to">Recipient</Label>
            <Input id="s-to" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-ref">Reference (optional)</Label>
            <Input id="s-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </div>
        </div>
        {!checks ? <p className="text-sm text-muted-foreground">Checking planning items…</p> : null}
        {checks?.blocking.length ? (
          <FormError message={`Data validation failures block this submission:\n${checks.blocking.join("\n")}`} />
        ) : null}
        {checks && checks.issues.length ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Acknowledge open planning items ({checks.issues.length})</span>
              <button type="button" className="text-xs underline" onClick={() => setAcked(new Set(checks.issues.map((i) => i.id)))}>
                Acknowledge all
              </button>
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded border p-2 text-xs">
              {checks.issues.map((i) => (
                <li key={i.id}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={acked.has(i.id)} onChange={() => {
                      const n = new Set(acked);
                      if (n.has(i.id)) n.delete(i.id);
                      else n.add(i.id);
                      setAcked(n);
                    }} />
                    <span>
                      <span className="font-medium">{i.severity === "warning" ? "⚠" : "ℹ"}</span> {i.message}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">Acknowledgments are stored with the submission. Date uncertainties are planning information, not blockers.</p>
          </div>
        ) : checks ? (
          <p className="text-sm text-success">No open planning items.</p>
        ) : null}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !checks || checks.blocking.length > 0 || !allAcked || !f.recipient.trim() || !f.issueDate}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await rpc("reports.recordSubmission", { projectId, snapshotId, reportIds: reports.map((x) => x.id), issueDate: f.issueDate, recipientLabel: f.recipient, reference: f.reference || null, acknowledgedIssueIds: [...acked] });
                toast.success(`Submission ${r.sequence} recorded`);
                await onDone();
                onClose();
              } catch (e) {
                setError(e instanceof RpcError ? e.message : "Not recorded");
              } finally {
                setBusy(false);
              }
            }}
          >
            Record submission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
