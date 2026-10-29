# M&N FieldOps

Construction manpower and scheduling for McKeever & Niekamp Electric's fire alarm and low-voltage division. The first configured project is **AWS CMH139** (customer ACE Electric, general contractor Gray Construction, owner AWS).

FieldOps plans weekly installer staffing and named leadership against project calendars, keeps nested allocations from double-counting people, imports and compares GC schedule revisions, records manual progress, branches scenarios, forecasts combined division demand, and issues frozen PDF and Excel manpower submissions.

- Functional requirements: [`docs/SPEC.md`](docs/SPEC.md)
- Selected technical decisions: [`docs/TECHNICAL_DECISIONS.md`](docs/TECHNICAL_DECISIONS.md)
- Decision log for this build: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Implementation checklist: [`docs/IMPLEMENTATION_CHECKLIST.md`](docs/IMPLEMENTATION_CHECKLIST.md)
- Acceptance evidence (A01–A26): [`docs/ACCEPTANCE_EVIDENCE.md`](docs/ACCEPTANCE_EVIDENCE.md)
- Build status and resume point: [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md)

## Contents

1. [What is in the app](#what-is-in-the-app)
2. [Architecture](#architecture)
3. [Local setup](#local-setup)
4. [Running](#running)
5. [First administrator and users](#first-administrator-and-users)
6. [Configuration reference](#configuration-reference)
7. [Imports](#imports)
8. [Exports and where files live](#exports-and-where-files-live)
9. [Storage, database, and mail adapters](#storage-database-and-mail-adapters)
10. [Deployment (Ubuntu VPS, Docker Compose, HTTPS)](#deployment-ubuntu-vps-docker-compose-https)
11. [Backup and restore](#backup-and-restore)
12. [Testing and checks](#testing-and-checks)
13. [Scripts](#scripts)
14. [Known limitations](#known-limitations)

## What is in the app

| Area | Highlights |
| --- | --- |
| Division dashboard | Aligned concurrent peak across live working plans (never the sum of separate peaks), named-person conflicts, availability limits (shown as "not set" when absent). |
| Manpower | Virtualized weekly grid (TanStack Table + Virtual) with frozen labels, keyboard entry, fill/bulk tools, nested reservations and dedicated crews, day overrides and timed blocks, leadership rows, project totals, and an accessible SVG chart. Every edit saves with a visible revision. |
| Schedule | Activities with working-day durations, finish-to-start links with lag (cycles rejected), Gantt-style timeline with drag/resize, move previews that let you choose which staffing moves. |
| Progress | Not started / In progress / Complete / On hold with actual-date rules, reported percent, notes, history with author and time, explicit reopen, split remaining work. |
| Imports | Text PDF (Primavera-style), CSV, and Excel. Background extraction, review grid beside rendered source pages, corrections and mappings, idempotent commit to a source version, revision comparison (added/changed/renamed/removed/duplicate/renumbered), and selected, previewed updates to linked work. |
| Reports | One dataset feeds the in-app preview, the PDF (Playwright Chromium, trusted templates), and the .xlsx (ExcelJS). Presets, detail levels, presentations, frozen snapshots, and formal submissions with issue acknowledgment. |
| Plans & history | Baselines, scenarios (copy, compare, promote), restore, working revisions, audit log. |
| People / Settings | Personnel (separate from logins), invite-only users with project roles, branding, roles, milestone codes, availability limits, configuration status. |

Roles: **Administrator** (everything), **Project manager** (edit assigned projects), **Internal viewer** and **Foreman viewer** (read assigned projects and download their reports). Every server operation checks access itself; a project you cannot access is reported as not found.

## Architecture

```
Browser ──HTTPS──> Caddy ──> web (Next.js 16 standalone, App Router, route handlers, RPC)
                                 │            │
                                 │            └── private storage (local FS | Cloudflare R2)
                                 ▼
                           PostgreSQL (Neon in production)  <── worker (pg-boss consumer)
                                                                   ├─ Python pdfplumber/pdfium (extraction, page previews)
                                                                   └─ Playwright Chromium (PDF reports), ExcelJS
```

| Folder | Responsibility |
| --- | --- |
| `src/domain` | Pure TypeScript engine shared by screens, previews, PDF, and Excel: dates and timezones, calendars, capacity trees, staffing expansion, metrics, scheduling, plan ops and validation, planning issues, division demand, comparisons, report dataset. No I/O. |
| `src/server` | Prisma client, Better Auth, authorization, audit, plan store (atomic, revision-checked mutations), snapshots, storage and mail adapters, job queue, services, RPC registry. |
| `src/reporting` | Trusted print templates, SVG chart, workbook builder. |
| `src/worker` | pg-boss consumer: extraction and report rendering; health endpoint `:3100/healthz`. |
| `src/app`, `src/components` | Next.js pages, route handlers, UI. |
| `python/` | `extract_schedule.py` (text PDF → validated JSON), `render_pages.py` (page previews). |
| `prisma/` | Schema and migrations (including immutability triggers for snapshots, submissions, issued reports, and files). |

Pinned versions actually used: Node 22 LTS (22.22 in images; `>=22.12` required), pnpm 10.28.0, Next.js 16.4.3, React 19.2.9, TypeScript 5.9.3, Tailwind CSS 4.3.3, TanStack Table 8.21.3 / Virtual 3.14.23, Prisma 7.10.1 with `@prisma/adapter-pg`, Better Auth 1.7.14 (Prisma adapter), pg-boss 12.38.0, Playwright 1.63.0 (Chromium image `mcr.microsoft.com/playwright:v1.63.0-noble`), ExcelJS 4.4.0, Zod 4.6.7, Vitest 4.1.12, PostgreSQL 16, Python 3.12 with pdfplumber 0.11.10.

## Local setup

Prerequisites: Node.js 22 LTS, pnpm 10 (`npm i -g pnpm@10.28.0`), PostgreSQL 16, Python 3.10+ with pip. Chromium for reports is installed by Playwright.

```bash
pnpm install
```

```bash
python3 -m pip install -r python/requirements.txt
```

```bash
pnpm exec playwright install chromium
```

Create a database role and two databases (one for development, one disposable database for tests):

```bash
sudo -u postgres psql -c "CREATE ROLE fieldops LOGIN PASSWORD 'fieldops_dev' CREATEDB;"
```

```bash
sudo -u postgres createdb -O fieldops mne_fieldops && sudo -u postgres createdb -O fieldops mne_fieldops_test
```

Configure the environment and apply migrations and the CMH139 seed:

```bash
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` in `.env` (for example from `openssl rand -base64 32`), then:

```bash
pnpm db:migrate && pnpm db:seed
```

The seed is idempotent. It creates the workspace, CMH139 with its systems (fire alarm, VESDA, emergency responder radio, cellular boosting; ERRS/ERRC kept as source aliases), six phases, milestone **candidates** with their sources (including the Phase 1 NEA disagreement between the 16 Oct and 23 Oct correspondence), Tyler Sisia as PM candidate, the foreman as TBD, and attaches the original schedule PDF as a document without importing it. It invents no staffing, onsite windows, progress, or names.

Optional illustrative training data, clearly separate from CMH139 (projects `DEMO-A` and `DEMO-B`; requires an administrator to exist):

```bash
pnpm db:seed:demo
```

## Running

Two processes: the web app and the worker (extraction and report rendering run only in the worker).

```bash
pnpm dev
```

```bash
pnpm dev:worker
```

Open <http://localhost:3000>. Production-style local run:

```bash
pnpm build && pnpm start
```

```bash
pnpm worker
```

The worker processes one heavy PDF job at a time (`WORKER_HEAVY_CONCURRENCY=1`) and reports health at `http://localhost:3100/healthz`.

## First administrator and users

There is no default account or password. Create the first administrator from a terminal on the server:

```bash
pnpm admin:bootstrap --email tyler@example.com --name "Tyler Sisia"
```

It prints a one-time link (valid seven days) to that terminal only. Open it, choose a password (12+ characters), and you are signed in. The command refuses to run once an administrator exists unless `--force` is given for recovery.

Administrators invite everyone else from **People → Invite user**, choosing a workspace role and per-project roles. Invitation and password-reset links go only to the mail transport:

- Development (`MAIL_TRANSPORT=outbox`): messages are stored in the database and shown at <http://localhost:3000/dev/outbox>. That page exists only under `pnpm dev` with `APP_ENV=development`; it returns 404 in any production build.
- Production (`MAIL_TRANSPORT=smtp`): delivered by SMTP. Links are never written to logs.

Forgotten passwords: **Forgot password** on the sign-in page sends a one-hour reset link; resetting ends the user's other sessions. Disabling a user (People) ends their sessions immediately.

## Configuration reference

All configuration comes from the environment (`.env` locally, `.env.production` on the server). Nothing secret is committed. See [`.env.example`](.env.example) and [`.env.production.example`](.env.production.example).

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | yes | Public base URL (links in mail, auth origin). |
| `APP_ENV` | no | `development` (default), `test`, or `production`. Production refuses the mail outbox. |
| `DATABASE_URL` | yes | Runtime connection. On Neon use the **pooled** host (`…-pooler…`). |
| `DIRECT_DATABASE_URL` | Neon: yes | **Direct** (non-pooled) connection for Prisma migrations and the pg-boss queue (needs session features PgBouncer transaction pooling lacks). Locally the same as `DATABASE_URL`. |
| `TEST_DATABASE_URL` | tests | Disposable database that integration and browser tests erase. Must differ from `DATABASE_URL`. |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes. |
| `STORAGE_DRIVER` | no | `local` (default) or `r2`. |
| `LOCAL_STORAGE_DIR` | local | Private directory for files (default `./.data/storage`). |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | r2 | Private Cloudflare R2 bucket (S3 API). `R2_ENDPOINT` defaults to the account endpoint. |
| `MAIL_TRANSPORT` | no | `outbox` (development only) or `smtp`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | smtp | SMTP delivery. |
| `PYTHON_BIN` | worker | Python with pdfplumber (default `python3`). |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | no | Use a specific Chromium for reports. |
| `WORKER_HEAVY_CONCURRENCY` | no | Heavy PDF jobs at a time (default 1). |
| `WORKER_HEALTH_PORT` | no | Worker health port (default 3100). |
| `FIELDOPS_PDF_PROCESSES` | no | Parallel page processes for extraction (default up to 4). |

## Imports

**Project → Imports.** Choose a file (text-based PDF, CSV, or .xlsx), a source lineage (for example "Gray Construction master schedule"), a version label, and the source date.

1. **Uploaded → Extracted.** The worker extracts rows in the background (about 30 s for the 59-page CMH139 fixture) and renders page images. Nothing in the plan changes.
2. **Needs review.** The review grid shows page, activity ID, reviewed name, start and finish, original duration, `A`/`*` markers, WBS path, and the comparison with the prior version, beside the rendered source page with the selected row highlighted. Search with `|` for alternatives (for example `Fire Alarm | VESDA | ERRS | ERRC`), include rows as our scope, external prerequisites, or reference, correct names and dates, and map rows to phases, areas, and systems. Edits save with a session revision so two reviewers cannot overwrite each other.
3. **Validated → Committed.** Validation blocks missing IDs, duplicate included IDs, finish-before-start, and unresolved possible renumbering. Commit creates an immutable source version. Every source row is kept (unselected rows flagged), so the next import compares against the whole schedule. Re-importing identical bytes is flagged and produces no changes.
4. **Use the version.** From **Source versions**, create installation activities from selected rows (one source row may support several activities) or, when linked rows changed, **Review source changes for the plan**: choose per activity, pick shift-with-source or align-to-source, then preview successors and staffing before applying atomically. Crew sizes, actual dates, notes, and mappings are preserved. Removed source rows are flagged for disposition; linked work is never deleted.

Scanned PDFs (no extractable text) and unsupported layouts fail with a clear issue and the supported fallbacks: import a CSV/Excel export, or enter activities on the Schedule tab. OCR and native P6/MS Project formats are out of scope.

## Exports and where files live

**Project → Reports.** Pick a preset or settings (detail: project summary, phase overview, ROMP/area, activity detail; presentation: chart, table, timeline, combined; filters; contents; measure), check the live preview, and **Generate PDF + XLSX**. Generation captures an immutable snapshot of the plan; both files come from that one snapshot and dataset. Excel keeps dates as dates and counts as numbers and adds a report-basis sheet. **Record submission** marks files issued (issue date, recipient, reference) after you acknowledge open planning items; it never emails ACE.

Files are private objects referenced by metadata rows, never public URLs. Downloads go through `GET /api/files/<id>`, which checks project access every time.

| Object | Storage key |
| --- | --- |
| Uploaded schedules | `<workspace>/<project>/source_schedule/<file-id>/<name>` |
| Attachments | `<workspace>/<project>/attachment/<file-id>/<name>` |
| Report PDF / XLSX | `<workspace>/<project>/report_pdf|report_xlsx/<file-id>/<name>` |
| Logo | `<workspace>/workspace/logo/<file-id>/<name>` |
| Import page previews | `previews/<source-file-id>/page-<n>.png` |

Keys are written once and never overwritten. With `STORAGE_DRIVER=local` they are under `LOCAL_STORAGE_DIR`; with `r2` they are in the private bucket.

## Storage, database, and mail adapters

- **Local storage** writes atomically with no overwrite, rejects unsafe keys, and is the development default.
- **Cloudflare R2**: create a private bucket and an API token scoped to it; set `STORAGE_DRIVER=r2` and the `R2_*` variables. Writes use `If-None-Match: *` so issued objects are not replaced. Object lock is not assumed; enable bucket versioning if you want object-level recovery.
- **Neon PostgreSQL**: create the project and database, then use the pooled connection string for `DATABASE_URL` and the direct one for `DIRECT_DATABASE_URL` (migrations and pg-boss need the direct connection). Both should include `sslmode=require`.
- **SMTP**: any provider; set `MAIL_TRANSPORT=smtp` and the `SMTP_*` variables. Production refuses to start with the outbox.

## Deployment (Ubuntu VPS, Docker Compose, HTTPS)

The repository does not create cloud accounts or deploy anything. To deploy on a company-controlled VPS:

1. Provision an Ubuntu 24.04 VPS (2 vCPU / 4 GB RAM is comfortable), install Docker Engine with the Compose plugin, point a DNS name at it, and open ports 80 and 443.
2. Create the Neon database, the private R2 bucket and token, and SMTP credentials.
3. Clone the private repository on the VPS, then create the production environment file:

```bash
cp .env.production.example .env.production && chmod 600 .env.production
```

4. Fill in `APP_DOMAIN`, `APP_URL=https://<domain>`, both Neon URLs, `BETTER_AUTH_SECRET`, `R2_*`, and `SMTP_*`.
5. Build and start (a one-off `migrate` service applies migrations before web and worker start):

```bash
docker compose --env-file .env.production up -d --build
```

6. Seed CMH139 once and create the first administrator (the link prints only to your terminal):

```bash
docker compose --env-file .env.production run --rm --no-deps worker pnpm db:seed
```

```bash
docker compose --env-file .env.production run --rm --no-deps worker pnpm admin:bootstrap --email you@company.com --name "Your Name"
```

Services: `caddy` (automatic HTTPS certificates for `APP_DOMAIN`, HSTS, 70 MB request limit, see [`deploy/Caddyfile`](deploy/Caddyfile)), `web` (Next.js standalone on port 3000, health check `/login`), `worker` (Chromium + Python, health check `:3100/healthz`, 512 MB shared memory, 2 GB memory limit), and `migrate`. The `local-db` profile adds a PostgreSQL 16 container for trials and restore drills; production uses Neon.

Updating: pull the new commit and rerun `docker compose --env-file .env.production up -d --build`; migrations run first. Logs: `docker compose logs -f web worker`.

Behind a TLS-intercepting proxy, the build accepts the proxy CA as an optional secret and an HTTPS apt mirror, without changing normal builds:

```bash
docker build --secret id=build_ca,src=/path/to/ca.pem --build-arg APT_MIRROR=https://archive.ubuntu.com/ubuntu/ --target worker .
```

## Backup and restore

A database restore alone does not restore uploaded files; back up both.

```bash
ENV_FILE=.env.production scripts/backup.sh /secure/backups
```

This writes `fieldops-<UTC timestamp>/` with `database.dump` (pg_dump custom format), `storage.tar.gz` (local storage) or `storage/` (R2 via rclone when `RCLONE_REMOTE` is set; otherwise it warns), `manifest.txt`, and `SHA256SUMS`. It needs a PostgreSQL 16+ client (included in the worker image). Keep backups encrypted and off the VPS; schedule it with cron or a systemd timer. On Neon, point-in-time restore is also available.

Restore into an empty database and storage location with the services stopped, then verify:

```bash
ENV_FILE=.env.restore scripts/restore.sh /secure/backups/fieldops-<timestamp>
```

```bash
pnpm backup:verify --compare "<source database url>"
```

`restore.sh` checks the checksums, runs `pg_restore`, applies any newer migrations, and extracts storage (refusing a non-empty directory unless `FORCE_STORAGE=1`). `backup:verify` re-hashes every stored file, re-checks every snapshot's data hash, reloads every working plan and computes its totals, and with `--compare` checks row counts and totals against the source. A tested drill is recorded in [`docs/ACCEPTANCE_EVIDENCE.md`](docs/ACCEPTANCE_EVIDENCE.md).

## Testing and checks

| Command | What it runs |
| --- | --- |
| `pnpm typecheck` | TypeScript, no emit. |
| `pnpm lint` | ESLint (Next.js core web vitals + TypeScript; domain/reporting import boundaries). |
| `pnpm test` | Vitest unit tests for the domain engine, including `fixtures/expected/manpower-cases.json`. |
| `pnpm test:integration` | Vitest against real PostgreSQL at `TEST_DATABASE_URL` (wiped, migrated, and seeded first): imports with the real PDF fixture, progress, scenarios, reports and submissions, page overflow across every export style, persistence, conflicts, atomicity, access isolation, jobs. |
| `pnpm test:e2e` | Playwright against a production build plus the worker on `E2E_PORT` (default 3210) using the test database: sign-in, password reset, grid editing, stale-window reconciliation, PDF import, report downloads, viewer isolation and revocation, phone/tablet overflow. Set `E2E_SKIP_BUILD=1` to reuse a build. |
| `pnpm check` | typecheck + lint + unit tests. |
| `pnpm build` | Production build (needs no secrets or database). |

All commands exit non-zero on failure.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev`, `pnpm dev:worker` | Development web server and worker (watch mode). |
| `pnpm build`, `pnpm start`, `pnpm worker` | Production build, web server, worker. |
| `pnpm db:migrate` | Apply migrations (`prisma migrate deploy`). |
| `pnpm db:migrate:dev` | Create a migration during development and regenerate the client. |
| `pnpm db:seed` | Idempotent CMH139 seed (production-safe). |
| `pnpm db:seed:demo` | Separate illustrative DEMO-A/DEMO-B training data. |
| `pnpm admin:bootstrap` | First administrator invitation link (terminal only). |
| `pnpm backup`, `pnpm backup:restore`, `pnpm backup:verify` | Backup, restore, verification. |

## Known limitations

- PDF extraction targets text-based Primavera-style layouts (header-anchored columns). Scanned PDFs need a CSV/Excel export or manual entry; OCR and native P6/MS Project files are later scope.
- Report pagination estimates row heights from text length; an automated check renders every detail level, presentation, and orientation and confirms nothing overflows a page, but unusually long single words may still wrap differently.
- Progress percentages are reported values; actual labor capture and daily foreman reports are not in this release (records carry stable IDs for them).
- Availability limits are anonymous headcounts by role; they do not prove specific employees are available.
- The in-browser PDF fallback (for imports from before page previews existed) depends on the browser's PDF viewer.
- R2 backups need an rclone remote; without one the backup script warns and copies only the database.
- No cloud resources, DNS, or SMTP accounts are created by this repository; they are deployment configuration.
