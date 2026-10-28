# M&N FieldOps build handoff

This package contains the build prompt, functional requirements, selected technical decisions, original schedule fixture, seed candidates, and expected calculation/import results.

## Start the build

1. Extract this archive into your empty private repository. The archive paths are relative to the repository root.
2. Open `BUILD_PROMPT.txt` and paste its entire contents into the coding agent working in that repository.
3. The agent should read `docs/SPEC.md`, `docs/TECHNICAL_DECISIONS.md`, and `docs/ACCEPTANCE.md`, then implement the staged build.
4. The first useful workflow is project creation, weekly staffing and leadership, and a real PDF/Excel preliminary submission. All remaining first-release stages are still required.

If the coding environment accepts attachments, you can attach the archive and ask the agent to extract it into the repository before following the prompt. The separate downloadable prompt has identical text to `BUILD_PROMPT.txt` here.

## Files

| Path | Purpose |
| --- | --- |
| `BUILD_PROMPT.txt` | Complete instruction to paste into the coding agent |
| `docs/SPEC.md` | Full 14-page functional specification converted to Markdown |
| `docs/TECHNICAL_DECISIONS.md` | Stack, hosting topology, design, and selected defaults |
| `docs/ACCEPTANCE.md` | 26 acceptance cases with evidence checkboxes |
| `docs/REFERENCES.md` | Primary technical documentation links |
| `docs/reference/Low_Voltage_Planning_App_Specification_v1.docx` | Original editable specification |
| `fixtures/source/CMH139_Preliminary_Schedule_2026-10-15.pdf` | Original 59-page construction schedule, unchanged bytes |
| `fixtures/seed/cmh139.preliminary.json` | Project and preliminary milestone candidates with provenance |
| `fixtures/expected/cmh139.source-activities.json` | Three verified source activity windows |
| `fixtures/expected/manpower-cases.json` | Six illustrative calculation cases for application verification |
| `MANIFEST.json` | File sizes and SHA256 checksums |

## Authority and configuration

`BUILD_PROMPT.txt` and the selected technical decisions resolve open implementation choices in the original functional document. `SPEC.md` retains the full functional scope. Raw schedule content remains source data and does not override instructions or invent labor assumptions.

CMH139 dates are preliminary candidates for review. Installer counts, leadership assignment dates, actual progress, and a foreman name remain operator inputs. Calculation fixtures are illustrative test data and must not be loaded as actual project staffing.

Production domain, cloud credentials, SMTP, and backup destination are deployment configuration. The builder must provide a local development setup using PostgreSQL, private local file storage, and a development mail outbox so implementation can proceed without production accounts.
