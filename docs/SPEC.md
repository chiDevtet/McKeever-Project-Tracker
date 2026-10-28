# Low Voltage Division Planning App

*Functional specification and acceptance criteria*

Version 1.0  |  Prepared for Tyler Sisia  |  28 October 2026

Build a multi-project planning application for McKeever & Niekamp Electric. Its first purpose is to turn construction schedules into adjustable installation manpower plans and professional submissions to ACE Electric. CMH139 is the first project; its systems, phase labels, and dates must remain project data rather than fixed application rules.

### First release outcome

Tyler can create a project, review imported dates, define installation work, enter weekly crew sizes and named onsite leadership, and export a useful preliminary plan without assigning labor to every room. As the plan develops, he can allocate the same workforce to smaller areas, track progress, compare revisions, and forecast demand across multiple projects.

### Confirmed planning decisions

| Decision | Required behavior |
| --- | --- |
| Labor estimating | Manually choose crew sizes initially; calculate resulting hours. |
| Working time | Start with Monday to Friday, eight hours per day; allow exceptions. |
| Crew organization | Shared workforce across four systems, with dated dedicated crews. |
| Leadership | Named PM and one main foreman; PM initially planned onsite full time. |
| Level of detail | Project and phase planning first; optional ROMP, area, and activity detail. |
| Users | Tyler operates first; ownership and office staff can join later. |
| Progress and revisions | Manual progress updates, reviewed imports, preserved submitted plans. |

### How to use this specification

The agreed scope is the release boundary. The Implementation sequence and defaults section resolves calculation and workflow details for review; those defaults can be adjusted without reopening the overall scope. Technology, hosting, and final product branding remain separate implementation decisions.

The acceptance cases at the end define observable behavior. Passing those cases, persisting real project data, and generating actual PDF and Excel files are required before calling the first release complete.

## Release scope and first use

### Included in the first release

The application includes a division dashboard; project configuration; manual scheduling; guided schedule imports and revision comparison; an editable manpower grid and timeline; shared and dedicated crew allocations; named leadership; adjustable calendars; basic manual progress; scenarios and baselines; saved export presets; and user access controls.

Exports include project summaries, phase overviews, ROMP or area breakdowns, and detailed activities. Presentation choices include staffing tables, manpower charts, schedule timelines, and combined submissions. File formats are PDF and Excel. Every breakdown uses entered assignments; missing allocations remain visible internally and are never fabricated.

### Deferred capabilities

| Later capability | Foundation required now |
| --- | --- |
| Foreman daily reports and photos | Stable project, area, activity, person, and progress references. |
| Actual labor and employee scheduling | Separate planned labor, actual labor, and personnel records. |
| Budget and cost tracking | Optional cost code references; role and activity classifications. |
| Procurement and deliveries | System and activity references plus project document attachments. |
| Billing and change orders | Project and organization identity plus immutable revision history. |
| Native scheduling integrations | Isolated import adapters and preserved external activity IDs. |

Deferred modules do not need placeholder screens, financial calculations, or simulated data in the first release. Native P6 or Microsoft Project ingestion, payroll, accounting synchronization, and offline field operation are later scope unless explicitly added.

### First useful plan

1. Create CMH139 with ACE Electric as the contracting customer, Gray Construction as the general contractor, and AWS as the owner. Add contacts without automatically creating app accounts.

2. Review the preliminary milestone candidates and import relevant master schedule activities. Add the four systems and optional location structure.

3. Enter weekly installer counts at project level. Schedule the PM and main foreman separately. Confirm working days, assignment dates, and onsite hours.

4. Add phase allocations where useful. Detailed building allocations are optional. Preview a phase overview with the overall manpower chart and named leadership.

5. Save a baseline and generate a dated submission. Later allocations and schedule revisions change the working plan while the submitted snapshot remains available.

## Workspace projects and access

### Division dashboard

