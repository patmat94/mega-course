# S02E04 join eval: results

Subject: crew's `one-clock.mjs` (join-results rule 3), driven by `subject-one-clock.mjs`. 10 cases in `cases.jsonl`: the job-1 record, the desk note it joins to, the naive trap, two times that happened twice (US and EU fall-back), two that never existed (US and EU spring-forward), an own-offset time, a refused short name (`EST`), and an `@into` moment.

Command, from the repo root:

```
node .agents/skills/pass-k-eval/scripts/evalk.mjs --cases mega-s02e04/eval/cases.jsonl --k 3 -- node mega-s02e04/eval/subject-one-clock.mjs
```

| Date | pass@1 | pass@3 | pass^3 | Runs file |
|---|---|---|---|---|
| 2026-11-09 | 100% | 100% | **100% (10/10)** | `runs/cases-2026-11-09T10-08-41-254Z.json` |

Check of the check: the same cases, with the three `2026-11-01T02:50:00Z` expectations changed to `03:50Z`, scored 7/10 and failed. So the 100% is not the runner passing everything.

one-clock is deterministic, so pass^3 = pass@1 here, and the three runs only show it does not flake. The same cases can score an agent doing the join (an adapter that calls `claude -p`), where pass^3 would mean something more.
