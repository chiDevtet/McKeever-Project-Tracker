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

- **Stage 1** — scaffold, pinned dependencies, Prisma schema and migrations, Better Auth (invite-only, CLI bootstrap, password reset, dev outbox), CMH139 seed, weekly capacity grid, shared labor engine.
- **Stage 2** — activities, timeline, finish-to-start links with lag and cycle prevention, nested allocations, dedicated crews, calendars and exceptions, move/calendar previews, planning issues.
- **Stage 3** — report dataset, Playwright PDF and ExcelJS workbook from immutable snapshots, presets, submissions with issue acknowledgment.
- **Stage 4** — queued PDF/CSV/XLSX extraction, review grid beside rendered page previews, idempotent commit, source-wide revision comparison, ambiguity review, selected atomic apply.
- **Stage 5** (in progress) — done: progress validation and history, split remaining work, baselines, scenarios, compare, promote, restore, Plans & history page, People (personnel, users, invitations, grants), Settings (branding, roles, availability), dev outbox. Remaining: separate illustrative demo dataset.

## Checks run

- `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test` (unit, 38 passing).
- `pnpm test:integration` against a disposable PostgreSQL database: imports (7) and progress/scenarios (8) passing.
- Browser walkthroughs with Playwright Chromium against `pnpm dev` + `pnpm worker`: grid edits and reload, report PDF/XLSX generation, PDF import of the supplied fixture (P1ER.1140, P1RP.1210, P1CX.2000 match), identical re-import, revised CSV import and apply, progress, scenario promotion, invitation to a read-only viewer, revocation.

## Blockers

_None._ Cloud deployment (VPS, Neon, R2, SMTP) is configuration only and is not performed from this repository.

## Next concrete action

Stage 5: separate demo dataset script. Stage 6: remaining integration tests (persistence/stale/atomic, access isolation, reports and frozen submissions), Playwright e2e suite, Docker images and Compose, backup/restore scripts and drill, README and decision log, acceptance evidence A01–A26.