Show active projects, their schedule ranges, near-term milestones, planned peak manpower, planned labor hours, on-hold activities, and unresolved date conflicts. The combined chart uses a common date range and identifies installation labor separately from onsite leadership. Filter by project, role, and period.

Allow an optional available workforce limit by role and date range. Show projected shortages only when availability is configured. With no limit entered, label availability as not set rather than claiming that staffing is sufficient. Anonymous pools express project demand; they do not prove that specific employees are available.

### Project setup

Require a project name or code and a working calendar. Support customer and owner organizations, general contractor, contacts, status, description, timezone, systems, milestones, phases, and attachments. Allow overlapping phases and manual project creation with no source schedule.

Areas form an optional hierarchy, such as building, ROMP, data hall, room, or zone. Phase membership is separate from the area hierarchy. An activity or allocation may have a phase, an area, a system, any useful combination, or none. Shared building work can have an area without a phase. Moving a view grouping never duplicates the underlying activity.

### People and permissions

| Role | Initial permissions |
| --- | --- |
| Administrator | Manage workspace, users, projects, and access; Tyler initially. |
| Project manager | Edit assigned project schedules, manpower, progress, and reports. |
| Internal viewer | Read assigned projects and download permitted reports. |
| Foreman | Read assigned schedules initially; later submit field reports. |

Permissions are enforced by the application backend for records, files, and exports. A division view contains only accessible projects. Revoking access prevents further retrieval. Future financial permissions can be added separately.

Personnel records are independent of login accounts. Named leadership requires a person or explicit TBD placeholder, role, project, dates, and onsite schedule. A person may hold several responsibilities while counting once in onsite totals. Responsibility for all four systems does not create four copies of the foreman.

### Interface behavior

Provide a desktop-first browser interface with a project switcher, clear current scenario and revision labels, searchable tables, expandable groupings, and responsive viewing on smaller screens. Show saved, saving, and failed-save states. Keep values after a validation error. Use server-persisted data rather than browser storage as the system of record.

## Schedule planning screen

### Connected table and timeline

The schedule screen pairs an editable activity table with a timeline using the same selection, filters, and grouping. Switch between project, phase, ROMP or area, system, and activity views. Collapsing rows changes presentation only. Use day and week zoom levels; keep milestones recognizable when zoomed out.

An activity includes a stable ID, name, optional phase and area, system or shared-system designation, planned start and finish, working calendar, status, notes, and links to source activities or milestones. One source row can support several installation activities; a combined Fire Alarm / VESDA source row does not require duplicated manpower.

### Edits and movement

Support date entry, dragging an activity, resizing its duration, and bulk-moving selected unfinished activities. A phase move previews the resulting dates, crew reservations, leadership assignments where selected, and conflicts. Let the operator choose which staffing assignments move. Project-level unallocated workforce stays in place unless explicitly included.

Moving dates follows the selected calendar, preserving either working duration or an explicitly chosen finish constraint. Show the rule used. Resizing an activity preserves manually chosen staffing and recalculates capacity; it does not promise that the work can still be completed. Completed activities retain actual dates.

### Optional activity links

First-release links are finish-to-start with an optional working-day lag. Permit activities without links. Prevent circular dependencies. When a predecessor moves, propose successor dates for review; apply no downstream changes silently. Other dependency types and full critical-path analysis are later scope.

Imported dates and configured milestone limits remain visible as comparison targets. A milestone only constrains a system or activity when the operator creates that relationship. Do not assume that every system must finish at NEA, H2C, or PFHO based on the acronym alone.

### Validation and schedule issues

Reject a finish before a start, invalid dates, and dependency cycles. Flag work outside its linked source window, a missed linked milestone, work on a closed day, and named-person conflicts. A flag explains the affected records and offers navigation to them. Date conflicts may remain in a draft; preview them before generating a submission.

Manual editing and import use the same activity model. Missing source rows, a newly uploaded PDF, a status change, or an import warning never delete installation activities or release manpower automatically. Archive work with a visible action and preserve historical snapshots.

