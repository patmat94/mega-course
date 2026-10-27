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
