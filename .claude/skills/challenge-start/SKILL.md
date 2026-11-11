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

Its reply holds what the page does not: the `ticket` or proofs (often what the Challenge checks), `submit` (the answer shape) and `deliver`. Write its `challengeId` at the top level of `receipts.json` (the claim gate finds the lesson by it). List every source the work rests on (a file-list URL, a page, a local folder relative to the lesson folder) under `watch` in `receipts.json`. The `recheck-sources` Stop hook re-reads them before each stop and sends you back when one changed: S02E01 added sessions after the plan check-in. Keep proofs raw in `receipts.json` under `receipts`, and mask them in `log.txt`. Call it again when the course says something changed, because a repeat call can carry an `update` field.

## 3. Write `ticket.md` before the work

Copy [ticket.md](ticket.md) from this folder and fill it from the start-challenge reply and the page. Acceptance is the part that matters: one checkable line per thing the course will look at. Fill the "Who it is for / how we'd know it helped" line too: who the result serves and what in its own output would show it helped, with numbers. Acceptance answers to the course; this line answers to the user. Show the user the Outcome, that line and Acceptance before starting, and ask them to confirm or change its limits.

## 4. Before every claim: tick Acceptance

When the Challenge feeds you a live stream (a collector, a channel, a feed, a page that grows), poll it once more as the last step before you build the claim body, and again after every refused claim before you change anything. If the poll brings something new, apply it and rerun your checks first. The `recheck-sources` Stop hook does not cover this: it runs when a turn stops, not before a claim (S03E02: a withdrawal arrived after four empty polls, first claim refused; ADR 0011).

A hook on `claim-challenge` (`.claude/hooks/claim-gate.mjs`) denies the claim while any Acceptance line in the ticket.md of the folder whose `receipts.json` holds that `challengeId` is unticked. A line that can only be ticked once the claim answers (e.g. "claim-challenge returns solved") carries `(after claim)` and is skipped. Check each line against the real result (run the count, open the link, read the issue's state), tick it, and claim only when all are ticked. When a claim is refused, add the missing check as a new Acceptance line and a line in Notes.

When the answer rests on speech (a memo, a call, a video's audio), add the Acceptance line "Every spoken tag or value was checked by ear, not only by transcript" and tick it only after you or the user listened at each second you cite. A transcript swaps letters, and a second run repeats the same mistake (S03E01: "RH-5-H" for R-Z5H, first claim refused).

Also check the real output against the "Who it is for" line, preferably with a small script in the lesson folder (S02E05: `check-helped.mjs`). This check does not block the claim, since the gate reads only Acceptance, but write its result in Notes and tell the user before claiming when it fails.

## 4b. After each accepted step: re-read the Challenge page

When a claim comes back `progress` (a step passed, not yet solved), read the signed-in Challenge page again and call `start-challenge` again before the next step. Owners answer there, and the claim reply only hints at it (S03E01: "one of them answered you"; the answer to the date conflict was only on the page). Log what changed, apply it to the next step, and tell the user which questions are still open.

## Issue work

When the user approves an issue split and what every issue carries, write that shape into the Challenge repo (its issue skill, or AGENTS.md) in the same push as the issues.

## Public uploads

Use the `netlify-upload` skill, and ask the user before each upload.

## 5. After a claim is accepted

Invoke the `challenge-close` skill. It owns everything that happens after the solve: outcome.md, CLAUDE.md, and memory.