## Manpower planning screen

### Weekly entry with daily precision

The main grid uses weeks as columns and workforce pools or expandable planning groups as rows. Enter an integer installer count and apply it to the open days in that week. Support copying a week, filling a date range, increasing or reducing a ramp, and overriding individual days. Partial weeks use only their open dates.

Keep daily schedules and time blocks beneath the weekly view. Whole-day assignments are the default. Partial-day work or multiple shifts requires explicit time blocks, so capacity and concurrent headcount remain meaningful. Validate time overlaps; aggregate weekly values from daily records rather than maintaining competing totals.

### One workforce with progressively detailed allocations

A workforce pool creates labor capacity for a date and time block. Phase, area, system, and activity assignments reserve portions of that capacity. Reservations can be broken into smaller child reservations. Parent envelopes and their children are not added together as separate workers.

Example: eight installers are reserved to Phase 1. Allocating three of those installers to an electrical room leaves five available within Phase 1. Assigning the remaining five to the data hall still produces eight installers, not sixteen. Four more installers outside Phase 1 would need their own explicit capacity increase or another existing pool.

For every reservation, show the resource pool, allocated amount, and remaining capacity. A broad assignment can stay under Shared systems or an unspecified location. A report must not copy its labor into each of the four system totals. A filtered allocation view is labeled as an allocation view, not as total project staffing.

### Shared and dedicated crews

A dedicated crew reserves capacity from the shared pool for selected dates. Splitting, renaming, or returning a crew changes allocation, not total workforce. If additional workers are required, use an explicit increase-workforce action. An optional crew lead is another responsibility on an existing person or resource; it is not an extra person unless added as such.

A resource slice can perform sequential tasks within a day. It cannot be booked twice in the same time block. The interface may represent anonymous installer positions internally to maintain this rule; installer names are optional. The same shared resources can move across phases and systems.

### Leadership and changes

Schedule the PM and foreman as named resource assignments with onsite days and hours. Keep offsite management hours separate from onsite manpower. Changing calendars or shortening work previews its effect on hours, dates, and reservations. Block invalid negative or fractional people counts and over-capacity reservations; keep the proposed edit available for correction.

## Calculation rules and examples

### Counts hours and reporting periods

Count workers from resource assignments once per concurrent time block. An allocation explains where that resource works; it does not add another resource. A named person with several responsibilities counts once. Installer counts are integers; hours and allocation durations can be fractional. Store sufficient precision and round only for display.

Planned labor hours are the sum of resource headcount multiplied by scheduled block hours. Weekly hours are the sum of included daily hours. A calendar exception changes the affected future hours, with an impact preview; it does not overwrite frozen snapshots or actual records.

Default weekly headcount is the peak concurrent onsite workforce within that week. It is not unique people who visited during the week, the sum of daily headcounts, or full-time equivalents. Sum simultaneous project demand on aligned time blocks for division peaks; do not simply add peaks that occurred at different times.

Average equivalent onsite staffing is optional: weekly onsite person-hours divided by the project calendar hours in that week. Label it explicitly. If the calendar has zero open hours, show not applicable. Filtered installation and leadership measures use their own hours; they must not be mixed without a label.

| Worked case | Expected result |
| --- | --- |
| Eight installers and two leaders; Five days at eight hours | 10 peak onsite workers; 320 installation hours; 80 leadership hours; 400 total hours. |
| Eight installers move between systems | Allocation changes; project peak remains 8 installers; installer hours remain 320. |
| Three installers dedicated and five shared | Project total remains 8 installers. Returning the three to shared work changes no capacity. |
| PM onsite only Monday and Tuesday; Eight installers and foreman all week | Peak onsite 10; PM hours 16; total hours 376; average equivalent staffing 9.4. |
| Eight installers work six ten-hour days | 480 installer hours; peak installer headcount remains 8. |
| Two eight-person shifts do not overlap | Peak concurrent count is 8; two eight-hour shifts supply 128 person-hours per day. |

