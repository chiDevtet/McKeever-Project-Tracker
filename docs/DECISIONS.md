# Decision log

Implementation decisions made while building the first release, in addition to [`TECHNICAL_DECISIONS.md`](TECHNICAL_DECISIONS.md). Each entry gives the decision and why.

## Architecture and data

| # | Decision | Reason |
| --- | --- | --- |
| D01 | Single pnpm package with folder boundaries (`src/domain`, `src/server`, `src/reporting`, `src/worker`, `src/app`), enforced by ESLint `no-restricted-imports` so the domain and reporting code cannot import server or UI modules. | Simple module boundaries were judged sufficient; the shared engine stays pure and testable. |
| D02 | A plan is loaded into one in-memory `PlanData` shape. Plan-scoped records (activities, nodes, entries, leadership, calendars) are keyed by a stable lineage `key`; project structure (phases, areas, systems, milestones) by database id. | Keys survive copying a plan into a scenario or snapshot, which makes comparison, promotion, and restore straightforward diffs. |
| D03 | All plan edits are serializable **plan ops** (Zod-validated). The client applies them optimistically; the server applies the same ops in one transaction, validates, writes only the differences, records a `PlanRevision` and audit event. | One code path for every edit; a failure anywhere rolls back everything (A23). |
| D04 | Stale-edit detection: `UPDATE "Plan" SET revision = revision + 1 WHERE id = ? AND revision = ?` is the first statement of every mutation. It both detects stale editors and serializes concurrent writers on the plan row. The "before" state handed to hooks reports the prior revision. | No silent overwrite; exactly one of several concurrent saves from the same revision wins. |
| D05 | On a stale save the editor shows **Newer revision saved elsewhere** with *Reload and discard* or *Reload and re-apply my change* (re-validated on the newer data). | The specification asks for reload or explicit reconciliation, not silent merging. |
| D06 | Capacity is a tree per workforce pool: the POOL root supplies headcount; reservations and dedicated crews subdivide it; a sweep over every instant checks children never exceed their parent. Headcount is taken from roots only. | Nested allocations can never duplicate capacity (A04–A07). |
| D07 | Validation blocks only **new** capacity violations relative to the previous state, plus structural errors. Pre-existing conflicts (for example after a calendar change) appear as planning issues. | A user can always fix one problem at a time without being blocked by an unrelated older one. |
| D08 | Staffing expands to timezone-aware intervals using `Intl` (DST gap resolves forward, ambiguous times take the first occurrence). Hours are attributed by overlap with each local day and week; overnight shifts keep their shift-start date for staffing but split hours at midnight for reporting. | Correct hours across DST and overnight shifts (A25). |
| D09 | Leadership is counted once per named person across all their responsibilities and projects; TBD placeholders are never merged or flagged as conflicts. Offsite management hours are stored separately and never enter onsite headcount. | A10, A24. |
| D10 | Progress (`ActivityProgress`) is project-scoped by activity key, not plan-scoped. | Actual dates are facts shared by the working plan and its scenarios; promotion and restore can never roll them back. |
| D11 | Snapshots store a self-contained JSON copy of the plan with a SHA-256 of its canonical form. Database triggers reject updates to snapshot data, submissions, issued reports, and immutable files. | Issued submissions stay frozen even against direct SQL (A21). |
| D12 | Promotion and restore replace the working plan's schedule, staffing, allocations, leadership, and calendars through the normal mutation path (validated, new revision), after saving a `REVISION_BACKUP` snapshot of the prior state. References to project records deleted since the snapshot are cleared rather than restored. | Never rewrites baselines or submissions; history is preserved (A13). |
| D13 | The Prisma client and Better Auth instance are created on first use (a proxy and `getAuth()`). | `next build` and Docker builds need no database URL or secrets. Found when the first clean Docker build failed. |
| D14 | Python extraction and page rendering live in a worker-only module; the web bundle imports only schemas and spreadsheet parsing. | Keeps Python out of the web image and keeps the standalone build from tracing the whole project. |

## Imports

