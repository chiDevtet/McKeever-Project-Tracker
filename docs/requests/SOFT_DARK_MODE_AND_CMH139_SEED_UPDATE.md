# M&N FieldOps — Soft Dark Mode + CMH139 Seed Correction

Implement these changes in the existing repository. Do not rebuild the app or replace its domain model. Inspect current components, services, tests, and conventions before editing.

## Goals
1. Add a polished, moderately dark theme and make it the default.
2. Keep a user-accessible Light/Dark toggle and persist the selection across reloads and sessions.
3. Ensure CMH139 has all six schedule phases, including existing databases seeded previously with an incomplete phase set.
4. Add planned installer headcount of **8 per phase**, aligned to each phase's actual schedule window. This is planned headcount, not eight named/identified employees.

## Existing repository facts
- Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, Prisma 7, PostgreSQL, pnpm.
- Theme tokens: `src/app/globals.css`; root document: `src/app/layout.tsx`; authenticated shell: `src/app/(app)/layout.tsx`; navigation: `src/components/shell/app-nav.tsx`.
- Dark variant already declared in CSS: `@custom-variant dark (&:is(.dark *))`.
- CMH139 fixture: `fixtures/seed/cmh139.preliminary.json`; production seed: `src/server/seed/cmh139.ts`.
- The fixture already has six phases. Production seed currently requires `workforcePlans: []`, and creates only a shared installer POOL with no phase reservations or weekly headcount.
- Critical bug: `seedCmh139()` returns immediately when CMH139 already exists, leaving the existing project unchanged. This can explain why a database still displays an older/partial phase set. Implement safe, idempotent reconciliation/upserts; do not delete/reset the project or database.
- Do not use the illustrative `scripts/seed-demo.ts` data for real CMH139.
- Original schedule: `fixtures/source/CMH139_Preliminary_Schedule_2026-10-15.pdf` (59 pages). Use its dates, not invented dates.

## A. Moderately dark default theme
Create a cohesive “soft dark” palette: roughly two-thirds of the way to true black. Aim for refined charcoal/slate surfaces, not OLED black.

Suggested starting tokens (adjust for contrast and consistency):
- Canvas `#242a31`
- Main cards/planning surfaces `#2d343d`
- Elevated dialogs/popovers `#343d47`
- Primary text `#e7ebef`
- Secondary text `#aab4bf`
- Borders `#46515d`
- Inputs `#303943`
- Sidebar `#191f26`
- Muted surface `#343d47`
- Retain the configurable brand blue `--brand` as the primary accent.

Requirements:
- Dark is the default for users with no saved preference, including first visit.
- Provide a visible Light/Dark control in Settings and/or user navigation.
- Persist explicit user selection (localStorage is acceptable unless an existing preference mechanism is better). Saved Light must override the dark default.
- Prevent a flash of the wrong theme before hydration. Apply the initial theme before paint; avoid hydration mismatch warnings.
- Theme every route and shared component: dashboard, project pages, schedule/manpower tables, forms, inputs, selects, dialogs, sheets, dropdowns, tooltips, toasts, charts, empty/loading states.
- Replace hard-coded light-only colors where they break the theme. Prefer semantic CSS variables/classes over scattered one-off colors.
- Keep the existing charcoal navigation compatible; do not turn everything pure black.
- Light remains a complete readable alternate.
- Preserve layout, information density, and brand. Check contrast, focus, disabled, validation and status states; do not rely on color alone.

## B. CMH139 — six phases and exact schedule windows
The PDF Contract Milestones section (pages 1–3) lists these phases and ROMP groups. The phase windows below run from Start Work Date through PCO finish:

| Phase | ROMP areas | Start Work Date | PCO / finish |
|---|---|---:|---:|
| Phase 1 | ROMP01 & ROMP03 | 2027-05-20 | 2027-12-10 |
| Phase 2 | ROMP02 & ROMP04 | 2027-05-31 | 2028-01-21 |
| Phase 3 | ROMP05 & ROMP07 | 2027-05-31 | 2028-02-18 |
| Phase 4 | ROMP06 & ROMP08 | 2027-06-18 | 2028-03-17 |
| Phase 5 | ROMP09 & ROMP11 | 2027-07-23 | 2028-04-14 |
| Phase 6 | ROMP10 & ROMP12 | 2027-08-27 | 2028-04-28 |

