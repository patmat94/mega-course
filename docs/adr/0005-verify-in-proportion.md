# 0005 · Verify in proportion to impact

## Decision

Every change is verified in proportion to its impact, and the report says what was run. A one-line note gets a re-read; a hook, a request body or a worker gets run against a real case before it is called done. The check happens with the change, not later at the claim.

The rule lives in AGENTS.md under Principles.

## Why

Until now most checking waited for the claim gate: going through a ticket's Acceptance before a claim. Small changes got the same late check as big ones, and defects in them surfaced only at the claim or in a later session. Checking each change as it is made, at a size that fits it, catches those earlier. Saying what was run lets the human see how far a change was checked.

## Decided by

The human, 2026-11-04.
