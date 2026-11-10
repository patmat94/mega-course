# 0010 · Check spoken tags by ear before the first claim; re-read the Challenge page after each accepted step

## Decision

1. **A tag or value that came only from speech is checked by ear before the first claim.** A transcript is a draft. List each spoken tag with its file and second. Then listen at those seconds, or ask the human to, and confirm or correct each one letter by letter. A second transcription run is not a check. When a claim says a tag is unknown or missing, suspect the spoken tags first. The `capture` skill (step 3b) and the `challenge-start` skill (step 4, an Acceptance line) carry this rule.
2. **After a claim comes back `progress`, re-read the signed-in Challenge page and call `start-challenge` again before the next step.** Owners answer open questions there, and the claim reply only hints at it. Apply each answer to the next step, log it, and tell the human which questions are still open. The `challenge-start` skill (step 4b) and the `capture` skill (step 4) carry this rule.

The rules live in AGENTS.md under Principles.

## Why

In S03E01 the transcription tool wrote the memo's tag at 34 s as "RH-5-H". A second run gave the same text. The first list was refused with "missing_tag: 1 · unknown_tag: 1". The human listened and heard RZ-5-H, and the corrected list passed (`mega-s03e01/log.txt:50`).

After the list passed, the claim reply said only "one of them answered you". Product's answer to the date conflict ("dates month first, 10/12 … R-Z8K holds, R-Z9L goes") was only on the signed-in Challenge page (`mega-s03e01/log.txt:54`). A build that did not look there would have shown day-first dates.

## Decided by

The human, 2026-11-10, from the S03E01 debrief's "Next time": "Read each spoken tag back against its audio before the first claim, because a transcript drops or swaps letters. Re-read the Challenge page after each accepted step, because owners answer conflicts there. can we add this as behaviour?"
