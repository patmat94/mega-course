---
name: new-lesson
description: Use when a MEGA.dev Challenge starts or is picked up again — a prompt with "Start challenge S", "I am a student in the MEGA.dev course" or "Call list-challenges. Find S", or a session that resumes a Challenge (resume-challenge, "pick up S0xE0y") — before calling any MCP tool or reading any course page.
---

# new-lesson

## 1. Lesson folder

Folder `mega-sXXeYY/` in the course root, named by the code in lowercase (S01E04 → `mega-s01e04`). If it is missing, create it with an empty `log.txt` and a `receipts.json` holding `{}`:

```powershell
$f = "mega-s01e04"; New-Item -ItemType Directory $f; New-Item -ItemType File "$f\log.txt"; Set-Content "$f\receipts.json" "{}" -Encoding utf8
```

If it exists (a resume), read `ticket.md`, `receipts.json` and the end of `log.txt` before you do anything else.

## 2. Call start-challenge, even when the startPoint is a page

Its reply holds what the page does not: the `ticket` or proofs (often what the Challenge checks), `submit` (the answer shape) and `deliver`. Keep proofs raw in `receipts.json` under `receipts`, and mask them in `log.txt`. Call it again when the course says something changed, because a repeat call can carry an `update` field.

## 3. Write `ticket.md` before the work

Copy [ticket.md](ticket.md) from this folder and fill it from the start-challenge reply and the page. Acceptance is the part that matters: one checkable line per thing the course will look at. Show the user the Outcome and Acceptance before starting.

## 4. Before every claim: tick Acceptance

A hook on `claim-challenge` reminds you of this. Check each line against the real result (run the count, open the link, read the issue's state), tick it, and claim only when all are ticked. When a claim is refused, add the missing check as a new Acceptance line and a line in Notes.

## Issue work

When the user approves an issue split and what every issue carries, write that shape into the Challenge repo (its issue skill, or AGENTS.md) in the same push as the issues.

## Public uploads

Use the `netlify-upload` skill, and ask the user before each upload.

## 5. After the solve

Fill [outcome.md](outcome.md): what was handed in, how many claims it took, and why each refused one failed. Then update the Lessons table in `CLAUDE.md`.