### Boundaries and availability

Use Monday through Sunday weeks and project-local calendar dates. Initial timezone is America/New_York. Store shift intervals so overnight work and timezone comparisons are unambiguous. Overnight shifts retain a shift-start date; report hours within each calendar reporting period.

Installer pools do not identify unique individuals across shifts. Show shift positions and hours when that distinction matters. Named people booked across projects are deduplicated in total person counts but flagged for simultaneous incompatible commitments. Do not conceal that conflict by displaying only the deduplicated total.

## Schedule imports and revisions

### Import formats and review states

Provide manual entry, CSV or Excel column mapping, and guided text-based PDF extraction. The supplied construction PDF is an initial import fixture. Preserve its original file and page references. Scanned PDFs require supported OCR or an explicit manual or spreadsheet fallback; never claim an empty extraction succeeded. Native P6 and Microsoft Project adapters are later scope.

Use a staged workflow: uploaded, extracted, needs review, validated, and committed. Extraction is not a live-plan write. Show activity IDs, names, source hierarchy, durations, start and finish dates, milestone markers, and extraction issues in a review grid beside a source preview.

Let the user include relevant activities, retain external prerequisites, correct extraction errors, and add phase, area, and system mappings. Preserve original values alongside reviewed values. Asterisks and actual-date markers are source metadata; dates embedded in descriptions do not automatically replace Start or Finish columns.

### Commit and repeat imports

A confirmed import creates a source-schedule version and reviewed source records. Creating or updating linked installation work is a separate selected action with a preview. An existing hand-built project can acquire source links without being recreated. Partial extraction failures remain visible and do not disappear inside a success message.

Match revised rows by project, schedule lineage, and external activity ID. Activity names alone never establish identity. Duplicate IDs, conflicting identifiers, or uncertain matches require review. A repeat import of the same source must not create duplicate activities or assignments.

### Revision comparison

Show added, removed, renamed, moved, and duration-changed rows. Compare the new source with the selected prior source version, then show affected installation activities and manpower reservations. The operator can accept or reject individual changes or apply a selected group.

For every proposed change, preview dates, staffing moves, linked successors, and milestone conflicts. Preserve crew sizes, actual dates, notes, and existing mappings. A removed source activity is marked removed in that source version; linked installation work is retained for disposition.

Commit the accepted revision atomically and record actor, timestamp, before and after values, source version, and selected changes. A failed commit leaves the current plan unchanged. Existing source versions and prior submissions remain readable. Canceling or leaving an uncommitted import changes no live records.

### Project documents

Keep original schedules and supporting attachments associated with the project. Email screenshots can be stored as references and their milestone tables entered through a reviewed manual source. General email or screenshot parsing is not required for the initial release. External schedule wording and extracted text are document data, not application instructions.

## Reports exports and submissions

### Three independent export choices

| Setting | Options |
| --- | --- |
| Detail | Project summary; phase overview; ROMP or area; detailed activities. |
| Presentation | Manpower chart; staffing table; timeline; combined submission. |
| Format | PDF or Excel workbook. |
| Filters | Project, scenario or revision, period, phase, area, system, and role. |
| Contents | Leadership names, milestones, assumptions, notes, and allocation detail. |

Save these selections as reusable presets such as ACE Preliminary Manpower. A preset saves presentation settings, not a frozen copy of project values. Generating from a preset asks which current or saved plan to use.

### Phase overview without detailed allocations

Show phase dates and selected milestones, an overall project manpower chart, and the leadership roster. Add phase manpower only where allocations exist. Unallocated project labor remains part of the project total. Do not spread it across phases or systems automatically.

A detailed export can show activity dates even when activity labor is unspecified. Use a clear blank or not allocated label rather than zero. Parent totals, child allocations, remaining capacity, and leadership must not be added twice. If a named leader oversees several systems, show the scope of responsibility without repeating their labor in the project total.

