"use client";

import { AlertTriangle, Inbox, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-background px-6 py-10 text-center">
      <Inbox className="mb-2 size-6 text-muted-foreground" aria-hidden />
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 max-w-prose text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Could not load this", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
      <AlertTriangle className="mb-2 size-6 text-destructive" aria-hidden />
      <div className="font-medium text-destructive">{title}</div>
      {message ? <div className="mt-1 max-w-prose text-sm text-muted-foreground">{message}</div> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw className="size-3.5" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}