| # | Decision | Reason |
| --- | --- | --- |
| I01 | The PDF extractor anchors columns per page on header labels, de-duplicates characters only at identical positions, detects WBS summary rows from overprinting (bold) plus the ID-column rule, and reports dates inside names as metadata only. It runs pages in parallel (fork pool) and streams progress. | Correct rows on the CMH139 fixture (1,925 rows, 0 issues, the three expected windows exact) in about 23 s. An earlier 1-point de-duplication dropped letters ("Wall" → "Wal"). |
| I02 | Extraction output crosses a validated JSON boundary (Zod) and runs with `python -I`, a minimal environment (no secrets), a temp directory, a timeout, and an output size limit. | Uploaded files and extracted text are data, never instructions. |
| I03 | Page previews are rendered by pdfium into private storage alongside extraction, and the review grid shows the page image with the selected row highlighted; the browser PDF viewer is only a fallback. | Embedded PDF viewers are unreliable (and absent in headless browsers). |
| I04 | A committed source version keeps **every** source row; rows not selected during review are flagged `included = false`. | Otherwise the next import reports thousands of rows as "added". Found when re-importing the identical PDF. |
| I05 | Rows carry the prior version's review by external ID. A duplicated ID carries to every copy, and a possible renumbering carries from its candidate, so a reviewed row that became ambiguous stays included and blocks validation until resolved. | "Ambiguous IDs require review" (A16). Found when a renumbered row slipped through as unselected. |
| I06 | Renumbering is proposed when an added row's name matches a removed row; resolving "same activity as" records the old ID as removed with an ID change and moves its source links. | Keeps installation links through GC renumbering. |
| I07 | Applying a source change goes through the same move preview used for manual moves; the shared workforce pool is unselected by default. | Only the staffing and successors the operator selects move (A17). |

## Reports

| # | Decision | Reason |
| --- | --- | --- |
| R01 | One `buildReportDataset` feeds the in-app preview (an iframe rendering the same React document), the worker PDF (static markup in Chromium with JavaScript disabled and all network requests aborted), and the ExcelJS workbook. Both formats of one generation share a dataset hash. | A19. |
| R02 | Pages are laid out explicitly as fixed Letter pages with repeated table headers and page numbers. Row heights are estimated from wrapped text length per column width. An integration test renders every detail level × presentation × orientation with long content and fails on any overflow, missing header row, or missing page number. | Found real overflow in long activity tables; the estimate was corrected. |
| R03 | Allocation views with nothing allocated report "not allocated" rather than zero. | A20. |
| R04 | The chart uses a validated two-series palette (installers `#2a78d6`, leadership `#eb6834`), stacked columns with a surface gap, a legend, selective peak label, and a hatch texture for print/CVD. | Accessible, legible in print. |
| R05 | A scenario export is labeled exploratory and cannot be recorded as a formal submission. Recording a submission requires acknowledging every open planning item, stored with the submission. | Specification: distinguish exploratory exports from submissions. |

## Security and operations

| # | Decision | Reason |
| --- | --- | --- |
| S01 | Inaccessible projects and files return 404 (not 403) so their existence is not disclosed; read-only roles get 403 on writes. | A22. |
| S02 | Invitations store only a token hash; links go only to the mail transport. The first administrator is created by a CLI that prints the link to the terminal; there is no default password. | Prompt requirement. |
| S03 | The development mail outbox page exists only when `MAIL_TRANSPORT=outbox`, `APP_ENV=development`, and the server is not a production build; production configuration refuses the outbox. | Reset links must never be reachable or logged in production. |
| S04 | File downloads are access-checked route handlers with `no-store`, `nosniff`, and a restrictive CSP; uploads are type- and size-limited and same-origin checked. | Private files. |
| S05 | Docker: separate web (Node slim, non-root) and worker (Playwright image with Chromium, Python venv with pinned pdfplumber, non-root) targets; Caddy for automatic HTTPS; a one-off migrate service. Optional build secret and apt mirror for proxied networks. | Prompt topology; verified by building and running the stack. |
| S06 | Backups are pg_dump custom format plus a storage archive with checksums; a verify command re-hashes files, re-checks snapshot hashes, and compares counts and plan totals with the source. | A database restore alone does not restore files; the drill must be checkable. |

## Testing

