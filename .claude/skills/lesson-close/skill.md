---
name: lesson-close
description: Use when a MEGA.dev challenge claim is accepted — to write outcome.md, update the Lessons table in CLAUDE.md, and update the course progress memory. Invoked by new-lesson after a successful claim, or directly when the user says the challenge is solved.
---

# lesson-close

## 1. Write `outcome.md` in the lesson folder

Fill `mega-sXXeYY/outcome.md` from the template in `.claude/skills/new-lesson/outcome.md`. Three to six sentences:

- What was handed in and where (repo URL, commit, Netlify link, or whatever the challenge accepted).
- How many claims it took and what each refused claim was missing.
- Anything the next lesson must know (a tool installed, a pattern that failed, a constraint discovered).

Git and `log.txt` carry the dates — do not repeat them.

## 2. Update the Lessons table in `CLAUDE.md`

Find the row for this lesson code and fill in the State column:

```
solved YYYY-MM-DD; <one-line summary of what was delivered and any key notes>
```

Keep it short — one line. Longer notes go in `outcome.md`.

## 3. Update `memory/project_mega_course_progress.md`

Add or update the line for this lesson under the solved entries. Update the `asof` field in the frontmatter to today's date.
