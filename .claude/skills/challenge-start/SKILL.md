---
name: challenge-start
description: Use when a MEGA.dev Challenge starts or is picked up again — a prompt with "Start challenge S", "I am a student in the MEGA.dev course" or "Call list-challenges. Find S", or a session that resumes a Challenge (resume-challenge, "pick up S0xE0y") — before calling any MCP tool or reading any course page.
---

# challenge-start

## 1. Lesson folder

Folder `mega-sXXeYY/` in the course root, named by the code in lowercase (S01E04 → `mega-s01e04`). If it is missing, create it with an empty `log.txt` and a `receipts.json` holding `{}`:

```powershell
$f = "mega-s01e04"; New-Item -ItemType Directory $f; New-Item -ItemType File "$f\log.txt"; Set-Content "$f\receipts.json" "{}" -Encoding utf8
```

If it exists (a resume), read `ticket.md`, `receipts.json` and the end of `log.txt` before you do anything else.

## 1b. After mega-start: verify lesson matches expected progression

Before writing the brief, check the Lessons table in `CLAUDE.md`. Find the first row marked "not yet open" or without a solved date — that is the expected next lesson. If `mega-start` returned a different lesson (e.g. jumped to S02E01 while S01E05 is still pending), tell the user: "mega-start returned [X] but your next expected lesson is [Y] — which should the brief be based on?" Do not write the brief until the user confirms.

## 2. Call start-challenge, even when the startPoint is a page

Its reply holds what the page does not: the `ticket` or proofs (often what the Challenge checks), `submit` (the answer shape) and `deliver`. Write its `challengeId` at the top level of `receipts.json` (the claim gate finds the lesson by it). Keep proofs raw in `receipts.json` under `receipts`, and mask them in `log.txt`. Call it again when the course says something changed, because a repeat call can carry an `update` field.

## 3. Write `ticket.md` before the work

Copy [ticket.md](ticket.md) from this folder and fill it from the start-challenge reply and the page. Acceptance is the part that matters: one checkable line per thing the course will look at. Show the user the Outcome and Acceptance before starting.

## 4. Before every claim: tick Acceptance

A hook on `claim-challenge` (`.claude/hooks/claim-gate.mjs`) denies the claim while any Acceptance line in the ticket.md of the folder whose `receipts.json` holds that `challengeId` is unticked. A line that can only be ticked once the claim answers (e.g. "claim-challenge returns solved") carries `(after claim)` and is skipped. Check each line against the real result (run the count, open the link, read the issue's state), tick it, and claim only when all are ticked. When a claim is refused, add the missing check as a new Acceptance line and a line in Notes.

## Issue work

When the user approves an issue split and what every issue carries, write that shape into the Challenge repo (its issue skill, or AGENTS.md) in the same push as the issues.

## Public uploads

Use the `netlify-upload` skill, and ask the user before each upload.

## 5. After a claim is accepted

Invoke the `challenge-close` skill. It owns everything that happens after the solve: outcome.md, CLAUDE.md, and memory.
