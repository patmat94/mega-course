# S03E02 · nothing ships unmarked · outcome

The course accepted a Markdown tracker (39 files in `sched-prod/sched-prod/doc/issues/`, sent whole in the claim) and the `triage` skill (`.agents/skills/triage/SKILL.md`, linked into `.claude/skills/triage`). Course stats: 22 requests in → 22 issues carry them · 1 merged · closed: 7 duplicate, 1 obsolete, 1 contradicts-spec · open: 21 agent-ready, 3 needs-human.

It took three claims. Claim 1 was missing a request: a withdrawal (IN-3244) arrived on a later collector poll, so IN-2952 was still open. Claim 2 closed that withdrawal as `duplicate`, and the course said the reason didn't hold. In claim 3 the withdrawal went into the withdrawn issue's `sources` (IN-2952, closed `obsolete`), with no issue of its own.

The "who it is for" line was met: `check-tracker.mjs` passed with 0 problems (every request in an issue, one mark per open issue, every closed or needs-human issue cites an id).

For the next lesson: requests reach the collector only through its stored cursor, in batches (10, 8, 2, 1, then 1 after the first claim), and a fresh API read shows only the first batch. Re-poll right before every claim and after every refusal. S03E03 builds on this tracker idea; Rook's `ask` skill is now in the deck, not installed.