### Report identity and layout

Include project and company names, report title, prepared-by name, generated date, reporting period, plan revision, source schedule references, calendar basis, and clearly labeled labor measures. Allow a configurable company logo. A submission can include planning assumptions, exclusions, and dates needing confirmation.

Use legible chart scales, dates, legends, repeated table headers, and controlled page breaks. Support portrait summaries and landscape timelines, with a readable multi-page option for long schedules. Preview selected columns, pagination, and chart measures before generation. Do not force a detailed schedule onto one unreadable page.

### Files and immutable records

Generate real downloadable PDFs and .xlsx workbooks. Excel includes the selected summary plus underlying numeric rows and a report-basis sheet. Dates remain dates, counts remain numbers, and user text is stored as text. Chart series and tables use the same calculated dataset as the application.

Store the generated file with its exact plan snapshot, settings, assumptions, reporting basis, timestamp, and author. Marking it submitted records the issue date, recipient label, and optional reference; the app does not send it to ACE automatically. Later changes to the working plan or preset cannot modify an issued file.

Distinguish exporting an exploratory scenario from recording a formal submission. Before recording a submission, present unresolved planning issues for acknowledgment and retain that acknowledgment with the snapshot. Data validation failures remain blocking; acknowledged date uncertainties are planning information.

## Progress baselines and scenarios

### Manual progress updates

Support Not started, In progress, Complete, and On hold. Store actual start, actual finish, progress notes, and an optional manually entered completion percentage. Keep planned dates, current forecast dates where different, and actual dates distinct. Show who recorded each update and when.

Complete requires an actual finish and sets completion to 100 percent. An actual finish requires an actual start no later than the finish. Actual dates cannot be in the future. Reopening completed work is explicit and audited. A percentage describes reported progress; it does not establish installed quantities, actual labor, or earned value.

On hold records a reason and optional review date. Holding an activity flags its staffing reservations for review; it does not automatically cancel them. Progress notes may describe access restrictions, predecessor delays, coordination issues, or other project conditions.

### Forecasting unfinished work

Allow new remaining dates and future staffing for unfinished work. Preserve recorded actual dates and earlier submitted staffing. A phase shift moves only the selected unfinished scope and selected future reservations. Work that is partly complete may need a split remaining activity rather than moving its historical start.

Changing an activity percentage never silently reduces headcount, reallocates a crew, or marks a milestone achieved. An operator explicitly accepts those planning changes. Until actual labor capture is introduced, the application reports planned hours and reported progress, not invented actual labor totals.

### Baselines and scenarios

A baseline is an immutable named snapshot of a plan at a chosen date. A scenario is an editable branch created from a working plan or snapshot. It contains its own schedule, staffing, allocations, and calendar assumptions, while retaining references to the source project and revision.

Compare scenario dates, peak headcount, labor hours, and planning issues against the working plan. Scenario demand does not enter the live division forecast until promoted. Promotion previews the change and creates a new working revision; it never rewrites the baseline or previous submissions.

### History and restoration

History records material date, crew, calendar, progress, source, and access changes. Restoring a prior plan creates a new revision. It does not erase later history or silently roll back actual progress; actuals are retained unless the operator explicitly corrects them through the audited progress workflow.

Foreman daily reporting later supplies observations linked to these same records. Reports can be reviewed before changing current progress. The first release therefore needs stable IDs and separate planned and actual fields, but no field-report submission interface.

## Data and application foundations

### Persistent record groups

| Record group | Responsibility |
| --- | --- |
| Workspace and access | Organizations, users, project memberships, role grants, personnel. |
| Project structure | Projects, phase definitions, area hierarchy, systems, optional cost codes. |
| Calendars | Project calendars, dated exceptions, shifts, effective assignment schedules. |
| Source schedules | Uploaded files, source versions, original and reviewed rows, mappings. |
| Work plan | Milestones, installation activities, dependency links, source relationships. |
| Workforce | Resource pools, daily capacity, nested reservations, named leadership. |
| Progress | Status events, actual dates, manual percentages, notes, correction history. |
| Versions and reports | Scenarios, immutable snapshots, presets, exports, submission metadata. |
| Audit and attachments | Actor and timestamp history, file access, record relationships. |

