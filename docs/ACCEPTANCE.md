# Acceptance checklist

Record evidence against each item. These are requirements for the application builder, not claims that the application has already been tested.

- [ ] A01  Useful preliminary plan. Create a project, calendar, weekly installer counts, and PM and foreman assignments without any detailed area allocations. A phase overview exports successfully with phase dates and the overall project manpower chart.

- [ ] A02  Independent project structure. Create overlapping phases, nested ROMP areas, a shared admin area outside every phase, and an activity with no area. All save and appear correctly under different groupings.

- [ ] A03  Initial labor calculation. Schedule eight installers, one PM, and one foreman for five eight-hour days. Show 10 peak onsite workers, 320 installer hours, 80 leadership hours, and 400 total hours in screen and export data.

- [ ] A04  Nested allocation. Reserve eight installers to a phase. Allocate three to one room and five to another. Phase and project staffing remain eight installers; no parent row is added again.

- [ ] A05  Partial detail. Allocate three of the eight phase installers to a room. Show five remaining within the phase. The room allocation is three, while the phase staffing envelope remains eight.

- [ ] A06  Dedicated crew transfer. Reserve three of eight shared installers as a dedicated crew for a date range. Show three dedicated and five shared. Returning them to shared restores eight without adding or deleting total capacity.

- [ ] A07  Sequential and concurrent work. Assign the same resource positions to two nonoverlapping time blocks. Count their concurrent presence once. Attempt an overlapping duplicate reservation; reject the edit and identify the capacity conflict.

- [ ] A08  Calendar acceleration. Change eight installers from five eight-hour days to six ten-hour days for one week. Preview and then show 480 installer hours, while installer peak headcount stays eight. Canceling the preview leaves the prior week unchanged.

- [ ] A09  Part-time onsite leader. With eight installers and a foreman all week, schedule the PM onsite only Monday and Tuesday. Show peak 10, total onsite hours 376, and average equivalent staffing 9.4 over a 40-hour week.

- [ ] A10  Leadership responsibilities. Give the same foreman responsibility for all four systems. The roster shows that scope; combined project totals include one foreman. Offsite PM hours do not enter onsite headcount.

- [ ] A11  Working-day edit. Move an activity with five working days across a weekend and a configured holiday. Preserve five working days under the selected rule, preview successor changes, and retain completed actual dates.

- [ ] A12  Optional dependencies. Create cable installation followed by termination with a working-day lag. Moving the predecessor proposes a valid successor move. Cancel changes neither activity. A circular link is rejected.

- [ ] A13  Forecast boundaries. Create an exploratory scenario with higher staffing. Live division demand remains unchanged until promotion. A promotion creates a new working revision and preserves the earlier baseline.

- [ ] A14  Reviewed PDF import. Extract the supplied schedule into a review grid with page and external-ID references. Confirm the three source activity windows in the CMH139 initial project configuration section. No live dates change before selected changes are applied.

- [ ] A15  Import cancellation and failure. Cancel a reviewed import or encounter an extraction failure. Current activities and staffing stay unchanged. An empty extraction or scanned PDF shows a useful issue and supported fallback.

- [ ] A16  Repeat and revised imports. Reimport the same source without creating duplicates. A changed version shows added, removed, and changed records. Ambiguous IDs require review. Removed source rows do not delete linked installation work.

- [ ] A17  Preserve manual planning. Apply a reviewed source-date change. Retain crew sizes, actual dates, notes, and source mappings. Move only the staffing and downstream activities selected in the preview.

- [ ] A18  Progress validation. Reject finish-before-start and future actual dates. Completing an activity requires valid actual dates and records 100 percent. Holding work does not silently release its reserved workforce.

- [ ] A19  Export agreement. Generate PDF and Excel from one snapshot and filter set. Every total, date, chart series, and leadership assignment agrees with the application dataset. Excel preserves numeric values and date types.

- [ ] A20  Honest detail levels. Export project labor with no phase allocation. Show overall staffing and phase dates without inventing phase manpower. Filter a system with no allocated labor; show not allocated rather than asserting zero demand.

- [ ] A21  Frozen submissions. Record a submission, then edit the working schedule, calendar, and preset. The issued file and snapshot remain unchanged and downloadable. A later submission has a separate revision and timestamp.

- [ ] A22  Project and permission isolation. An internal viewer can read only assigned projects and cannot modify them through either interface or direct requests. Revoked access also prevents retrieving project files and exports.

- [ ] A23  Persistence and edit conflicts. Save, reload, and reproduce a project and its totals. A stale browser edit cannot silently overwrite a newer saved revision. A failed multi-record save leaves no half-applied plan.

- [ ] A24  Combined demand and names. Combine two projects whose peaks occur at different times. Calculate the aligned concurrent peak rather than adding independent peaks. Flag a named leader booked simultaneously on incompatible assignments.

- [ ] A25  Closed and partial periods. A three-day week uses three working days. A fully closed week has zero planned hours and no equivalent-staffing division error. Overnight shift hours fall into the correct reporting dates.

- [ ] A26  Release completion. All included workflows operate with persisted records, real exports, documented setup, a tested backup and restore, and the source fixture. Review every export style for readable headers, legends, dates, and page breaks.
