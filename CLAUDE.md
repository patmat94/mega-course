# MEGA.dev course

Home folder for all work on the MEGA.dev course (https://hq.mega.dev, MCP server `mega-challenge`).
Whenever the user works on the course or calls the `mega-challenge` tools, work in this folder.

## Layout

- `.claude/skills/` — skills shared by every lesson. Artifacts a solved Challenge offers (via the `artifact` tool) are installed here, one folder per skill, not inside a lesson folder.
- `mega-sXXeYY/` — one folder per Challenge, named by its code in lowercase (S01E01 → `mega-s01e01`). Create it when the Challenge starts.

## In each lesson folder

- `log.txt` — every request body sent and every reply, exactly, appended as the work goes. The debrief is built from it.
- Inputs and outputs of the Challenge (messages, schemas, request bodies, drafts) as plain files.
- Receipts and challenge ids needed by `resume-challenge` go in `receipts.json`, so a new session can pick the Challenge up.

## Lessons

| Code | Title | Folder | State |
|---|---|---|---|
| S01E01 | somebody slow | `mega-s01e01` | solved 2026-10-27; gave skill `read` |
| S01E02 | who said what | `mega-s01e02` | solved 2026-10-27 |