Use stable identifiers and workspace and project ownership on every applicable record. A phase, area, system, and activity are separate concepts. An app user, a personnel record, and a project staffing role are separate concepts. Reuse these references when adding budgets, procurement, and daily reporting.

### Calculation and save behavior

Use one calculation engine for screens, previews, PDF charts, and Excel data. Persist source inputs, not conflicting independent totals. Apply multi-record staffing changes and accepted imports atomically. Detect stale edits using revision checks and offer reload or explicit reconciliation rather than silently overwriting newer data.

Ordinary grid edits save with visible status. Bulk date moves, calendar changes, imports, and scenario promotion require an impact preview followed by Apply or Cancel. Maintain a recoverable draft for interrupted import review where practical. Reloading a saved project must reproduce its dates, staffing, and totals.

### Operational requirements

Authentication and server-side authorization are required from the first release. Protect project attachments and exported files with the same access rules. Validate uploads, isolate parsing work, and keep credentials outside source control. Provide a documented backup and restore path for persistent records and files.

Use date-only values for construction dates and explicit timezone-aware intervals for timed staffing. Make holidays configurable; do not assume an automatically downloaded holiday calendar is authoritative. Sort and filter before rendering large tables; do not limit the model to one project or the initial six phases.

Provide a reproducible setup, configuration reference, data migrations or equivalent schema management, and a sample project. Technology and hosting choices must be selected before the repository build prompt is finalized. This specification does not require a particular database or framework.

## CMH139 initial project configuration

Create CMH139 as a configurable preliminary project for McKeever & Niekamp Electric, with ACE Electric as customer, Gray Construction as general contractor, and AWS as owner. The four initial systems are Fire alarm, VESDA, Emergency responder radio, and Cellular boosting. Preserve ERRS and ERRC as source aliases for review rather than assuming separate systems.

### Milestone candidates for review

Use the October 23 ACE milestone table as the candidate milestone set below. Dates remain preliminary until selected by the operator. The phase and ROMP pairs are project configuration; other projects may have different arrangements.

| Phase | ROMPs | SWD | NEA | H2C | PFHO |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 and 3 | 20 May 2027 | 11 Oct 2027 | 29 Oct 2027 | 26 Nov 2027 |
| 2 | 2 and 4 | 31 May 2027 | 29 Nov 2027 | 17 Dec 2027 | 07 Jan 2028 |
| 3 | 5 and 7 | 31 May 2027 | 27 Dec 2027 | 14 Jan 2028 | 04 Feb 2028 |
| 4 | 6 and 8 | 18 Jun 2027 | 24 Jan 2028 | 11 Feb 2028 | 03 Mar 2028 |
| 5 | 9 and 11 | 23 Jul 2027 | 21 Feb 2028 | 10 Mar 2028 | 31 Mar 2028 |
| 6 | 10 and 12 | 27 Aug 2027 | 20 Mar 2028 | 07 Apr 2028 | 28 Apr 2028 |

Phase 1 FEA is 27 September 2027. FEA entries for other phases are unspecified in the supplied table; leave them blank. Keep milestone abbreviations configurable and avoid deriving system completion rules from them.

### Source activity examples

| Source ID | Activity | Scheduled window |
| --- | --- | --- |
| P1ER.1140 | Phase 1 electrical room Fire Alarm / VESDA | 01 to 07 Jun 2027 |
| P1RP.1210 | Phase 1 data hall Fire Alarm VESDA | 21 Jun to 02 Jul 2027 |
| P1CX.2000 | Phase 1 Fire Alarm Programming and Pretest | 06 to 07 Jul 2027 |

