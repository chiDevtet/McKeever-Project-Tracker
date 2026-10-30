"use client";

import { FileText, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { usePlanEditor } from "@/components/plan/use-plan-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/domain/dates";
import { rpc, RpcError } from "@/lib/rpc-client";
import { STATUS_LABELS } from "@/lib/format";
import type { getSetup } from "@/server/services/structure";
import type { PlanView } from "@/server/services/plans";
import { CalendarEditor } from "./calendar-editor";

type Setup = Awaited<ReturnType<typeof getSetup>>;

const AREA_KINDS = ["BUILDING", "ROMP", "DATA_HALL", "ROOM", "ZONE", "OTHER"] as const;
const AREA_LABEL: Record<string, string> = { BUILDING: "Building", ROMP: "ROMP", DATA_HALL: "Data hall", ROOM: "Room", ZONE: "Zone", OTHER: "Other" };
const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";

function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      router.refresh();
      return r;
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : "The change was not saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy };
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3 rounded-lg border bg-background p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SetupWorkspace({ setup, view, canEdit }: { setup: Setup; view: PlanView; canEdit: boolean }) {
  const editor = usePlanEditor(view.data, view.canEdit);
  const projectId = setup.project.id;
  return (
    <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Setup sections" className="hidden lg:block">
        <ul className="sticky top-4 space-y-1 text-sm">
          {[
            ["details", "Project details"],
            ["systems", "Systems"],
            ["phases", "Phases and ROMPs"],
            ["areas", "Areas"],
            ["milestones", "Milestones"],
            ["calendar", "Calendars"],
            ["contacts", "Contacts"],
            ["documents", "Documents"],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-4">
        <ProjectDetails setup={setup} canEdit={canEdit} />
        <Systems setup={setup} canEdit={canEdit} />
        <Phases setup={setup} canEdit={canEdit} editor={editor} />
        <Areas setup={setup} canEdit={canEdit} />
        <Milestones setup={setup} canEdit={canEdit} />
        <Section id="calendar" title="Calendars" description="Default: Monday–Friday, eight working hours, Monday-start weeks, America/New_York. Calendars belong to the selected plan, so scenarios can change their own assumptions.">
          <CalendarEditor editor={editor} plans={view.plans} />
        </Section>
        <Contacts setup={setup} canEdit={canEdit} projectId={projectId} />
        <Documents setup={setup} canEdit={canEdit} projectId={projectId} />
      </div>
    </div>
  );
}

function ProjectDetails({ setup, canEdit }: { setup: Setup; canEdit: boolean }) {
  const { run, busy } = useMutation();
  const p = setup.project;
  const [f, setF] = useState({ name: p.name, status: p.status, description: p.description ?? "", customer: p.parties.CUSTOMER ?? "", generalContractor: p.parties.GENERAL_CONTRACTOR ?? "", owner: p.parties.OWNER ?? "" });
  return (
    <Section id="details" title="Project details" description="Customer, general contractor, and owner are organizations; contacts never create app accounts.">
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pd-name">Name</Label>
          <Input id="pd-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pd-status">Status</Label>
          <select id="pd-status" className={`${selectCls} h-9 w-full`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Code · timezone</Label>
          <div className="flex h-9 items-center text-sm text-muted-foreground">
            {p.code} · {p.timezone}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pd-cust">Customer (contracting)</Label>
          <Input id="pd-cust" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pd-gc">General contractor</Label>
          <Input id="pd-gc" value={f.generalContractor} onChange={(e) => setF({ ...f, generalContractor: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pd-owner">Owner</Label>
          <Input id="pd-owner" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
        </div>
        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor="pd-desc">Description and scope notes</Label>
          <Textarea id="pd-desc" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
      </fieldset>
      {canEdit ? (
        <Button size="sm" disabled={busy} onClick={() => run(() => rpc("projects.update", { projectId: p.id, name: f.name, status: f.status, description: f.description || null, customer: f.customer || null, generalContractor: f.generalContractor || null, owner: f.owner || null }), "Project saved")}>
          Save project details
        </Button>
      ) : null}
    </Section>
  );
}

function Systems({ setup, canEdit }: { setup: Setup; canEdit: boolean }) {
  const { run, busy } = useMutation();
  const [name, setName] = useState("");
  return (
    <Section id="systems" title="Systems" description="Systems are project configuration. Source aliases (for example ERRS and ERRC) are kept for import review and do not create separate systems.">
      <ul className="space-y-1">
        {setup.systems.map((s) => (
          <SystemRow key={s.id} projectId={setup.project.id} system={s} canEdit={canEdit} />
        ))}
      </ul>
      {canEdit ? (
        <div className="flex gap-2">
          <Input aria-label="New system name" className="h-8 max-w-xs" placeholder="New system" value={name} onChange={(e) => setName(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !name.trim()}
            onClick={async () => {
              const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "system";
              if (await run(() => rpc("setup.saveSystem", { projectId: setup.project.id, key, name }), "System added")) setName("");
            }}
          >
            <Plus className="size-3.5" /> Add system
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function SystemRow({ projectId, system, canEdit }: { projectId: string; system: Setup["systems"][number]; canEdit: boolean }) {
  const { run, busy } = useMutation();
  const [name, setName] = useState(system.name);
  const [aliases, setAliases] = useState(system.sourceAliases.join(", "));
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-sm">
      <Input aria-label="System name" disabled={!canEdit} className="h-8 w-56" value={name} onChange={(e) => setName(e.target.value)} />
      <Input aria-label="Source aliases" disabled={!canEdit} className="h-8 w-48" placeholder="Source aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      <span className="text-xs text-muted-foreground">key {system.key}</span>
      {system.archived ? <Badge variant="secondary">Archived</Badge> : null}
      {canEdit ? (
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => rpc("setup.saveSystem", { projectId, id: system.id, name, sourceAliases: aliases.split(",").map((a) => a.trim()).filter(Boolean) }), "System saved")}>
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => rpc("setup.saveSystem", { projectId, id: system.id, name, sourceAliases: system.sourceAliases, archived: !system.archived }))}>
            {system.archived ? "Restore" : "Archive"}
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function Phases({ setup, canEdit, editor }: { setup: Setup; canEdit: boolean; editor: ReturnType<typeof usePlanEditor> }) {
  const { run, busy } = useMutation();
  const [name, setName] = useState("");
  const romps = setup.areas;
  return (
    <Section id="phases" title="Phases and ROMPs" description="Phase membership is separate from the location hierarchy; phases may overlap and an area can sit outside every phase. Phase windows belong to the selected plan.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Phase</th>
              <th>Areas (membership)</th>
              <th>Phase window ({editor.data.plan.kind === "WORKING" ? "working plan" : "scenario"})</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {setup.phases.map((ph) => {
              const w = editor.data.phaseWindows.find((x) => x.phaseId === ph.id);
              return (
                <tr key={ph.id} className="border-t align-top">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{ph.name}</div>
                    <div className="text-xs text-muted-foreground">{ph.description}</div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {romps.map((a) => {
                        const on = ph.areaIds.includes(a.id);
                        return (
                          <button key={a.id} type="button" disabled={!canEdit || busy} aria-pressed={on} onClick={() => run(() => rpc("setup.savePhase", { projectId: setup.project.id, id: ph.id, name: ph.name, areaIds: on ? ph.areaIds.filter((x) => x !== a.id) : [...ph.areaIds, a.id] }))} className={`rounded border px-1.5 py-0.5 text-xs ${on ? "border-brand-line bg-brand text-white" : "bg-background text-muted-foreground"}`}>
                            {on ? "✓ " : ""}
                            {a.name}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <PhaseWindowInputs key={`${ph.id}:${editor.data.plan.revision}`} disabled={!editor.canEdit} start={w?.start ?? ""} finish={w?.finish ?? ""} onSave={(start, finish) => editor.apply([{ type: "setPhaseWindow", phaseId: ph.id, start: start || null, finish: finish || null, note: w?.note ?? null }], `Phase window ${ph.name}`)} />
                  </td>
                  <td className="py-2 text-right">
                    {canEdit ? (
                      <Button size="sm" variant="ghost" aria-label={`Delete ${ph.name}`} disabled={busy} onClick={() => window.confirm(`Delete ${ph.name}?`) && run(() => rpc("setup.deletePhase", { projectId: setup.project.id, id: ph.id }), "Phase deleted")}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Input aria-label="New phase name" className="h-8 max-w-xs" placeholder="New phase" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" variant="outline" disabled={busy || !name.trim()} onClick={async () => (await run(() => rpc("setup.savePhase", { projectId: setup.project.id, name }), "Phase added")) && setName("")}>
            <Plus className="size-3.5" /> Add phase
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function PhaseWindowInputs({ start, finish, disabled, onSave }: { start: string; finish: string; disabled: boolean; onSave: (s: string, f: string) => void }) {
  const [s, setS] = useState(start);
  const [f, setF] = useState(finish);
  const dirty = s !== start || f !== finish;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input aria-label="Phase start" type="date" disabled={disabled} className="h-8 w-36 text-xs" value={s} onChange={(e) => setS(e.target.value)} />
      <Input aria-label="Phase finish" type="date" disabled={disabled} className="h-8 w-36 text-xs" value={f} onChange={(e) => setF(e.target.value)} />
      {dirty ? (
        <Button size="sm" variant="outline" onClick={() => (s && f && f < s ? toast.error("Finish is before start") : onSave(s, f))}>
          Save
        </Button>
      ) : null}
    </div>
  );
}

function Areas({ setup, canEdit }: { setup: Setup; canEdit: boolean }) {
  const { run, busy } = useMutation();
  const [f, setF] = useState({ name: "", kind: "ROOM", parentId: "" });
  const tree: { a: Setup["areas"][number]; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const a of setup.areas.filter((x) => x.parentId === parentId)) {
      tree.push({ a, depth });
      visit(a.id, depth + 1);
    }
  };
  visit(null, 0);
  const phasesOf = (id: string) => setup.phases.filter((p) => p.areaIds.includes(id)).map((p) => p.name);
  return (
    <Section id="areas" title="Areas" description="Optional nested locations: building, ROMP, data hall, room, or zone. Activities and reservations may use an area, a phase, both, or neither.">
      <ul className="space-y-0.5 text-sm">
        {tree.map(({ a, depth }) => (
          <li key={a.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50" style={{ paddingLeft: 8 + depth * 18 }}>
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-muted-foreground">{AREA_LABEL[a.kind]}</span>
            <span className="text-xs text-muted-foreground">{phasesOf(a.id).length ? `· ${phasesOf(a.id).join(", ")}` : "· outside every phase"}</span>
            {canEdit ? (
              <button type="button" className="ml-auto" aria-label={`Delete ${a.name}`} disabled={busy} onClick={() => window.confirm(`Delete ${a.name}?`) && run(() => rpc("setup.deleteArea", { projectId: setup.project.id, id: a.id }), "Area deleted")}>
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
        {tree.length === 0 ? <li className="text-muted-foreground">No areas.</li> : null}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Area name" className="h-8 w-48" placeholder="Area name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select aria-label="Area type" className={selectCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {AREA_KINDS.map((k) => (
              <option key={k} value={k}>
                {AREA_LABEL[k]}
              </option>
            ))}
          </select>
          <select aria-label="Parent area" className={selectCls} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">Top level</option>
            {tree.map(({ a, depth }) => (
              <option key={a.id} value={a.id}>
                {"  ".repeat(depth)}
                {a.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={busy || !f.name.trim()} onClick={async () => (await run(() => rpc("setup.saveArea", { projectId: setup.project.id, name: f.name, kind: f.kind, parentId: f.parentId || null }), "Area added")) && setF({ ...f, name: "" })}>
            <Plus className="size-3.5" /> Add area
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function Milestones({ setup, canEdit }: { setup: Setup; canEdit: boolean }) {
  const { run, busy } = useMutation();
  const [f, setF] = useState({ code: setup.milestoneCodes[0] ?? "", name: "", phaseId: "" });
  const manual = setup.lineages.filter((l) => l.kind === "MANUAL_TABLE");
  const byPhase = [{ id: null as string | null, name: "Project" }, ...setup.phases.map((p) => ({ id: p.id as string | null, name: p.name }))];
  return (
    <Section id="milestones" title="Milestones" description="Candidate dates keep their source. A date is adopted only by an explicit review action; a milestone constrains installation work only through activity links.">
      {manual.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium">{l.name}</span>
          {l.versions.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1">
              {v.label}
              {canEdit ? (
                <Button size="sm" variant="outline" className="h-6 text-xs" disabled={busy} onClick={() => window.confirm(`Adopt every dated candidate from "${v.label}"? Each adoption is recorded in history.`) && run(() => rpc("setup.adoptSourceVersion", { projectId: setup.project.id, sourceVersionId: v.id }), `Adopted dates from ${v.label}`)}>
                  Adopt this table
                </Button>
              ) : null}
            </span>
          ))}
        </div>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Phase</th>
              <th>Milestone</th>
              <th>Working date</th>
              <th>Source candidates</th>
            </tr>
          </thead>
          <tbody>
            {byPhase.flatMap((ph) =>
              setup.milestones
                .filter((m) => m.phaseId === ph.id)
                .map((m) => {
                  const distinct = new Set(m.values.map((v) => v.date ?? "none"));
                  return (
                    <tr key={m.id} className="border-t align-top">
                      <td className="py-1.5 pr-2 text-xs text-muted-foreground">{ph.name}</td>
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{m.code}</span> <span className="text-xs text-muted-foreground">{m.name}</span>
                        {m.notes ? <div className="text-[11px] text-muted-foreground">{m.notes}</div> : null}
                      </td>
                      <td className="py-1.5 pr-2">
                        {m.reviewStatus === "CONFIRMED" ? (
                          <span>
                            {formatDate(m.date)} <Badge variant="outline" className="ml-1">Confirmed</Badge>
                          </span>
                        ) : (
                          <Badge variant="secondary" className="border-warning/40 bg-warning-bg text-warning">
                            Needs review
                          </Badge>
                        )}
                      </td>
                      <td className="py-1.5">
                        <ul className="space-y-0.5 text-xs">
                          {m.values.map((v) => (
                            <li key={v.id} className="flex flex-wrap items-center gap-1">
                              <span className={distinct.size > 1 ? "font-medium" : ""}>{v.date ? formatDate(v.date) : "unspecified"}</span>
                              <span className="text-muted-foreground">per {v.label}</span>
                              {m.adoptedValueId === v.id ? <Badge variant="outline">adopted</Badge> : null}
                              {canEdit && v.date && m.adoptedValueId !== v.id ? (
                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs underline" disabled={busy} onClick={() => run(() => rpc("setup.adoptMilestoneValue", { projectId: setup.project.id, milestoneId: m.id, valueId: v.id }), `Adopted ${m.code}`)}>
                                  Adopt
                                </Button>
                              ) : null}
                            </li>
                          ))}
                          {distinct.size > 1 ? <li className="text-warning">Sources disagree — review before adopting.</li> : null}
                        </ul>
                        {canEdit ? <ManualDate milestoneId={m.id} projectId={setup.project.id} current={m.date} /> : null}
                      </td>
                    </tr>
                  );
                }),
            )}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <select aria-label="Milestone phase" className={selectCls} value={f.phaseId} onChange={(e) => setF({ ...f, phaseId: e.target.value })}>
            <option value="">Project-level</option>
            {setup.phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Input aria-label="Milestone code" list="ms-codes" className="h-8 w-24" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <datalist id="ms-codes">
            {setup.milestoneCodes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Input aria-label="Milestone name" className="h-8 w-56" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Button size="sm" variant="outline" disabled={busy || !f.code || !f.name} onClick={async () => (await run(() => rpc("setup.saveMilestone", { projectId: setup.project.id, phaseId: f.phaseId || null, code: f.code, name: f.name }), "Milestone added")) && setF({ ...f, name: "" })}>
            <Plus className="size-3.5" /> Add milestone
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function ManualDate({ projectId, milestoneId, current }: { projectId: string; milestoneId: string; current: string | null }) {
  const { run, busy } = useMutation();
  const [d, setD] = useState(current ?? "");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="mt-1 text-[11px] underline" onClick={() => setOpen(true)}>
        Enter a date manually…
      </button>
    );
  return (
    <div className="mt-1 flex items-center gap-1">
      <Input aria-label="Manual milestone date" type="date" className="h-7 w-36 text-xs" value={d} onChange={(e) => setD(e.target.value)} />
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !d} onClick={() => run(() => rpc("setup.setMilestoneDate", { projectId, milestoneId, date: d, confirm: true }), "Milestone date set")}>
        Confirm date
      </Button>
    </div>
  );
}

function Contacts({ setup, canEdit, projectId }: { setup: Setup; canEdit: boolean; projectId: string }) {
  const { run, busy } = useMutation();
  const [f, setF] = useState({ name: "", title: "", organization: "", email: "", phone: "" });
  return (
    <Section id="contacts" title="Contacts" description="Project contacts are references only and never receive app accounts automatically.">
      <ul className="space-y-1 text-sm">
        {setup.contacts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
            <span className="font-medium">{c.name}</span>
            <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{[c.title, c.organization, c.email, c.phone].filter(Boolean).join(" · ")}</span>
            {canEdit ? (
              <button type="button" className="ml-auto" aria-label={`Remove ${c.name}`} disabled={busy} onClick={() => run(() => rpc("setup.deleteContact", { projectId, id: c.id }))}>
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
        {setup.contacts.length === 0 ? <li className="text-muted-foreground">No contacts yet.</li> : null}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {(["name", "title", "organization", "email", "phone"] as const).map((k) => (
            <Input key={k} aria-label={k} className="h-8 w-40" placeholder={k[0].toUpperCase() + k.slice(1)} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          ))}
          <Button size="sm" variant="outline" disabled={busy || !f.name.trim()} onClick={async () => (await run(() => rpc("setup.saveContact", { projectId, name: f.name, title: f.title || null, organization: f.organization || null, email: f.email || null, phone: f.phone || null }), "Contact added")) && setF({ name: "", title: "", organization: "", email: "", phone: "" })}>
            <Plus className="size-3.5" /> Add contact
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function Documents({ setup, canEdit, projectId }: { setup: Setup; canEdit: boolean; projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: new FormData(form) });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!body?.ok) return toast.error(body?.error?.message ?? "Upload failed");
    toast.success("Document uploaded");
    form.reset();
    router.refresh();
  }
  return (
    <Section id="documents" title="Documents" description="Original schedules, email screenshots, and correspondence stay with the project as private files. Their text is reference data, not instructions.">
      <ul className="space-y-1 text-sm">
        {setup.documents.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            <a className="min-w-0 font-medium [overflow-wrap:anywhere] underline-offset-2 hover:underline" href={`/api/files/${d.fileId}`}>
              {d.title}
            </a>
            <Badge variant="outline">{d.category}</Badge>
            <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {d.filename} · {(d.sizeBytes / 1024 / 1024).toFixed(1)} MB
            </span>
            {d.notes ? <span className="w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">{d.notes}</span> : null}
          </li>
        ))}
        {setup.documents.length === 0 ? <li className="text-muted-foreground">No documents.</li> : null}
      </ul>
      {canEdit ? (
        <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
          <Input name="file" type="file" required aria-label="File" className="h-9 w-72" />
          <Input name="title" aria-label="Title" placeholder="Title" className="h-9 w-56" />
          <select name="category" aria-label="Category" className={`${selectCls} h-9`} defaultValue="CORRESPONDENCE">
            <option value="SCHEDULE">Schedule</option>
            <option value="CORRESPONDENCE">Correspondence</option>
            <option value="SCREENSHOT">Email screenshot</option>
            <option value="OTHER">Other</option>
          </select>
          <Button size="sm" type="submit" disabled={busy}>
            <Upload className="size-3.5" /> {busy ? "Uploading…" : "Upload"}
          </Button>
        </form>
      ) : null}
    </Section>
  );
}
