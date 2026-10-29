import { formatDate } from "@/domain/dates";

export { formatDate };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatHours(h: number): string {
  return `${nf.format(h)} h`;
}

export function formatNumber(n: number, digits: 1 | 2 = 1): string {
  return (digits === 2 ? nf2 : nf).format(n);
}

export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "Dates not set";
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function formatTimestamp(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(d) + " ET";
}

export const STATUS_LABELS: Record<string, string> = {
  PRELIMINARY: "Preliminary",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};
