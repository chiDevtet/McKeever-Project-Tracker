"use client";

import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PlanOp } from "@/domain/ops";
import type { NodeInput, NodeKind, PlanData } from "@/domain/plan";

type Props = {
  data: PlanData;
  apply: (ops: PlanOp[], summary?: string) => boolean;
  onClose: () => void;
} & ({ mode: "edit"; node: NodeInput } | { mode: "add"; kind: NodeKind; parentKey: string | null });

export function areaOptions(data: PlanData): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const a of data.areas.filter((x) => x.parentId === parentId).sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name))) {
      out.push({ id: a.id, label: `${"  ".repeat(depth)}${a.name}` });
      visit(a.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function NodeFormDialog(props: Props) {
  const { data, apply, onClose } = props;
  const initial: NodeInput =
    props.mode === "edit"
      ? props.node
      : {
          key: crypto.randomUUID(),
          parentKey: props.parentKey,
          kind: props.kind,
          name: props.kind === "POOL" ? "Installers" : props.kind === "CREW" ? "Dedicated crew" : "",
          role: props.parentKey ? (data.nodes.find((n) => n.key === props.parentKey)?.role ?? "Installer") : "Installer",
          phaseId: null,
          areaId: null,
          systemId: null,
          activityKey: null,
          calendarKey: null,
          notes: null,
          sortOrder: data.nodes.filter((n) => n.parentKey === props.parentKey).length,
        };
  const [n, setN] = useState<NodeInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const parent = n.parentKey ? data.nodes.find((x) => x.key === n.parentKey) : null;

  function save() {
    if (!n.name.trim()) return setError("Name is required.");
    const op: PlanOp =
      props.mode === "edit"
        ? { type: "updateNode", key: n.key, patch: { name: n.name, role: n.role, phaseId: n.phaseId, areaId: n.areaId, systemId: n.systemId, activityKey: n.activityKey, calendarKey: n.calendarKey, notes: n.notes, ...(n.kind !== "POOL" ? { kind: n.kind as "RESERVATION" | "CREW" } : {}) } }
        : { type: "addNode", node: n };
    if (apply([op], props.mode === "edit" ? `Edit ${n.name}` : `Add ${n.kind === "CREW" ? "crew" : n.kind === "POOL" ? "pool" : "reservation"} ${n.name}`)) onClose();
    else setError("The change was not accepted; see the message shown.");
  }

  const title = props.mode === "edit" ? "Edit staffing row" : n.kind === "POOL" ? "Add workforce pool" : n.kind === "CREW" ? "Add dedicated crew" : "Add reservation";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {n.kind === "POOL"
              ? "A workforce pool supplies people. Reservations below it subdivide that capacity."
              : `Reserves part of ${parent ? `"${parent.name}"` : "the parent"} for the selected dates. It never adds people; enter its weekly counts in the grid.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="node-name">Name</Label>
            <Input id="node-name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder={n.kind === "CREW" ? "Fire alarm crew A" : "Phase 1"} autoFocus />
          </div>
          {n.kind === "POOL" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="node-role">Role</Label>
              <Input id="node-role" value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} />
            </div>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="node-kind">Type</Label>
              <select id="node-kind" className={selectCls} value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value as NodeKind })}>
                <option value="RESERVATION">Reservation (phase, area, system, or activity)</option>
                <option value="CREW">Dedicated crew (reserved from shared work for dates)</option>
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="node-phase">Phase</Label>
            <select id="node-phase" className={selectCls} value={n.phaseId ?? ""} onChange={(e) => setN({ ...n, phaseId: e.target.value || null })}>
              <option value="">Unspecified</option>
              {data.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-system">System</Label>
            <select id="node-system" className={selectCls} value={n.systemId ?? ""} onChange={(e) => setN({ ...n, systemId: e.target.value || null })}>
              <option value="">Shared systems</option>
              {data.systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-area">Area</Label>
            <select id="node-area" className={selectCls} value={n.areaId ?? ""} onChange={(e) => setN({ ...n, areaId: e.target.value || null })}>
              <option value="">Unspecified</option>
              {areaOptions(data).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-activity">Activity</Label>
            <select id="node-activity" className={selectCls} value={n.activityKey ?? ""} onChange={(e) => setN({ ...n, activityKey: e.target.value || null })}>
              <option value="">None</option>
              {data.activities
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.code} {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="node-cal">Calendar</Label>
            <select id="node-cal" className={selectCls} value={n.calendarKey ?? ""} onChange={(e) => setN({ ...n, calendarKey: e.target.value || null })}>
              <option value="">{n.parentKey ? "Same as parent" : "Project calendar"}</option>
              {data.calendars
                .filter((c) => !c.isDefault)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="node-notes">Notes</Label>
            <Textarea id="node-notes" rows={2} value={n.notes ?? ""} onChange={(e) => setN({ ...n, notes: e.target.value || null })} />
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{props.mode === "edit" ? "Save" : "Add row"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
