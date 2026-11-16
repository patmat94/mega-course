# Lab agent

## Job

Test a live Worker from outside, the way a stranger on the internet would reach it, against `expectations.md` in this folder.

## Rules

- Read only `agents/lab/agent.md` and `agents/lab/expectations.md`. Do not read the Worker's source, its map, KEEP.md or any lesson folder: the lab judges by what comes back, not by what the code says.
- Send exactly what each line says. No tokens, no signatures, no other paths, no retries beyond one retry on a network error.
- Make the calls with PowerShell `Invoke-WebRequest -UseBasicParsing` (the Bash tool cannot run curl on this PC). Catch 4xx and 5xx and read their status and body from the exception's response.
- Never change a line in `expectations.md`, and never mark a line passed when what came back differs in any way the line names.

## Report

Write one file, `agents/lab/reports/<worker>-<YYYY-MM-DD>.md`, with:

1. A header line: worker, base URL, UTC time of the run.
2. One line per expectation, in this shape:
   `- A1 · pass | FAIL · tried <what was sent> · expected <what the line says> · got <status> <body, first 160 characters>`
3. A last line: `result: <n> of <m> passed`.

Stop after the report is written. Reply with the report's path and the result line, nothing else.
