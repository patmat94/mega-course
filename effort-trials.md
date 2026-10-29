# Effort trials

Which reasoning effort to use for a recurring task, tried side by side. One section per task.

## rook-search sweep (2026-10-29)

Same brief for both runs: project-wide scope (mega-s01e01–03, without `repo/` and `download*/`), no website steps, no rook calls, read-only. Subagents on Opus 5.5.

| | low | high |
|---|---|---|
| Tokens | 65,577 | 73,040 (+11%) |
| Tool calls | 5 | 11 |
| Time | 33 s | 78 s |
| Rook's lines found | all of them | all of them |
| Not-Rook hits counted as traces | yes: findings.md, the body*.json copies ("~14 traces across 10 files") | no: marked copies and the user's own quotes as not traces ("~10 traces") |
| New threads | 1 ("check it anyway") | 3 ("nothing arrives whole", "the feature that didn't ship", "the deal / the arrangement"), each with a trace in two lessons |
| Missing debriefs in S01E01, S01E02 | found | found |
| Proposed skill changes | 6, two of them about tooling (`find` denied) | 6, all from traces with line numbers |

Spot checks: "line 06" is in `mega-s01e01/log.txt`; "that's the deal." is in `rook-message.txt`; neither S01E01 nor S01E02 log holds "In your record".

**Keep: high.** It costs about 11% more tokens and twice the time, and it gives a cleaner count and the threads that tie lessons together, which is what the sweep is for. Low is enough for a quick "is there anything new?" check before a deeper run.
