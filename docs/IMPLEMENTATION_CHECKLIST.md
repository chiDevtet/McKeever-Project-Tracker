# Implementation checklist

Each specification area ([`SPEC.md`](SPEC.md)) with where it is implemented and how it was checked. "AE" refers to [`ACCEPTANCE_EVIDENCE.md`](ACCEPTANCE_EVIDENCE.md).

## Workspace, projects, and access

- [x] **Division dashboard** — active projects, schedule ranges, next milestones (candidates marked), peak onsite, planned hours, on-hold activities, date conflicts; combined chart with installers and leadership; filters by project, role, and period. `src/app/(app)/page.tsx`, `src/domain/division.ts`. Checked: unit `division.test.ts`, walkthrough (AE A24).
- [x] **Availability limits** by role and date range; shortages only when entered, otherwise "Availability not set". Settings › Workforce availability, `src/server/services/division.ts`. Checked: unit "reports shortages only when availability is entered", walkthrough.
- [x] **Project setup** — code, name, status, description, timezone, customer/GC/owner organizations, contacts (never accounts), systems with source aliases, phases with ROMP membership, area hierarchy, milestones with source candidates, documents. Manual projects without a source schedule. `src/components/setup`, `src/server/services/structure.ts`, `projects.ts`. Checked: `structure.test.ts` (A02), e2e access spec creates a project.
- [x] **Roles** — administrator, project manager, internal viewer, foreman viewer; enforced in every service for records, files, and exports; revocation stops retrieval. `src/server/authz.ts`. Checked: A22.
- [x] **Personnel separate from logins**; named leadership needs a person or explicit TBD placeholder; a person counts once across responsibilities. People page, `src/domain/staffing.ts`. Checked: A10, A24.
- [x] **Interface** — desktop-first, responsive (phone/tablet overflow test), project switcher via sidebar and tabs, scenario and revision labels, searchable tables, expandable groups, saving/saved/failed states, values kept after validation errors, server-persisted state only.

## Schedule planning

- [x] Connected activity table and timeline sharing selection, filters, and grouping (project, phase, area, system, none); day and week zoom; milestones shown. `src/components/schedule`.
- [x] Date entry, drag and resize, bulk move of unfinished activities; move preview with dates, reservations, leadership, conflicts, and per-assignment choice; project-level workforce stays unless included. `src/domain/move.ts`, `move-preview.tsx`. Checked: unit A11/A12, A17 integration.
- [x] Finish-to-start links with working-day lag; successor proposals; cycles rejected. `src/domain/schedule.ts`. Checked: A12.
- [x] Validation (finish before start, invalid dates, cycles) blocks; planning issues (outside source window, missed linked milestone, closed day, name conflicts, leadership dates, on hold, staffing after completion, unconfirmed milestones) explain affected records with navigation. `src/domain/issues.ts`.

## Manpower planning

- [x] Weekly entry with daily overrides and timed blocks, multiple shifts, closed days. `manpower-grid.tsx`, `node-panel.tsx`.
- [x] One workforce with progressively detailed allocations; remaining capacity rows; allocation views never add parents again. `src/domain/capacity.ts`. Checked: A04, A05.
- [x] Shared and dedicated crews; split and return without changing total capacity. Checked: A06.
- [x] Leadership scheduling with onsite days and hours, offsite hours separate; calendar and shortening previews; invalid negative/fractional/over-capacity edits blocked with the proposed edit kept. Checked: A08, A09, ops unit tests, e2e fractional input.

## Calculation rules

- [x] Peak concurrent onsite, hours by overlap with local days/weeks, Monday-start weeks, average equivalent = person-hours / calendar hours (n/a when zero), DST-correct intervals, overnight shifts. `src/domain/metrics.ts`, `tz.ts`, `calendar.ts`. Checked: `manpower-cases.json` fixtures, A25, DST tests.
- [x] Division demand uses aligned concurrent peaks; scenarios excluded until promoted. Checked: A13, A24.

## Schedule imports and revisions

