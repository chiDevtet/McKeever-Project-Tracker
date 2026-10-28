# M&N FieldOps build status

Resume point for any session continuing this build. Update after every stage.

## Implementation plan (concise)

Single pnpm package (`mne-fieldops`) with enforced folder boundaries:

| Boundary | Path | Responsibility |
| --- | --- | --- |
| Domain | `src/domain` | Pure TypeScript: dates/timezones, calendars, capacity tree expansion and validation, weekly measures, scheduling (working-day moves, FS links, cycles), issues, division demand, comparisons, report dataset. No I/O. |
| Persistence/services | `src/server` | Prisma client, Better Auth, authorization, audit, plan loader/writer, snapshot builder, storage adapters (local/R2), mail (outbox/SMTP), job enqueue, RPC procedures. |
| Reporting | `src/reporting` | Trusted print templates (React static markup), SVG chart, ExcelJS workbook builder. Shared by preview and worker. |
| Worker | `src/worker` | pg-boss consumer: PDF/spreadsheet extraction (Python pdfplumber over a validated JSON boundary) and report rendering (Playwright Chromium, ExcelJS). |
| Web | `src/app`, `src/components` | Next.js App Router UI and route handlers. |

Stages (all are inside the first release):

1. Scaffold, pinned deps, Prisma schema + migrations, Better Auth (invite-only, bootstrap CLI, reset, dev outbox), project config, calendar, leadership, weekly capacity grid, shared labor engine with arithmetic fixtures, persist and reload.
2. Activities, connected timeline (drag/resize), FS links with lag and cycle prevention, nested allocations, dedicated crews, calendar exceptions, preview/apply, conflicts.
3. Report dataset, PDF (Playwright) and .xlsx (ExcelJS) from captured snapshots, presets, immutable submissions with issue acknowledgment.
4. Queued PDF/CSV/XLSX extraction, review grid beside source preview, idempotent commit, revision comparison, selected atomic apply.
5. Progress validation and audit, baselines, scenarios and promotion, restore, division forecast and availability, invitations and permissions, history.
6. Acceptance A01-A26 evidence, responsive checks, access isolation, backup/restore drill, delivery docs.

## Completed stages

_None yet._

## Checks run

_None yet._

## Blockers

_None._

## Next concrete action

Scaffold the repository and install pinned dependencies.
