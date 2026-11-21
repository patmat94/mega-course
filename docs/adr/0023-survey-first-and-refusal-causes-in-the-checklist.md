# 0023 · A new job starts with a survey; each refusal's cause is written into the factory's checklist before the next try

**Status:** accepted

## Decision

1. A new job a factory-made role does starts with one survey: a practice that pays nothing, flags every task, and saves the shape of the tasks. The Host Desk factory does it with `tasks.mjs survey`, run as `node roles/<role>/run.mjs survey`, which writes `state/survey-<role>.json`. That file records every field path the tasks carry, each id that came twice, each text field that was sometimes filled, and the settings versions. The job's rule (`factory/make-a-role/jobs/<role>.mjs`) is written from that file and the manual, and only then does practice run.
2. Before the next try, the cause of each refused try is written under "Refusals" in `factory/CHECKLIST.md`: what the course said, the cause, and where the fix went. The fix then goes into the factory: a checklist rule (and the template) when every role needs it, or the job's rule when only this job does. The made role is never edited by hand. `make.mjs` copies only the rules above "Refusals" into a role's prompt.

The human asked for both on 2026-11-21, from the S04E05 debrief.

## Why

In S04E05 the first six practice tries went to learning the task: fields the rule had not seen, then how the course takes a refund that comes twice. A survey shows the fields and the repeated ids in one free try. On 2026-11-21 it found the same refund id twice (tasks 2 and 5) and the three text fields (`booking`, `reason`, `note`), which took practices 1–6 to learn. Writing the cause down before the next try keeps a second refusal from repeating the first: practices 3 and 6 were refused for the same paid, noted refund.

## Limits

- A survey ends as a refused practice, because it flags every task. It also needs a course that lets practice run again on the same attempt.
- The survey's shape file shows fields and repeats. It does not show which tasks are the owner's call. The survey's own refusal on 2026-11-21 hinted at that: "Which of the refunds you parked could the policy decide alone?"
