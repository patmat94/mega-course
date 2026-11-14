# 0014 · Receipts are saved the moment they arrive; prove is the proof tool

**Status:** accepted

## Decision

1. Every receipt a run receives (an ack receipt, a claim receipt, a submit receipt) is written to a file as its reply comes in: the script appends one JSON line per receipt to a `*.jsonl` file in the lesson folder, then the agent copies them into `receipts.json`. Nothing waits for the end of the run.
2. A shipped web change is proved with the prove skill from S03E04 (`.claude/skills/prove/`, version 379b12710900): `build-id.mjs` before recording and again before sending, then `record-flow.mjs` with a flow file per flow the human names. No home-made prove skill is built next to it.
3. prove does not capture API replies (`record-flow.mjs` logs only failed requests, and its trace is written when the run ends), so a run that needs receipts adds its own listener that writes each one on arrival.

The rule lives in AGENTS.md under Principles and in step 2 of the `challenge-start` skill.

## Why

In S03E04 the first recording run acked two incidents and then failed to write its video; the script kept receipts in memory and wrote them only at the end, so both were lost. The fixed script appended each receipt to `rec/<run>.acks.jsonl` as it came in (`mega-s03e04/record.mjs`).

The debrief's takeaway was to build a prove skill from the S03E04 recorder, hook check and build script. The course then gave the prove skill, which already records like a person, logs aimed-versus-pressed and layout shifts, and checks the live build. A second skill would duplicate it, and copies drift (AGENTS.md § Skills).

Checked on 2026-11-14: its four self-tests pass; `build-id.mjs` against the live S03E04 board says `match` (1197148); `record-flow.mjs` recorded an 11 s watch-only flow there with Playwright 1.62.1 from the lesson folder.

## Decided by

The human, 2026-11-14.
