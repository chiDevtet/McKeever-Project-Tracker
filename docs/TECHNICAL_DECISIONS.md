# Selected technical decisions

Date: 28 October 2026. These choices accompany and resolve the open implementation decisions in `SPEC.md`.

## Product and interface

- Working name: **M&N FieldOps**. Repository slug: `mne-fieldops`.
- Configurable company identity: McKeever & Niekamp Electric.
- Desktop-first web interface, responsive tablet/phone viewing.
- Light neutral canvas, white surfaces, charcoal navigation, restrained company-brand accents. Configurable logo with a text wordmark until an official asset is supplied.
- Weekly manpower grid is the main editing surface; live chart below it; connected Timeline tab; side-panel editing.
- Freeze labels and week headings, support expandable groups and useful bulk operations, and show save/revision state. Colors have text or shape cues.

## Application and data

| Responsibility | Selected implementation |
| --- | --- |
| Web application | Next.js App Router, React, TypeScript |
| Runtime and packages | Supported Node LTS, pnpm, committed lockfile |
| UI | Tailwind CSS and shadcn/ui |
| Planning table | TanStack Table with TanStack Virtual |
| Timeline | Focused Gantt-style manual timeline; domain engine controls calendar and dependency semantics |
| Charts | Accessible SVG or suitable established chart library, using the shared report dataset |
| Persistent database | PostgreSQL |
| Schema and database access | Prisma with migrations |
| Authentication | Better Auth, invite-only email/password; application-enforced project memberships |
| Jobs | pg-boss with a separately running Node worker |
| PDF import | Python pdfplumber invoked by worker; validated JSON boundary |
| PDF report generation | Playwright Chromium and dedicated print templates |
| Spreadsheet handling | ExcelJS for .xlsx data, formatting, and imports |
| Verification | Vitest, real PostgreSQL integration checks, Playwright browser checks |

Choose exact mutually compatible stable versions from current official documentation. Verify the Prisma/Better Auth adapter pair; its examples may target an earlier Prisma major than the newest ORM release. Verify matching Playwright browser and package versions. Pin the choices and record the versions actually used.

Use one TypeScript domain engine for calendars, resource capacity, allocation, report data, and comparisons. PostgreSQL transactions and revision checks govern multi-record edits. Avoid independently stored totals that can disagree. A single repo and simple module/workspace boundaries are sufficient.

## Runtime topology

Production uses a dedicated Ubuntu VPS with Docker Compose for the web app and background worker behind an HTTPS reverse proxy, managed PostgreSQL on Neon, and private R2 object storage. Configure company-controlled accounts and a private GitHub repository when setting up deployment.

Local development uses PostgreSQL and a private filesystem storage adapter. A development-only mail outbox permits invitation and reset verification. Production uses configurable SMTP. Local functional verification must not depend on cloud credentials.

Use storage interfaces so metadata records refer to authorized private objects, not public URLs. Use unique keys for issued exports; app snapshots and issued report objects remain immutable through normal application operations. The design does not assume R2 object-lock capabilities.

Jobs persist state, progress, retries, and idempotency keys. Start with one heavy PDF job at a time. Verify the queue's database connection requirements with Neon pooling and provide a direct connection setting if required by supported queue behavior. Database restore and file recovery are documented separately; a database restore alone does not restore uploaded objects.

## Selected functional defaults

- Monday-start weeks; America/New_York initial timezone.
- Monday-Friday, eight-hour working days with effective-dated exceptions and shifts.
- Peak concurrent onsite headcount as default weekly chart; installer and leadership series; hours shown separately.
- Optional average equivalent staffing uses project calendar hours and is explicitly labeled.
- Whole-day resource reservations by default; timed blocks for partial days and multiple shifts.
- Nested reservations subdivide existing workforce. Explicit workforce increases are separate actions.
- Reject invalid capacity allocations. Date uncertainties may remain in drafts and are shown before a formal submission is recorded.
- Finish-to-start activity links with working-day lag. Movement and source-date updates are previewed before applying.
- PDF and CSV/Excel imports; scanned-PDF fallback is explicit. OCR and native P6/MS Project adapters are later scope.
- Employee/personnel records are independent of login accounts; Tyler operates first, ownership/office access follows through invitations.

## Release order

1. Persisted project/calendar/people/manpower foundation and core calculation checks.
2. Manual schedule and timeline, shared/dedicated allocations, named leadership, preview/apply.
3. Complete preliminary PDF/Excel submission workflow and immutable report records.
4. Real guided imports, source mappings, revision comparison, and idempotent jobs.
5. Progress, scenarios, division demand, accounts/permissions, history, and operational documentation.
6. Acceptance verification and fixes across the full agreed release.

No additional product-scope decision is required to begin local implementation. Hosting credentials, production domain, SMTP settings, and actual staffing/date inputs remain deployment/operator configuration rather than invented defaults.
