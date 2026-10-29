import { AlertCircle } from "lucide-react";

/** Inline error with an icon and text (never color alone). */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="whitespace-pre-line">{message}</span>
    </div>
  );
}