| # | Decision | Reason |
| --- | --- | --- |
| T01 | Integration tests and browser tests use a disposable database (`TEST_DATABASE_URL`) that the setup drops, migrates, and seeds; they refuse to run if it equals `DATABASE_URL`. | Real PostgreSQL behavior (transactions, triggers, constraints) without risk to development data. |
| T02 | Browser tests run against `next start` plus the worker, started by the Playwright global setup after the database reset. | Exercises the production build and real background jobs. |
| T03 | Illustrative eight-person cases live only in tests and in the separate `DEMO-A`/`DEMO-B` seed. | CMH139 must not receive invented staffing. |

## Theme (soft dark default)

| # | Decision | Reason |
| --- | --- | --- |
| U01 | One set of semantic tokens in `globals.css` (`:root` light, `.dark` soft dark), including new `field`, `overlay`, `brand-line`, timeline bar, and chart tokens. Components use tokens rather than fixed light-only colors. | Every route and shared component themes consistently; light stays a complete alternative. |
| U02 | Soft dark is the default. The preference is a cookie (`fieldops_theme`) read by the root layout, so the server renders the correct `<html>` class: no flash and no hydration mismatch, even without JavaScript. It is mirrored in localStorage; a tiny head script restores it if only localStorage survives. | Next 16 `beforeInteractive` inline scripts run through the client runtime, possibly after first paint; a server-rendered class cannot flash. |
| U03 | The workspace brand color is written to `:root` by the authenticated layout. Brand backgrounds keep white text; brand-colored lines, text, and focus rings use `--brand-line`, a lighter brand mix in dark mode. | The brand was previously set on an inner element, so `--primary`, the focus ring, and portaled dialogs ignored a custom brand; the dark default brand blue is too dark for lines on dark surfaces. |
| U04 | Dark chart series are separate validated steps (installers `#468de0`, leadership `#e56b35`, passing every palette check on `#2d343d`); light keeps `#2a78d6` / `#eb6834`. The shared chart reads `var(--token, lightHex)`, so the app themes it while PDF and Excel images keep the light print palette. | One chart component for screen and export, readable on both surfaces. |
| U05 | Contrast was measured, not eyeballed: text and status colors meet 4.5:1 on their surfaces; field borders and timeline bars meet 3:1 against the surface. A browser test scans key pages and a dialog in both themes for text below AA. | Readability in both themes. |

## CMH139 phases and planned staffing

| # | Decision | Reason |
| --- | --- | --- |
| C01 | `seedCmh139` is a reconciliation, not a create-once seed: records are found by stable identity (project code, phase key or name, ROMP code, milestone phase + code, source label + date, reservation key) and only missing pieces are added. The project is never deleted or recreated. | The previous early return left older databases with an incomplete phase set. |
| C02 | Phase windows, schedule milestones (SWD and PCO with external IDs and pages), and planned headcount live in a new fixture, `fixtures/seed/cmh139.phase-plan.json`, verified against the schedule PDF's Contract Milestones (pages 1–3). The original candidates fixture is unchanged (its checksum is in `MANIFEST.json`). | Provenance stays explicit; the handoff fixture stays verifiable. |
| C03 | Phase windows run from the Start Work Date (Gray Early Start Work Date for Phases 3–6, kept in the source-value note) through PCO. PCO is added as a schedule-sourced candidate. FEA is dated only for Phase 1; Phases 2–6 keep FEA as "not specified". The Phase 1 NEA discrepancy stays exactly two source values (no schedule value is added to NEA). | Source fidelity; no reconciliation of conflicting sources by the seed. |
| C04 | Each phase gets one RESERVATION node (`cmh139-phase-N-installers`) of 8 under the shared installer pool. Weeks wholly inside the window use a WEEK entry; boundary weeks use DAY entries for in-window working days only, so nobody is scheduled outside the window even if the calendar later opens a weekend day. | Exact windows with the existing staffing-entry model. |
| C05 | The pool's capacity inside the phase-plan range is derived from the reservations it supplies (sum of each direct reservation's daily peak, WEEK where uniform, DAY otherwise), so overlapping phases give 8 × active phases and any other crews under the pool stay covered. | Capacity conservation without a flat 8 or invented totals. |
| C06 | Staffing changes go through `mutatePlan` (validated, new revision, audited) with a system actor. A seed reservation whose entries differ from the plan is treated as operator-edited and left as is; an operator-set phase window is kept and logged. | Seed-owned data is updated; operator edits are preserved. |

