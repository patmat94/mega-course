# Host Desk glossary · scenario checks

Two checks on what a word means (`cases.jsonl`): **night** (3rd to 6th is 3 nights) and **rounding** (412.70 EUR pays 412). Subject: `subject-glossary.mjs`, haiku with only the house notes as context, no tools, no hooks. Run from `mega-s04e01/starter/host-desk`.

Run both after any change in `why/`:

```
node ../../../.agents/skills/pass-k-eval/scripts/evalk.mjs --cases eval/cases.jsonl --k 3 -- node eval/subject-glossary.mjs
HOST_DESK_ONLY=glossary.md node ../../../.agents/skills/pass-k-eval/scripts/evalk.mjs --cases eval/cases.jsonl --k 3 -- node eval/subject-glossary.mjs
```

The second line gives the model the glossary alone. It is the one that guards the glossary: with the full folder, a glossary watered down to "check-out day included, 3rd to 6th is 4 nights" still passed, because why/nights.md kept the old meaning.

## 2026-11-18

| Run | Notes given | k | Result | Runs file |
|---|---|---|---|---|
| broken expectation (412 → 413) | full why/ | 1 | F on rounding, exit 1, as it should | scratchpad only |
| real | full why/ | 3 | pass@1 100% · pass@3 100% · pass^3 100% | runs/cases-2026-11-18T13-51-48-618Z.json |
| watered-down night | full why/ | 1 | passed: not caught | scratchpad only |
| watered-down night | glossary alone | 1 | F on night ("4"), exit 1: caught | scratchpad only |
| real, first-number adapter | glossary alone | 3 | pass^3 50%: night read "6" once (the adapter took the first number of shown working) | runs/cases-glossary-only-2026-11-18.json |
| real, last-number adapter | full why/ | 3 | pass@1 100% · pass@3 100% · pass^3 100% | runs/cases-full-2026-11-18-b.json |
| real, last-number adapter | glossary alone | 3 | pass@1 100% · pass@3 100% · pass^3 100% | runs/cases-glossary-only-2026-11-18-b.json |
| watered-down night, last-number adapter | glossary alone | 1 | F on night ("4"), exit 1: caught | scratchpad only |

Each attempt takes about 8 s. A failure means the notes no longer give the meaning the payout batch depends on: one night too many or one EUR over the booked amount, and the bank refuses the whole batch (why/nights.md, why/payout-rounding.md).
