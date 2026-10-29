"use client";

import { useCallback, useRef, useState } from "react";
import { applyOps, PlanOpError, validatePlan, type BlockingIssue, type PlanOp } from "@/domain/ops";
import type { PlanData } from "@/domain/plan";
import type { SaveState } from "@/components/save-status";
import { rpc, RpcError } from "@/lib/rpc-client";

export interface ApplyResult {
  ok: boolean;
  issues?: BlockingIssue[];
  message?: string;
}

export interface Conflict {
  ops: PlanOp[];
  summary?: string;
  message: string;
}

/**
 * Client-side plan editing. Edits are applied optimistically with the same
 * domain ops and validation the server uses, then saved one request at a time
 * with the last confirmed revision. A failed save rolls back to the last
 * server-confirmed plan; a stale revision opens a conflict that keeps the
 * user's change for an explicit re-apply after reloading.
 */
export function usePlanEditor(initial: PlanData, canEdit: boolean) {
  const [data, setData] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const confirmed = useRef(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastFailed = useRef<{ ops: PlanOp[]; summary?: string } | null>(null);

  const pending = useRef<PlanOp[][]>([]);

  /** Server-confirmed plan plus edits still waiting to be saved. */
  const rebase = useCallback((): PlanData => {
    let next = confirmed.current;
    for (const ops of pending.current) {
      try {
        next = applyOps(next, ops);
      } catch {
        // A queued edit that no longer applies will be rejected by the server too.
      }
    }
    return next;
  }, []);

  const send = useCallback(
    (ops: PlanOp[], summary?: string) => {
      setSaveState({ kind: "saving" });
      pending.current.push(ops);
      const job = queue.current.then(async () => {
        try {
          const res = await rpc("plans.applyOps", { planId: confirmed.current.plan.id, expectedRevision: confirmed.current.plan.revision, ops, summary });
          confirmed.current = res.data;
          lastFailed.current = null;
          pending.current.shift();
          setData(rebase());
          setSaveState(pending.current.length ? { kind: "saving" } : { kind: "saved", at: Date.now(), revision: res.revision });
        } catch (err) {
          pending.current.shift();
          setData(rebase());
          lastFailed.current = { ops, summary };
          if (err instanceof RpcError && err.code === "stale_revision") {
            setConflict({ ops, summary, message: err.message });
            setSaveState({ kind: "failed", message: "someone else saved a newer revision" });
          } else {
            setSaveState({ kind: "failed", message: err instanceof RpcError ? err.message : "unexpected error" });
          }
        }
      });
      queue.current = job;
      return job;
    },
    [rebase],
  );

  /** Validate locally, show the change immediately, and save. */
  const apply = useCallback(
    (ops: PlanOp[], summary?: string): ApplyResult => {
      if (!canEdit) return { ok: false, message: "This plan is read-only for you." };
      let next: PlanData;
      try {
        next = applyOps(data, ops);
      } catch (e) {
        return { ok: false, message: e instanceof PlanOpError ? e.message : "That change could not be applied." };
      }
      const issues = validatePlan(next, data);
      if (issues.length) return { ok: false, issues, message: issues.map((i) => i.message).join("\n") };
      setData(next);
      void send(ops, summary);
      return { ok: true };
    },
    [canEdit, data, send],
  );

  /** Preview without saving (bulk moves, calendar changes). */
  const preview = useCallback(
    (ops: PlanOp[]): { data: PlanData | null; issues: BlockingIssue[]; message?: string } => {
      try {
        const next = applyOps(data, ops);
        return { data: next, issues: validatePlan(next, data) };
      } catch (e) {
        return { data: null, issues: [], message: e instanceof PlanOpError ? e.message : "That change could not be previewed." };
      }
    },
    [data],
  );

  const reload = useCallback(async () => {
    const view = await rpc("plans.view", { projectId: confirmed.current.project.id, planId: confirmed.current.plan.id });
    confirmed.current = view.data;
    setData(view.data);
    setSaveState({ kind: "idle" });
    return view;
  }, []);

  /** After a conflict: load the latest revision, then re-apply the user's change on top of it. */
  const reapplyAfterReload = useCallback(async () => {
    const c = conflict;
    setConflict(null);
    const view = await reload();
    if (!c) return { ok: true };
    try {
      const next = applyOps(view.data, c.ops);
      const issues = validatePlan(next, view.data);
      if (issues.length) {
        setSaveState({ kind: "failed", message: `your change no longer fits the latest plan: ${issues[0].message}` });
        return { ok: false, issues };
      }
      setData(next);
      await send(c.ops, c.summary);
      return { ok: true };
    } catch (e) {
      setSaveState({ kind: "failed", message: e instanceof Error ? e.message : "could not re-apply" });
      return { ok: false };
    }
  }, [conflict, reload, send]);

  const retry = useCallback(() => {
    const f = lastFailed.current;
    if (f) apply(f.ops, f.summary);
  }, [apply]);

  return { data, saveState, apply, preview, reload, conflict, setConflict, reapplyAfterReload, retry, canEdit };
}

export type PlanEditor = ReturnType<typeof usePlanEditor>;
