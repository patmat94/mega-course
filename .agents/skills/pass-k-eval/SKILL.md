---
name: pass-k-eval
description: Use when you turn a solved task, a join, a prompt or a skill into a small repeatable eval, or when you need to know how reliably an agent, script or skill gets an answer right — runs a cases file k times with one command and reports pass@1, pass@k and pass^k.
metadata:
  version: "1"
---

# pass-k-eval

One command scores a small cases file k times against any subject (a script, `claude -p`, an API call) and reports:

- **pass@1**: share of all attempts that passed
- **pass@k**: share of cases that passed at least once in k runs ("can it ever?")
- **pass^k**: share of cases that passed in **every** run ("can I rely on it?"). This is the number to record.

A deterministic subject (a plain script) gives the same marks every run, so pass^k = pass@1, and the k runs only check that nothing flakes. For an agent, pass^k is usually well below pass@1.

## Steps

1. **Pick the task.** Take something already solved, with a known right answer. The best source is the step that went wrong or nearly went wrong (in S02E04, the time-zone join).
2. **Write `eval/cases.jsonl`** next to the work, about 10 cases, one JSON object per line: `id`, `expected`, plus whatever fields the subject needs. Include:
   - the real case from the solve,
   - the trap that fooled you or could have (the naive reading),
   - edge cases where the right answer is "two answers", "no answer" or "refuse".
   Work out `expected` **by hand from the source rules, never by running the subject.** An eval whose expectations came from the subject only checks that the subject agrees with itself. Write how you derived them in a `//` comment at the top of the file.
   `expected` is a string or an array of accepted strings. `"match": "contains"` loosens a case to a substring check.
3. **Write a subject adapter** (`eval/subject-*.mjs`): it reads one case as JSON on stdin and prints **one normalised answer line** on stdout, in the same shape as `expected`. All parsing of messy output happens here, not in the runner. For an agent subject, the adapter calls `claude -p --output-format json` (or similar) and prints the answer field it extracts.
4. **Run it once with a broken expectation** (copy the file to the scratchpad and change one `expected`). The run must show F and exit 1. If it still passes, the adapter or the comparison is wrong.
5. **Run k times with one command** (k = 3 by default):

   ```
   node <this skill's folder>/scripts/evalk.mjs --cases eval/cases.jsonl --k 3 -- node eval/subject-x.mjs
   ```

   Options: `--out file.json` (default `eval/runs/<cases>-<time>.json`), `--timeout <s>` per attempt (default 300), `--shell` for a subject that is a `.cmd` or `.bat` on Windows (`claude`, `npx`). Exit 0 means pass^k is 100%, 1 means some case failed a run, 2 means a usage error.
6. **Record it** in `eval/RESULTS.md`: date, the command, the pass@1 · pass@k · pass^k line, the path of the runs file, and one line on what a failure would mean. In a lesson folder, append the command and the summary line to `log.txt` too.

## Rules

- The cases file holds no secrets: it is meant to be committed.
- Keep it small (5 to 20 cases). Ten good cases beat a hundred similar ones.
- When a later change touches the task, rerun the same command and compare the summary line with `RESULTS.md`.
- For an agent subject, add the cost: run with `--k 1` first and read the cost per attempt before you run k = 3.

## Done

- `eval/cases.jsonl` has its `//` derivation note, and every `expected` was worked out without the subject.
- The broken-expectation run failed as it should.
- `eval/RESULTS.md` records the command and the pass^k line, and names the runs file.
