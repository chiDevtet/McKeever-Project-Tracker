"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/domain/dates";
import { computePlanningIssues } from "@/domain/issues";
import { buildMovePreview, defaultSelection, describeMove, moveOps, type MovePreview, type MoveRequest, type MoveSelection } from "@/domain/move";
import { applyOps, validatePlan, type PlanOp } from "@/domain/ops";
import type { PlanData } from "@/domain/plan";
import { MOVE_RULE_LABELS, type MoveRule } from "@/domain/schedule";

interface Props {
  data: PlanData;
  request: MoveRequest;
  onCancel: () => void;
  onApply: (ops: PlanOp[], summary: string) => boolean;
}

export function MovePreviewDialog({ data, request, onCancel, onApply }: Props) {
  const [rule, setRule] = useState<MoveRule>(request.kind === "dates" ? request.rule : "preserve-working-duration");
  const preview = useMemo(() => buildMovePreview(data, request.kind === "dates" ? { ...request, rule } : request), [data, request, rule]);
  // Selections reset to the defaults whenever the preview itself changes (for example a new rule).
  const [selState, setSelState] = useState<{ preview: MovePreview; sel: MoveSelection } | null>(null);
  const sel = selState && selState.preview === preview ? selState.sel : defaultSelection(preview);
  const setSel = (next: MoveSelection) => setSelState({ preview, sel: next });
  const ops = useMemo(() => moveOps(preview, sel), [preview, sel]);
  const result = useMemo(() => {
    try {
      const next = applyOps(data, ops);
      const before = new Set(computePlanningIssues(data).map((i) => i.id));
      return { blocking: validatePlan(next, data), newIssues: computePlanningIssues(next).filter((i) => !before.has(i.id) && i.severity !== "info"), error: null as string | null };
    } catch (e) {
      return { blocking: [], newIssues: [], error: e instanceof Error ? e.message : "Cannot apply" };
    }
  }, [data, ops]);
  const toggle = (k: keyof MoveSelection, key: string) => setSel({ ...sel, [k]: sel[k].includes(key) ? sel[k].filter((x) => x !== key) : [...sel[k], key] });
  const nothing = ops.length === 0;
  const canApply = !nothing && result.blocking.length === 0 && !result.error;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview: {describeMove(preview)}</DialogTitle>
          <DialogDescription>Nothing changes until you apply. Cancel leaves every activity, reservation, and assignment as it is.</DialogDescription>
        </DialogHeader>

        {request.kind === "dates" ? (
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Date rule</legend>
            {(Object.keys(MOVE_RULE_LABELS) as MoveRule[]).map((r) => (
              <label key={r} className="flex items-center gap-2">
                <input type="radio" name="rule" checked={rule === r} onChange={() => setRule(r)} /> {MOVE_RULE_LABELS[r]}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm">
            Rule: {MOVE_RULE_LABELS["preserve-working-duration"]}; shift {request.amount} {request.unit === "weeks" ? "calendar week(s)" : "working day(s)"}.
          </p>
        )}

        <section>
          <h3 className="mb-1 text-sm font-semibold">Activities</h3>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Activity</th>
                <th>Current</th>
                <th />
                <th>Proposed</th>
                <th className="text-right">Working days</th>
              </tr>
            </thead>
            <tbody>
              {preview.activities.map((m) => (
                <tr key={m.key} className="border-t align-top">
                  <td className="py-1 pr-2">
                    <div className="font-medium">{m.code}</div>
                    <div className="text-muted-foreground">{m.name}</div>
                    {m.blocked ? <div className="text-warning">{m.blocked}</div> : null}
                    {m.note ? <div className="text-muted-foreground">{m.note}</div> : null}
                  </td>
                  <td className="tabular">
                    {formatDate(m.from.start)} – {formatDate(m.from.finish)}
                  </td>
                  <td>
                    <ArrowRight className="size-3" aria-hidden />
                  </td>
                  <td className="tabular font-medium">
                    {formatDate(m.to.start)} – {formatDate(m.to.finish)}
                  </td>
                  <td className="text-right tabular">
                    {m.durationBefore} → {m.durationAfter}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {preview.successors.length ? (
          <section>
            <h3 className="mb-1 text-sm font-semibold">Linked successors</h3>
            <ul className="space-y-1 text-xs">
              {preview.successors.map((s) => (
                <li key={s.key} className="flex items-start gap-2">
                  <input type="checkbox" aria-label={`Move ${s.code}`} disabled={s.blockedByCompletion} checked={sel.successorKeys.includes(s.key)} onChange={() => toggle("successorKeys", s.key)} />
                  <span>
                    <strong>{s.code}</strong> {s.name}: {formatDate(s.from.start)}–{formatDate(s.from.finish)} → {formatDate(s.to.start)}–{formatDate(s.to.finish)} · {s.reason}
                    {s.required ? " (needed to keep the link valid)" : " (optional)"}
                    {s.blockedByCompletion ? " · complete, keeps actual dates" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="mb-1 text-sm font-semibold">Staffing and leadership that can move</h3>
          {preview.staffing.length === 0 && preview.leadership.length === 0 ? <p className="text-xs text-muted-foreground">No reservations are tied to these activities. Project workforce stays where it is.</p> : null}
          <ul className="space-y-1 text-xs">
            {preview.staffing.map((s) => (
              <li key={`${s.nodeKey}:${s.forActivityKey}`} className="flex items-start gap-2">
                <input type="checkbox" aria-label={`Move staffing ${s.name}`} checked={sel.staffingKeys.includes(s.nodeKey)} onChange={() => toggle("staffingKeys", s.nodeKey)} />
                <span>
                  <strong>{s.name}</strong> — {s.description}; shift {s.amount} {s.unit === "weeks" ? "week(s)" : "working day(s)"}
                </span>
              </li>
            ))}
            {preview.leadership.map((l) => (
              <li key={l.key} className="flex items-start gap-2">
                <input type="checkbox" aria-label={`Move leadership ${l.label}`} checked={sel.leadershipKeys.includes(l.key)} onChange={() => toggle("leadershipKeys", l.key)} />
                <span>
                  <strong>{l.label}</strong> — leadership assignment dates move {l.days} calendar day(s)
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Crew sizes are preserved. Shortening work never changes headcount automatically.</p>
        </section>

        {preview.milestones.length ? (
          <section>
            <h3 className="mb-1 text-sm font-semibold">Milestone impacts</h3>
            <ul className="text-xs">
              {preview.milestones.map((m) => (
                <li key={m.activityKey + m.milestoneLabel} className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="size-3.5" aria-hidden /> Finishes {formatDate(m.newFinish)}, after linked {m.milestoneLabel} ({formatDate(m.milestoneDate)})
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {result.blocking.length || result.error ? (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            <div className="font-medium">Cannot apply these selections</div>
            {result.error ? <div>{result.error}</div> : null}
            {result.blocking.slice(0, 6).map((b, i) => (
              <div key={i}>{b.message}</div>
            ))}
            <div className="text-muted-foreground">Deselect the staffing move, include the parent capacity, or adjust staffing first.</div>
          </div>
        ) : null}
        {result.newIssues.length ? (
          <div className="rounded-md border border-warning/40 bg-warning-bg p-2 text-xs text-warning">
            <div className="font-medium">New planning flags after this move (allowed in a draft)</div>
            {result.newIssues.slice(0, 6).map((i) => (
              <div key={i.id}>{i.message}</div>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canApply} onClick={() => onApply(ops, describeMove(preview)) && onCancel()}>
            Apply {ops.length} selected change{ops.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
