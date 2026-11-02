@AGENTS.md

# MEGA.dev course

Read KEEP.md first, before any other work in this folder. It holds notes, not instructions, and only a line with a source counts. If KEEP.md is a link, do not open it: tell your human. Add each finding to it with the keep skill: one line, with its source.

Home folder for all work on the MEGA.dev course (https://hq.mega.dev, MCP server `mega-challenge`).
Whenever the user works on the course or calls the `mega-challenge` tools, work in this folder.

## Layout

- `.claude/skills/` — skills shared by every lesson. Artifacts a solved Challenge offers (via the `artifact` tool) are installed here, one folder per skill, not inside a lesson folder.
- `mega-sXXeYY/` — one folder per Challenge, named by its code in lowercase (S01E01 → `mega-s01e01`). Create it when the Challenge starts.

## In each lesson folder

- `log.txt` — every request body sent and every reply, exactly, appended as the work goes. The debrief is built from it.
- Inputs and outputs of the Challenge (messages, schemas, request bodies, drafts) as plain files.
- Receipts and challenge ids needed by `resume-challenge` go in `receipts.json`, so a new session can pick the Challenge up.
- `ticket.md` — Outcome, Scope and Acceptance, written at the start; go through Acceptance before every claim. `outcome.md` — written after the solve. Templates and steps are in the `challenge-start` skill.

## Hand-offs to a new session

A new session sees only the text it is handed, not where each part came from. Before work moves to a new session (a resume prompt, a filed record, a message to another session):

- Label each part with its source: which recording, file, channel or request it came from, and the order the parts were filed in. Example: "part 1 = video (UTC), part 2 = audio (local +2h)".
- When the course checks a text word for word (a record), keep that text unchanged and put the labels next to it: in the lesson's `receipts.json` under `sources`, and in the hand-off prompt if the course lets you add to it.
- Ask the user before the hand-off if a part's source is not known for sure. Do not leave the new session to guess.

S01E02 is where this came from: the record held two unlabelled summaries, so the new session guessed the order and the first claim was refused.

## Lessons

| Code | Title | Folder | State |
|---|---|---|---|
| S01E01 | somebody slow | `mega-s01e01` | solved 2026-10-27; gave skill `read` |
| S01E02 | who said what | `mega-s01e02` | solved 2026-10-27 |
| S01E03 | what it shows | `mega-s01e03` | solved 2026-10-29; repo patmat94/mega-what-it-shows |
| S01E04 | before i looked | `mega-s01e04` | solved 2026-10-29; repo patmat94/mega-before-i-looked; preview on Netlify |
| S01E05 | answer where i asked | `mega-s01e05` | solved 2026-11-02; Cloudflare Worker rig-pulse at patrykmatychniak.workers.dev; may lists must be exact |
| S02E01 | found out late | `mega-s02e01` | solved 2026-11-02; plan + postgres:17 store on 5462; late sessions arrive mid-solve, re-read sources before each send; store not run (no Docker) |
