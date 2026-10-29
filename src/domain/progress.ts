/**
 * Manual progress rules. Progress is reported information: it never changes
 * headcount, reservations, or milestones by itself, and it does not establish
 * installed quantities or actual labor.
 */

import { isISODate, type ISODate } from "./dates";
import type { ProgressInput, ProgressStatus } from "./plan";

export interface ProgressDraft {
  status: ProgressStatus;
  actualStart: ISODate | null;
  actualFinish: ISODate | null;
  percentComplete: number | null;
  holdReason: string | null;
  holdReviewDate: ISODate | null;
  /** Required when reopening completed work. */
  reopenReason?: string | null;
}

export interface ProgressProblem {
  field: keyof ProgressDraft | "status";
  message: string;
}

export const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETE: "Complete", ON_HOLD: "On hold" };

/** Validate a progress update against the prior record and today's date in the project timezone. */
export function validateProgress(prev: Pick<ProgressInput, "status"> | null, next: ProgressDraft, today: ISODate): ProgressProblem[] {
  const out: ProgressProblem[] = [];
  for (const f of ["actualStart", "actualFinish", "holdReviewDate"] as const) {
    if (next[f] !== null && !isISODate(next[f])) out.push({ field: f, message: "Enter a valid date" });
  }
  if (out.length) return out;
  if (next.actualStart && next.actualStart > today) out.push({ field: "actualStart", message: "An actual start cannot be in the future" });
  if (next.actualFinish && next.actualFinish > today) out.push({ field: "actualFinish", message: "An actual finish cannot be in the future" });
  if (next.actualFinish && !next.actualStart) out.push({ field: "actualStart", message: "An actual finish requires an actual start" });
  if (next.actualStart && next.actualFinish && next.actualFinish < next.actualStart) out.push({ field: "actualFinish", message: "The actual finish cannot be before the actual start" });
  if (next.percentComplete !== null && (!Number.isFinite(next.percentComplete) || next.percentComplete < 0 || next.percentComplete > 100)) out.push({ field: "percentComplete", message: "Percent complete must be between 0 and 100" });
  switch (next.status) {
    case "NOT_STARTED":
      if (next.actualStart || next.actualFinish) out.push({ field: "status", message: "Work with actual dates has started; choose In progress, On hold, or Complete" });
      if (next.percentComplete) out.push({ field: "percentComplete", message: "Work that has not started cannot report progress" });
      break;
    case "IN_PROGRESS":
      if (!next.actualStart) out.push({ field: "actualStart", message: "In progress work needs an actual start" });
      if (next.actualFinish) out.push({ field: "status", message: "Work with an actual finish is complete; choose Complete or clear the finish" });
      if (next.percentComplete === 100) out.push({ field: "percentComplete", message: "Mark the activity complete to record 100 percent" });
      break;
    case "COMPLETE":
      if (!next.actualFinish) out.push({ field: "actualFinish", message: "Completing an activity requires an actual finish" });
      if (!next.actualStart) out.push({ field: "actualStart", message: "Completing an activity requires an actual start" });
      break;
    case "ON_HOLD":
      if (!next.holdReason?.trim()) out.push({ field: "holdReason", message: "Record why the work is on hold" });
      if (next.actualFinish) out.push({ field: "status", message: "Completed work cannot be on hold" });
      if (next.percentComplete === 100) out.push({ field: "percentComplete", message: "Mark the activity complete to record 100 percent" });
      break;
  }
  if (prev?.status === "COMPLETE" && next.status !== "COMPLETE" && !next.reopenReason?.trim()) out.push({ field: "reopenReason", message: "Reopening completed work requires a reason; it is recorded in the history" });
  return out;
}

/** The stored record for a valid draft: complete records 100 percent; hold fields only while on hold. */
export function normalizeProgress(activityKey: string, next: ProgressDraft): ProgressInput {
  return {
    activityKey,
    status: next.status,
    actualStart: next.actualStart,
    actualFinish: next.status === "COMPLETE" ? next.actualFinish : null,
    percentComplete: next.status === "COMPLETE" ? 100 : next.percentComplete,
    holdReason: next.status === "ON_HOLD" ? (next.holdReason?.trim() ?? null) : null,
    holdReviewDate: next.status === "ON_HOLD" ? next.holdReviewDate : null,
  };
}