- [x] PDF (text), CSV, and XLSX; staged uploaded → extracted → needs review → validated → committed; extraction never writes the plan. `src/server/services/imports.ts`, `python/`, `src/worker`. Checked: A14.
- [x] Review grid beside rendered source pages with IDs, names, hierarchy, durations, dates, markers, issues; corrections, inclusion roles, phase/area/system mappings; recoverable review (saved per edit with session revision). `import-review.tsx`.
- [x] Idempotent commit to a source version; repeat import detection; existing projects can acquire source links; partial failures stay visible. Checked: A15, A16.
- [x] Revision comparison by external ID with added/changed/renamed/removed/duplicate/renumbered handling; removed rows keep linked work; previewed, selected, atomic updates preserving crew sizes, actuals, notes, and mappings. Checked: A16, A17.
- [x] Project documents (schedules, email screenshots, correspondence) as private attachments; reviewed manual milestone tables as their own source lineage (ACE 16 Oct and 23 Oct tables). Setup › Documents, Milestones.

## Reports, exports, and submissions

- [x] Detail levels (project summary, phase overview, ROMP/area, activity detail) × presentations (chart, table, timeline, combined) × PDF/Excel; filters, contents, measure, orientation; saved presets (project or workspace). `src/domain/report.ts`, `src/reporting`.
- [x] Phase overview without detailed allocations (phase dates and overall chart, no invented phase manpower). Checked: A01, A20.
- [x] Identity and layout: company, project, parties, revision, snapshot, prepared by, generated time, sources and basis, legends, repeated headers, page numbers, controlled page breaks, readable multi-page timelines. Checked: A26 automated geometry test.
- [x] Immutable snapshots and issued files; submissions with issue date, recipient, reference, and acknowledged planning items; scenario exports cannot be submitted; nothing is emailed automatically. Checked: A19, A21.

## Progress, baselines, and scenarios

- [x] Manual progress with status rules, actual-date validation, reported percent, notes, history with author and time, explicit audited reopen, on-hold reason and review date that keep reservations flagged. Checked: A18.
- [x] Forecasting unfinished work: remaining dates and staffing, split remaining work keeping the historical start; percent never changes headcount or milestones. Checked: integration split test.
- [x] Baselines (immutable), scenarios from the working plan or a snapshot, comparison of dates, peaks, hours, and issues, promotion with preview as a new revision. Checked: A13.
- [x] History (revisions, audit log) and restoration as a new revision that keeps actual progress. Checked: integration restore test.

## Data and application foundations

- [x] Persistent record groups: workspace and access, project structure (including **optional cost codes** on activities), calendars, source schedules, work plan, workforce, progress, versions and reports, audit and attachments — stable IDs with workspace/project ownership. `prisma/schema.prisma`.
- [x] One calculation engine for screens, previews, PDF charts, and Excel; source inputs persisted, totals computed. Checked: A19.
- [x] Atomic multi-record changes, revision checks with reload or explicit reconciliation. Checked: A23.
- [x] Authentication and server-side authorization; protected files and exports; validated, isolated upload parsing; secrets only in the environment. Checked: A22, e2e auth spec.
- [x] Date-only construction dates, timezone-aware timed staffing, configurable holidays (no downloaded holiday calendar), sort/filter before rendering, not limited to one project or six phases.
- [x] Reproducible setup, configuration reference, migrations, sample project (CMH139 seed and separate illustrative demo), documented and tested backup and restore. [`README.md`](../README.md), AE drill.

## CMH139 initial configuration

- [x] Project with ACE Electric (customer), Gray Construction (GC), AWS (owner); systems fire alarm, VESDA, emergency responder radio, cellular boosting; ERRS/ERRC preserved as aliases. `fixtures/seed/cmh139.preliminary.json`, `src/server/seed/cmh139.ts`.
- [x] Milestone candidates from the 23 Oct table with SWD/NEA/H2C/PFHO for six phases and their ROMP pairs; Phase 1 FEA 27 Sep 2027 only, other FEA blank; the 16 Oct table kept as a separate source (Phase 1 NEA 18 Oct 2027 vs 11 Oct 2027) and flagged for review.
- [x] Tyler Sisia as PM candidate; foreman TBD; no invented staffing, onsite windows, progress, or names. Leadership dates must be selected (planning issue until then).
- [x] Source activity windows P1ER.1140, P1RP.1210, P1CX.2000 verified from the original PDF (A14). Combined electrical rough-in rows are not assigned to this division automatically; inclusion is an operator decision in review (nothing is included by default).

## Deferred (not built, by specification)

Foreman daily reports and photos, actual labor capture, employee scheduling, budgets and cost tracking (beyond the cost code reference), procurement, billing and change orders, native P6/MS Project ingestion, OCR, payroll and accounting sync, offline field operation.
