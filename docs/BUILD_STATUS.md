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

All six stages of the first release are complete.

- **Stage 1** — scaffold, pinned dependencies, Prisma schema and migrations, Better Auth (invite-only, CLI bootstrap, password reset, dev outbox), CMH139 seed, weekly capacity grid, shared labor engine.
- **Stage 2** — activities, timeline, finish-to-start links with lag and cycle prevention, nested allocations, dedicated crews, calendars and exceptions, move and calendar previews, planning issues.
- **Stage 3** — report dataset, Playwright PDF and ExcelJS workbook from immutable snapshots, presets, submissions with issue acknowledgment.
- **Stage 4** — queued PDF/CSV/XLSX extraction, review grid beside rendered page previews, idempotent commit, source-wide revision comparison, ambiguity review, selected atomic apply.
- **Stage 5** — progress validation and history, split remaining work, baselines, scenarios, compare, promote, restore, Plans & history, People (personnel, users, invitations, grants), Settings (branding, roles, availability), dev outbox, separate illustrative demo dataset, optional activity cost codes.
- **Stage 6** — integration and browser suites, acceptance evidence A01–A26 (all verified), responsive checks, access isolation, Docker images and Compose with Caddy (built and run locally), backup and restore with a tested drill, README, decision log, implementation checklist.

## Checks run (latest)

- `pnpm typecheck`, `pnpm lint` (0 errors, 0 warnings), `pnpm build` (also with no `.env`).
- `pnpm test`: 5 files, 39 tests passed.
- `pnpm test:integration` (PostgreSQL 16, disposable database): 5 files, 30 tests passed.
- `pnpm test:e2e` (production build + worker): 6 files, 11 tests passed.
- Docker: `web` and `worker` images built; Compose stack (local-db profile) healthy; sign-in, PDF/XLSX generation, and fixture import verified through Caddy.
- Backup/restore drill with `backup:verify --compare`: OK; corruption detected when introduced.

Details: [`ACCEPTANCE_EVIDENCE.md`](ACCEPTANCE_EVIDENCE.md).

## Blockers

_None._ Cloud deployment (VPS, DNS, Neon, R2, SMTP) is configuration only and was not performed from this repository.

## Next concrete action

Deployment by the operator: provision the VPS, Neon database, private R2 bucket, and SMTP; fill in `.env.production`; run `docker compose --env-file .env.production up -d --build`; seed CMH139 and bootstrap the first administrator (see README › Deployment). Then enter real installer counts, leadership dates, and the foreman name, and import the GC schedule.