### Sources and scope review

Source schedule: 2026.10.15 AWS CMH139 Preliminary Schedule.pdf, 59 pages. Milestones appear on pages 1 to 3; the example activities appear on pages 26, 28, and 31. Correspondence: ACE milestone table dated 23 October 2026; earlier milestone table dated 16 October; manpower and dedicated-leadership request forwarded by Larry McKeever; system-breakout discussion dated 22 October.

Retain the older table as a separate source: its Phase 1 NEA is 18 October 2027, versus 11 October in the October 23 table. Treat conduit exclusions and radio-system support responsibilities as scope items to confirm. Do not assign earlier combined electrical rough-in rows to this division solely by a keyword match. Manpower counts and radio or cellular work windows require operator entry.

## Implementation sequence and defaults

### Build in complete functional stages

| Stage | Exit gate |
| --- | --- |
| 1  Core project and manpower | Authenticated user creates projects, calendars, people, and weekly staffing; reload preserves values; core labor calculations pass. |
| 2  Scheduling and allocations | Manual activities, timeline edits, shared and dedicated reservations, leadership, and optional links work without double counting. |
| 3  Submission exports | PDF and Excel use the same calculated data; presets, snapshots, and the preliminary phase overview work. |
| 4  Guided imports | PDF and spreadsheet review, source links, repeat-import handling, and accepted revision previews work end to end. |
| 5  Progress and scenarios | Actual dates, status, baseline comparison, scenarios, promotion, and history preserve previously submitted records. |
| 6  Release verification | Multi-project forecasts, access rules, backup and restore, edge cases, and all acceptance cases pass. |

These are implementation stages within the agreed release, not permission to omit later stages. Stage 3 provides an early usable preliminary submission while the remaining release functionality is completed.

### Implementation defaults for review

Use Monday-start weeks, America/New_York as the initial project timezone, and peak concurrent onsite headcount as the default weekly chart. Show installer and leadership hours separately. Offer average equivalent staffing only with its denominator clearly stated.

Use whole-day allocations by default, with timed blocks for partial days and shifts. Anonymous installer positions may be used internally to preserve allocation identity. Reject over-capacity reservations; permit date uncertainties in drafts and require acknowledgment when recording a submission.

Use finish-to-start dependencies with working-day lag initially. Imports support text-based PDF and CSV or Excel. OCR and native scheduling-file adapters are separate extensions. Use editable project configuration and source-reviewed milestone candidates rather than hardcoding CMH139.

### Decisions before the repository prompt

Choose the application name and branding, technology stack, hosting and database services, file storage, authentication delivery method, and backup destination. Confirm the implementation defaults above. These choices should be recorded explicitly in the eventual build prompt rather than guessed by the builder.

Include this specification, the original schedule fixture, reviewed seed data, and acceptance cases in the repository handoff. Require an implementation plan, real persisted workflows, setup documentation, and meaningful calculation and integration checks. Screens with demonstration-only controls or fake exports do not satisfy the release.

## Acceptance cases for planning and labor

A01  Useful preliminary plan. Create a project, calendar, weekly installer counts, and PM and foreman assignments without any detailed area allocations. A phase overview exports successfully with phase dates and the overall project manpower chart.

A02  Independent project structure. Create overlapping phases, nested ROMP areas, a shared admin area outside every phase, and an activity with no area. All save and appear correctly under different groupings.

A03  Initial labor calculation. Schedule eight installers, one PM, and one foreman for five eight-hour days. Show 10 peak onsite workers, 320 installer hours, 80 leadership hours, and 400 total hours in screen and export data.

A04  Nested allocation. Reserve eight installers to a phase. Allocate three to one room and five to another. Phase and project staffing remain eight installers; no parent row is added again.

A05  Partial detail. Allocate three of the eight phase installers to a room. Show five remaining within the phase. The room allocation is three, while the phase staffing envelope remains eight.

