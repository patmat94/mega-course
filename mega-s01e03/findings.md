# #4471 — what the 412 reports show

Source: kb export `kb-export-267efc5e.zip` (downloaded 2026-10-29 from
https://hq.mega.dev/media/what-it-shows/kb-export-267efc5e.zip), file
`support-kb/src/lib/data/reports-4471.json`.

- 427 rows, 412 unique ids (15 rows are exact duplicates from overlapping export pages). All 412 have `mergedInto: 4471`.
- 11 tenants, all day-first locales (checked with `Intl`, as `causes.ts` does).
- Scripts: `analyze.mjs` (reproduces `causes.ts`) and `bodies.mjs` (reads each body's two dates).

## Problems

| # | problem | reports | how told apart |
|---|---|---|---|
| 1 | shared parser reads dates month first; day-first tenants get day and month swapped | 374 | `causeOf` = `parser`, minus the 5 below. 370 bodies show a swap; 4 have no dates (R-41290, R-41417, R-41514, R-41615) and stay with their tenant's cause |
| 2 | booking-v3 form hints `MM/DD/YYYY` to day-first tenants; people type month first and the form reads it day first | 33 | `causeOf` = `hint`: channel `form`, tenant on booking-v3 (alder.physio, copper.studio, pale.harbour). All 33 bodies show a swap |
| 3 | invite lands one day off (time zone), not a swap | 5 | R-41202, R-41209, R-41236, R-41344, R-41620 — the desk's own `desk-notes.json` `oneDayMove` list. `CauseTable` files them under `parser` by tenant |

374 + 33 + 5 = 412.

## What the kb gets wrong

- `incidents/4471` says "one issue, one fix queued" and status `known`.
- `CauseTable` already shows two causes; `hint` is flagged "not this ticket — no ticket of its own".
- The one-day moves are counted inside `parser` and only footnoted.
- Intake tags disagree with the tenant-based cause in 38 reports (23 parser tagged hint, 15 hint tagged parser): intake guesses from the browser locale.
- Root cause of the merge: decision 0001 merges on subject line only, and the triage page says "when unsure, merge".