Preserve the schedule milestone candidates and provenance:
- Phase 1: SWD 2027-05-20; FEA 2027-09-27; NEA 2027-10-11; H2C 2027-10-29; PFHO 2027-11-26; PCO 2027-12-10.
- Phase 2: SWD 2027-05-31; NEA 2027-11-29; H2C 2027-12-17; PFHO 2028-01-07; PCO 2028-01-21.
- Phase 3: SWD / Gray Early Start 2027-05-31; NEA 2027-12-27; H2C 2028-01-14; PFHO 2028-02-04; PCO 2028-02-18.
- Phase 4: SWD / Gray Early Start 2027-06-18; NEA 2028-01-24; H2C 2028-02-11; PFHO 2028-03-03; PCO 2028-03-17.
- Phase 5: SWD / Gray Early Start 2027-07-23; NEA 2028-02-21; H2C 2028-03-10; PFHO 2028-03-31; PCO 2028-04-14.
- Phase 6: SWD / Gray Early Start 2027-08-27; NEA 2028-03-20; H2C 2028-04-07; PFHO 2028-04-28; PCO 2028-04-28.

Source fidelity:
- PDF shows FEA only for Phase 1. Do not invent FEA dates for Phases 2–6; keep null/not specified if the UI expects the code.
- Phase 6 PFHO and PCO are both 2028-04-28.
- Preserve Phase 1 NEA discrepancy: earlier 2026-10-16 table = 2027-10-18; later 2026-10-23 candidate = 2027-10-11. Keep both source values/provenance; do not silently reconcile them.
- Retain source label differences such as “Gray Early Start Work Date” for Phases 3–6 in source notes where supported; SWD may remain the normalized app code.
- Keep milestone dates as candidates requiring operator review. Do not change actual progress, actual start/finish, confirmed milestone state, or imported schedule records.

## C. Eight planned installers per phase
Set planned installer demand to **8 headcount for each phase**, throughout the exact phase window in section B.

Implementation guidance:
- Read `prisma/schema.prisma`, plan operations, domain capacity validation, manpower views, and existing tests before coding.
- Use the existing allocation capacity tree and staffing-entry model.
- Create one phase-level RESERVATION node under the shared installer POOL per phase, linked to the phase, with stable deterministic keys. Each reservation represents 8 planned installers during its phase window.
- Create/update exact `PhaseWindow` records.
- Populate weekly staffing buckets across the window, respecting Monday-start calendar and America/New_York timezone. Handle partial first/last weeks so no one is implicitly scheduled outside the exact phase window; use supported DAY overrides or explicitly represent boundary-day behavior.
- Since phase windows overlap, root POOL weekly capacity must equal the sum of active phase reservations for that week (8 × active phase count), not a flat 8. Derive this total from phase reservations.
- This is planned capacity, not a roster. Do not create eight fake named `Person` records.
- Do not invent foreman or leadership assignment dates. Preserve existing PM and TBD foreman candidate behavior.
- Do not assume shift clock times beyond the configured project calendar.

## D. Existing database reconciliation
Must work both on a fresh database and on an existing CMH139 project that currently has only three phases and/or no workforce plan.

Replace the current early return with deliberate idempotent reconciliation:
- Find existing project, working plan, phases, ROMP areas, milestones, pool, and source lineage.
- Upsert all six phases and ROMP memberships.
- Upsert exact PhaseWindow and phase reservation/staffing records with stable keys.
- Update only seed-owned records. Do not overwrite operator-edited/reviewed data indiscriminately.
- Preserve confirmed milestone dates/review state and source provenance; add missing candidates without duplicates.
- Preserve manual changes outside this requested scope.
- Reruns must not duplicate phases, areas, people, source versions, staffing entries, nodes, or milestones.
- Log six phases plus each phase's headcount and date window.

## E. Tests and acceptance criteria
Add/update tests and run `pnpm check`, relevant integration tests, and `pnpm build`.

Theme tests:
- First visit/no preference defaults dark.
- Explicit Light and Dark preferences persist through reload/navigation.
- No hydration mismatch or visible wrong-theme flash.
- Key UI surfaces are readable in both themes.

CMH139 tests:
- Fresh seed creates exactly six phases and correct ROMP membership.
- Existing three-phase project reconciles to exactly six without deleting/recreating the project.
- Exact PhaseWindow dates match section B.
- Each phase has one installer reservation at 8 headcount for its active dates.
- Root weekly capacity equals the sum of overlapping reservations.
- Phase 1 NEA discrepancy remains two source values.
- No invented FEA dates for Phases 2–6.
- No fake named installers.
- Reruns are idempotent.
- Existing confirmed milestone reviews, actual progress and imported schedule records remain unchanged.

Report files changed, tests run, unresolved caveats, and the safe command/steps to reconcile an existing database.

## Deliverable
Implement on a feature branch and open a pull request. Do not merge to main automatically. Include a concise PR summary and screenshots or clear visual notes for the soft-dark palette if browser testing is available.
