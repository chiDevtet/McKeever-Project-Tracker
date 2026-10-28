"use client";

import { useRouter } from "next/navigation";
import { SaveStatus } from "@/components/save-status";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, startOfWeek } from "@/domain/dates";
import type { BlockingIssue, PlanOp } from "@/domain/ops";
import type { PlanListItem } from "@/server/services/plans";
import type { PlanEditor } from "./use-plan-editor";

export function planLabel(p: { kind: string; name: string; revision: number; basedOnRevision: number | null }) {
  return p.kind === "WORKING" ? `Working plan · revision ${p.revision}` : `Scenario “${p.name}” · revision ${p.revision}${p.basedOnRevision ? ` · from working rev ${p.basedOnRevision}` : ""}`;
}

export function PlanBar({ editor, plans, basePath }: { editor: PlanEditor; plans: PlanListItem[]; basePath: string }) {
  const router = useRouter();
  const { data } = editor;
  const scenario = data.plan.kind === "SCENARIO";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="plan-switch">
        Plan
      </label>
      <select id="plan-switch" className="h-8 rounded-md border bg-background px-2 text-sm" value={data.plan.id} onChange={(e) => router.push(`${basePath}?plan=${e.target.value}`)}>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.kind === "WORKING" ? "Working plan" : `Scenario: ${p.name}`}
          </option>
        ))}
      </select>
      <Badge variant={scenario ? "secondary" : "outline"} className={scenario ? "border-warning/40 bg-warning-bg text-warning" : ""}>
        {planLabel(data.plan)}
      </Badge>
      {scenario ? <span className="text-xs text-muted-foreground">Exploratory: not included in the live division forecast until promoted.</span> : null}
      {!editor.canEdit ? <Badge variant="secondary">Read-only</Badge> : null}
      <div className="ml-auto">
        <SaveStatus state={editor.saveState} onRetry={editor.retry} />
      </div>
      <AlertDialog open={Boolean(editor.conflict)} onOpenChange={(o) => !o && editor.setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Newer revision saved elsewhere</AlertDialogTitle>
            <AlertDialogDescription>{editor.conflict?.message} Your change was not saved and nothing was overwritten.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                editor.setConflict(null);
                void editor.reload();
              }}
            >
              Reload and discard my change
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void editor.reapplyAfterReload()}>Reload and re-apply my change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export interface CapacityProblem {
  ops: PlanOp[];
  summary?: string;
  issues: BlockingIssue[];
}

/**
 * Over-capacity correction path. The rejected edit is kept; the operator can
 * go back and change it, or explicitly increase the parent capacity for the
 * affected weeks and retry. Capacity is never increased implicitly.
 */
export function CapacityDialog({ problem, editor, onRetry, onClose }: { problem: CapacityProblem | null; editor: PlanEditor; onRetry: (ops: PlanOp[], summary: string) => void; onClose: () => void }) {
  if (!problem) return null;
  const capacity = problem.issues.filter((i) => i.code === "capacity.exceeded" && i.capacity);
  const other = problem.issues.filter((i) => i.code !== "capacity.exceeded");
  const byParent = new Map<string, Map<string, number>>();
  for (const i of capacity) {
    const v = i.capacity!;
    const weeks = byParent.get(v.parentKey) ?? new Map<string, number>();
    const w = startOfWeek(v.date);
    weeks.set(w, Math.max(weeks.get(w) ?? 0, v.reserved - v.capacity));
    byParent.set(v.parentKey, weeks);
  }
  const fixes: PlanOp[] = [];
  const fixText: string[] = [];
  for (const [parentKey, weeks] of byParent) {
    const parent = editor.data.nodes.find((n) => n.key === parentKey);
    if (!parent) continue;
    const values = [...weeks].map(([week, add]) => ({ week, add }));
    if (parent.kind === "POOL") {
      fixes.push({ type: "increaseWorkforce", nodeKey: parentKey, values });
      fixText.push(`Increase "${parent.name}" workforce by up to ${Math.max(...values.map((v) => v.add))} in ${values.length} week(s)`);
    } else {
      const current = (week: string) => editor.data.entries.find((e) => e.nodeKey === parentKey && e.kind === "WEEK" && e.date === week)?.headcount ?? 0;
      fixes.push({ type: "setWeeks", nodeKey: parentKey, values: values.map((v) => ({ week: v.week, headcount: current(v.week) + v.add })) });
      fixText.push(`Raise reservation "${parent.name}" by up to ${Math.max(...values.map((v) => v.add))} in ${values.length} week(s) (its own parent must have room)`);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change not saved</DialogTitle>
          <DialogDescription>The edit would reserve more people than the parent capacity provides, or failed validation. Nothing was changed.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
          {[...capacity, ...other].slice(0, 12).map((i, idx) => (
            <li key={idx} className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1">
              {i.message}
            </li>
          ))}
        </ul>
        {fixes.length && !other.length ? (
          <div className="rounded-md border p-2 text-sm">
            <div className="font-medium">Explicit correction</div>
            <ul className="list-disc pl-5 text-muted-foreground">
              {fixText.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Weeks of {[...new Set([...byParent.values()].flatMap((m) => [...m.keys()]))].sort().map((w) => formatDate(w)).join(", ")}</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Go back and edit
          </Button>
          {fixes.length && !other.length ? (
            <Button
              onClick={() => {
                onClose();
                onRetry([...fixes, ...problem.ops], `${problem.summary ?? "Edit"} with explicit capacity increase`);
              }}
            >
              Apply with capacity increase
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
