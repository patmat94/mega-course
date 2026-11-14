# 0013 · Every ticked Acceptance line points at evidence

**Status:** accepted

## Decision

The claim gate (`.claude/hooks/claim-gate.mjs`) denies a claim while a ticked Acceptance line in the lesson's `ticket.md` does not end with `· evidence: <pointer>`, or while a pointer does not hold. A pointer is `path:N` (the file has line N and it is not blank, e.g. `log.txt:47`) or `path` (a file or folder exists). Several pointers are comma-separated. Paths resolve from the lesson folder first, then the repo root, and must stay inside the repo. Lines marked `(after claim)` are skipped, as before.

The template (`.claude/skills/challenge-start/ticket.md`) and step 4 of `challenge-start` say how to write the pointer.

Tickets of solved lessons are not rewritten: the gate only matters at the next claim. Run against `mega-s03e03/ticket.md` on 2026-11-14, it denies 13 of 14 lines (the 14th is `(after claim)`).

## Why

A tick was a claim from memory: the gate checked that the box was ticked, not that anything showed the check held. The S03E05 lesson asks for proof before a change is called done. A pointer the gate can open makes each tick name its proof, and a reader (the human, a new session, the debrief) can follow it.

The gate checks that the pointer exists, not that it proves the line. Whether the cited log line shows what the Acceptance line says is still for the agent and the human to read.

## Decided by

The human, 2026-11-14.
