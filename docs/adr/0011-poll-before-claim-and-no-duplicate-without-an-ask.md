# 0011 · Poll the request stream right before each claim; a request that asks for nothing is never a duplicate

**Status:** accepted

## Decision

1. **Right before each claim, and again after each refused claim, read every live source of requests once more.** Run the collector (or re-read the channel, feed or page) as the last step before you build the claim body. If anything new came in, apply it first and rerun the checks; claim only after a poll that brought nothing new. A refused claim can mean the stream moved, so poll before you change answers that already passed your checks. This is in addition to the `recheck-sources` Stop hook (ADR 0001), which re-reads the `watch` list only when a turn stops, not before a claim. The `challenge-start` skill (step 4, an Acceptance line in the ticket template) and the `triage` skill (steps 1 and 5) carry this rule.
2. **A request that asks for nothing is never closed as a duplicate.** A duplicate repeats an ask. A withdrawal ("scratch my request"), a thank-you or an "it works now" asks for nothing, so it does not get an issue of its own. It goes into the `sources` of the issue it acts on, and that issue's status and reason follow from it (a withdrawn request closes `obsolete` and cites the withdrawal). The `triage` skill (step 2, "Withdrawn") carries this rule.

The rules live in AGENTS.md under Principles.

## Why

In S03E02 the collector brought new requests in batches on later polls (10, 8, 2, 1). Four polls in a row brought nothing, and the first claim went out. It was refused with "1 intent not accounted for · 1 issue open that should not be". The next poll brought IN-3244, a client withdrawing IN-2952 (`mega-s03e02/log.txt:39`).

The second claim closed IN-3244 as `duplicate` of IN-2952 and was refused with "1 issue closed without a reason that holds" (`mega-s03e02/log.txt:44`). The third claim put IN-3244 into IN-2952's `sources`, with IN-2952 closed `obsolete`, and was accepted (`mega-s03e02/log.txt:47`).

## Decided by

The human, 2026-11-11, from the S03E02 debrief's "Next time": "Poll the request stream once more right before each claim, because new requests reached the course after the last poll. Keep a request that asks for nothing out of duplicates, because a duplicate needs an ask to repeat. Can we add this as behaviour?"
