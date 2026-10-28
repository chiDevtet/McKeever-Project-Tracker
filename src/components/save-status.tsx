"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";

export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number; revision: number } | { kind: "failed"; message: string };

/** Saving / saved / failed indicator; state is conveyed by text and icon, not color alone. */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state.kind === "idle") return <span className="text-xs text-muted-foreground">All changes saved</span>;
  if (state.kind === "saving")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
      </span>
    );
  if (state.kind === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
        <Check className="size-3.5" aria-hidden /> Saved · revision {state.revision}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-destructive" role="alert">
      <AlertTriangle className="size-3.5" aria-hidden /> Not saved: {state.message}
      {onRetry ? (
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}
