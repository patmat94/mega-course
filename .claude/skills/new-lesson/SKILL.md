---
name: new-lesson
description: Use when a MEGA.dev challenge start prompt arrives — containing "Start challenge S", "I am a student in the MEGA.dev course", or "Call list-challenges. Find S" — before calling any MCP tool or reading any course page.
---

# new-lesson

Before any other action when a challenge start prompt arrives, the lesson folder must exist. This is the first step — not one of many.

## Rule

1. Extract the lesson code from the prompt. Pattern: `S` + two digits + `E` + two digits (e.g. `S01E02`).
2. Derive the folder name: `mega-` + code in lowercase → `mega-s01e02`.
3. Check whether `mega-sXXeYY/` exists in the course root.
   - **Exists** → note it, continue immediately.
   - **Does not exist** → create it with two seed files, then continue.

## Seed files (new folder only)

```
mega-sXXeYY/
  log.txt          ← empty; every request/response will be appended here
  receipts.json    ← {}; challenge ids and tokens go here for resume
```

PowerShell:
```powershell
$folder = "mega-s01e02"   # replace with actual code
New-Item -ItemType Directory -Path $folder
New-Item -ItemType File    -Path "$folder\log.txt"
Set-Content                -Path "$folder\receipts.json" -Value "{}" -Encoding utf8
```

## What counts as "done"

Folder exists on disk with `log.txt` and `receipts.json`. Then proceed with the challenge.

## Then: call start-challenge, even when the startPoint is a page

After `list-challenges`, call `start-challenge` with the entry's uuid, also when its `startPoint` is a URL. Its reply holds things the page does not: the `ticket` (often the signature the Challenge checks), `submit` (the answer shape for `claim-challenge`) and `deliver`. Save the ticket in `receipts.json` under `receipts`, mask it in `log.txt`. If the tool refuses the Challenge, follow the page.

Call it again before each new claim when the course says something changed ("things moved", "not done yet"): a repeat call can carry an `update` field that points at news on the Challenge page.

S01E03 is where this came from: the page was signed with a name instead of the ticket, and the desk's update was found only after five refused claims.

## Then: write `ticket.md` before the work

Copy [ticket.md](ticket.md) from this skill's folder into the lesson folder and fill it from the `start-challenge` reply and the Challenge page. Acceptance is the part that matters: one checkable line per thing the course will look at (signature, counts, shape of `submit`, state of each issue or file). Show the user the Outcome and Acceptance before starting the work.

## Before each claim: go through Acceptance

Before every `claim-challenge`, check each Acceptance line against the actual result (run the count, open the page, read the issue) and tick it in `ticket.md`. Claim only when all are ticked. When a claim is refused, add what it was missing to Notes and as a new Acceptance line, then fix and check again.

In S01E03, each refused claim missed a check that could have been a line here: count with the desk's own table, sign with the ticket, close the issues as the engineering update says.

## After the solve: write `outcome.md`

After the solve and the debrief, copy [outcome.md](outcome.md) into the lesson folder and fill it: what was handed in, how many claims it took and why each refused one failed, and what the next lesson should know. Then update the Lessons table in `CLAUDE.md`.

## Red flags — stop, go back, do the folder step first

- "I'll create the folder after connecting the server"
- "The folder step can wait until I know the challenge code"
- "I'll do it when I need to write the first log entry"
- "The folder is just housekeeping"

All of these mean: stop, create the folder, then continue.

## Common mistakes

| Mistake | Fix |
|---|---|
| Folder created but `receipts.json` missing | Add it as `{}` — resume-challenge needs it |
| Folder named with uppercase (`mega-S01E02`) | Always lowercase |
| Folder created inside `mega-s01e01/` instead of course root | Check cwd is course root before creating |
| Claiming because the work "looks done" | Go through Acceptance in `ticket.md` first; tick each line from a real check |
| Acceptance written as vague goals ("issues are correct") | One observable check per line: a number, a state, a string on a page |
