# 0012 · A ship line keeps its readers after the record is signed; an unclear owner answer is asked again

**Status:** accepted

## Decision

1. **A ship line for a change to an existing answer names the issue and every reader of that answer in `open risks`, and keeps them after the record is signed.** The signature removes only the "unsigned" part. `none` is for changes that reach no reader beyond the contract (declines, closes with no change, new calls). The `triage` skill (§6, "After the owner answers" step 4–5 and "Ship line") carries this rule.
2. **An owner answer the agent cannot read is asked again, never guessed.** An answer counts only when it is from the owner, reads `/answer <n>`, and `<n>` is one of the record's options. Anything else: build nothing, keep the record `proposed` and `needs-human`, quote what arrived in one comment, list the options again, ship line stays `asked`. The `triage` skill (§6, "After the owner answers" step 0) carries this rule.

## Why

In S03E03 the owner signed record 0007 for #2 (a `suggestions` field on every incident). The harness then rewrote #2's ship line to "open risks: none", and the course refused the round: "#2: The ship log names no open risk with the issue and who reads the change." Reposting the line with the status page, on-call board and support console as readers was accepted (`mega-s03e03/log.txt`, refused claim and fix).

The S03E03 debrief's question "A garbled answer" found that the skill had no rule for an answer the agent cannot read: the watcher would rerun the issue, but nothing made the agent ask again rather than build on a guess (`mega-s03e03/outcome.md`).

## Decided by

The human, 2026-11-12, from the S03E03 debrief's "Next time": "Keep the readers in a ship line's open risks after a record is signed, because a signature settles the choice, not who sees it. Add a garbled-answer rule to the skill, because nothing forces the agent to ask again."