A06  Dedicated crew transfer. Reserve three of eight shared installers as a dedicated crew for a date range. Show three dedicated and five shared. Returning them to shared restores eight without adding or deleting total capacity.

A07  Sequential and concurrent work. Assign the same resource positions to two nonoverlapping time blocks. Count their concurrent presence once. Attempt an overlapping duplicate reservation; reject the edit and identify the capacity conflict.

A08  Calendar acceleration. Change eight installers from five eight-hour days to six ten-hour days for one week. Preview and then show 480 installer hours, while installer peak headcount stays eight. Canceling the preview leaves the prior week unchanged.

A09  Part-time onsite leader. With eight installers and a foreman all week, schedule the PM onsite only Monday and Tuesday. Show peak 10, total onsite hours 376, and average equivalent staffing 9.4 over a 40-hour week.

A10  Leadership responsibilities. Give the same foreman responsibility for all four systems. The roster shows that scope; combined project totals include one foreman. Offsite PM hours do not enter onsite headcount.

A11  Working-day edit. Move an activity with five working days across a weekend and a configured holiday. Preserve five working days under the selected rule, preview successor changes, and retain completed actual dates.

A12  Optional dependencies. Create cable installation followed by termination with a working-day lag. Moving the predecessor proposes a valid successor move. Cancel changes neither activity. A circular link is rejected.

A13  Forecast boundaries. Create an exploratory scenario with higher staffing. Live division demand remains unchanged until promotion. A promotion creates a new working revision and preserves the earlier baseline.

## Acceptance cases for records and exports

A14  Reviewed PDF import. Extract the supplied schedule into a review grid with page and external-ID references. Confirm the three source activity windows in the CMH139 initial project configuration section. No live dates change before selected changes are applied.

A15  Import cancellation and failure. Cancel a reviewed import or encounter an extraction failure. Current activities and staffing stay unchanged. An empty extraction or scanned PDF shows a useful issue and supported fallback.

A16  Repeat and revised imports. Reimport the same source without creating duplicates. A changed version shows added, removed, and changed records. Ambiguous IDs require review. Removed source rows do not delete linked installation work.

A17  Preserve manual planning. Apply a reviewed source-date change. Retain crew sizes, actual dates, notes, and source mappings. Move only the staffing and downstream activities selected in the preview.

A18  Progress validation. Reject finish-before-start and future actual dates. Completing an activity requires valid actual dates and records 100 percent. Holding work does not silently release its reserved workforce.

A19  Export agreement. Generate PDF and Excel from one snapshot and filter set. Every total, date, chart series, and leadership assignment agrees with the application dataset. Excel preserves numeric values and date types.

A20  Honest detail levels. Export project labor with no phase allocation. Show overall staffing and phase dates without inventing phase manpower. Filter a system with no allocated labor; show not allocated rather than asserting zero demand.

A21  Frozen submissions. Record a submission, then edit the working schedule, calendar, and preset. The issued file and snapshot remain unchanged and downloadable. A later submission has a separate revision and timestamp.

A22  Project and permission isolation. An internal viewer can read only assigned projects and cannot modify them through either interface or direct requests. Revoked access also prevents retrieving project files and exports.

A23  Persistence and edit conflicts. Save, reload, and reproduce a project and its totals. A stale browser edit cannot silently overwrite a newer saved revision. A failed multi-record save leaves no half-applied plan.

A24  Combined demand and names. Combine two projects whose peaks occur at different times. Calculate the aligned concurrent peak rather than adding independent peaks. Flag a named leader booked simultaneously on incompatible assignments.

A25  Closed and partial periods. A three-day week uses three working days. A fully closed week has zero planned hours and no equivalent-staffing division error. Overnight shift hours fall into the correct reporting dates.

A26  Release completion. All included workflows operate with persisted records, real exports, documented setup, a tested backup and restore, and the source fixture. Review every export style for readable headers, legends, dates, and page breaks.
