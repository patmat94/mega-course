# Judge: Host Desk reviewer

Replays sealed Cases against the reviewer (`mega-s04e01/starter/host-desk/roles/reviewer`) and prints one bare line per case. Decision: `docs/adr/0022-suites-after-every-commit-and-sealed-cases-judge.md`.

```
node agents/judge/judge-reviewer.mjs                     # real run: Pi + MODEL (default anthropic/claude-sonnet-5-5), ~15 s a case
node agents/judge/judge-reviewer.mjs --fake-pi expect    # harness check, no model: all pass
node agents/judge/judge-reviewer.mjs --fake-pi flip      # harness check, no model: all fail
node agents/judge/judge-reviewer.mjs --desk <host-desk>  # judge a proposed Revision instead of the repo's
```

Lines: `pass <case> rev <hash>`, `fail <case> rev <hash> <hunk> expected <v> got <v>`, `error <case> <why>`. Exit 0 = all pass, 1 = a case failed, 2 = could not run (also a broken seal).

- **Cases:** `~/mega-sealed/reviewer/cases/<id>/case.json` (`JUDGE_SEALED` to move them). Each holds its settings, its patch, the expected verdict per hunk and its `source`. `MANIFEST.json` pins a sha256 per case, and a changed case is `error seal`. Agents are denied the folder in `.claude/settings.json`. Only a human adds or changes a Case, and then rewrites the manifest.
- **Revision:** the hash of `roles/reviewer/` (without `.start`, `runs.jsonl`, `test`), `roles/plane-start.mjs` and `why/`.
- **Trial:** a temp desk with a copy of the Revision. Only `https://hq.mega.dev` in ROLE.md and reads.json is pointed at a stub on 127.0.0.1, with a throwaway ATTEMPT. Like the course, the stub takes the first JSON review that names every hunk, and it never tells the reviewer the verdict.
- **From the hook:** `git config hooks.judge true` makes post-commit run this when a commit touches the reviewer, `why/` or this folder. It is off by default because it spends model tokens.

## Results

| Date | Revision | Cases | Result |
|---|---|---|---|
| 2026-11-21 | 0b4142b8bbbf, the reviewer in this repo | 01, 02, 03 | 3 pass, exit 0, 24 s |
| 2026-11-21 | 6949238ffebf, the given S04E02 reviewer (`mega-s04e02/dl/x` + `reviewer-ROLE.given.md`, 15 % pinned) | 01, 02, 03 | `fail 01 h-bf3 expected flag got pass`, `pass 02`, `fail 03 h-99c expected pass got flag`, exit 1, 49 s |

Both ran on `anthropic/claude-sonnet-5-5`. The baseline fails case 01 on h-bf3, as the course refused it in S04E02 (`mega-s04e02/log.txt:24-27`). It passes 02 only because its pinned 15 % happens to match that case's settings.
