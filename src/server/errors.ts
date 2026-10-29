import type { BlockingIssue } from "@/domain/ops";

/** Errors with a stable code and HTTP status, safe to show to the operator. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError("unauthenticated", "Sign in to continue.", 401);
export const forbidden = (message = "You do not have access to this.") => new AppError("forbidden", message, 403);
export const notFound = (what = "Record") => new AppError("not_found", `${what} not found.`, 404);
export const badRequest = (message: string, details?: unknown) => new AppError("bad_request", message, 400, details);
export const conflict = (message: string, details?: unknown) => new AppError("conflict", message, 409, details);

export class StaleRevisionError extends AppError {
  constructor(readonly currentRevision: number, expected: number) {
    super("stale_revision", `This plan changed since you loaded it (you had revision ${expected}; it is now revision ${currentRevision}). Reload to see the latest, then re-apply your change.`, 409, { currentRevision, expected });
  }
}

export class ValidationFailed extends AppError {
  constructor(readonly issues: BlockingIssue[]) {
    super("validation_failed", issues.map((i) => i.message).join("\n"), 422, { issues });
  }
}
