---
name: challenge-close
description: Use when a MEGA.dev challenge claim is accepted — to write outcome.md, and update the Lessons table in CLAUDE.md (the one home for course progress). Invoked by challenge-start after a successful claim, or directly when the user says the challenge is solved.
---

# challenge-close

## 1. Write `outcome.md` in the lesson folder

Fill `mega-sXXeYY/outcome.md` from the template in `.claude/skills/challenge-start/outcome.md`. Three to six sentences:

- What was handed in and where (repo URL, commit, Netlify link, or whatever the challenge accepted).
- How many claims it took and what each refused claim was missing.
- Whether the result met the ticket's "Who it is for / how we'd know it helped" line, with the measured number, even when the course accepted it.
- Anything the next lesson must know (a tool installed, a pattern that failed, a constraint discovered).

Git and `log.txt` carry the dates — do not repeat them.

## 2. Update the Lessons table in `CLAUDE.md`

Find the row for this lesson code and fill in the State column:

```
solved YYYY-MM-DD; <one-line summary of what was delivered and any key notes>
```

Keep it short — one line. Longer notes go in `outcome.md`.

## 3. Memory holds no progress

The Lessons table is the only home for course progress. Do not copy lesson states into memory. Save a memory only for a fact the repo does not record (a tool installed or signed in on this machine, a user preference).
