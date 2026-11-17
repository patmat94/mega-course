---
name: run-alone
description: Use when the same work repeats over a list of items and should run with no one watching, such as a nightly batch. The routine runs as job.mjs under run-job.mjs, inside a time budget and an item cap that the program owns; you read the exit and handle only what the script parks.
---

# run-alone

Routine work belongs in code. A model that does each item by hand can slip on any of them, and it can always give itself one more turn. A script does each item the same way, and a program that owns the clock stops it. You write the job once, then you decide only what the script cannot. The scripts sit in `scripts/` in the pack folder, two levels above this file.

## Rules

1. **Agree the limits with your human before the run.** The items, what done means for one item, the time budget and the item cap. Ask: "This runs over `<items>`. It may take `<time>` and at most `<n>` items. Is that right?" Pass their numbers as flags. Never put a limit in `job.mjs`, and never raise one yourself. Check: `--budget` and `--max-items` hold their numbers.
2. **Write the routine as `job.mjs`.** Start from `templates/job.mjs`. `handle(item, ctx)` does one item and returns `{ done: true }`, or `{ park: "reason" }` for a call your human makes. It sends with `ctx.send` only, so each secret goes only to its own hosts (`bind-secrets`): no `fetch` or other client, and no read of `process.env`, `vars.json` or a secret's value. A job never writes in `parked/` or `finished/`: the runner parks, your human decides. No model call in `handle`. Check: every case `handle` meets returns `done`, `park`, or throws, `job.mjs` sends nothing but through `ctx.send`, and it writes no file in `parked/` or `finished/`.
3. **Try one item first.** Run with `--max-items 1` and read the trace. Check: in `trace.jsonl`, the line after the item's `started` line says `done` or `parked`, as you expected.
4. **Run it, and keep out of it.** From the job's folder:

       node scripts/run-job.mjs --job job.mjs --items items.jsonl --budget 10m --hosts hosts.json

   The job runs in a process of its own, with no secret in its environment. The runner ends it when the budget is spent, even mid-item, with every process it started. While it runs, you wait. Check: you did not do items by hand next to the run.
5. **Read the exit line, and act on that exit only.**

   | Exit | What you do |
   |---|---|
   | `done` | Report the items done, parked and left. Parked items go to `park-for-owner`. |
   | `failed:<id>` | The run stopped at that item. Read its error, fix `job.mjs` for that kind of item, try that item alone, then ask your human before the next run. |
   | `failed:job` with `set during the run, by code or by your human`, `appeared during the run` or `is not named exactly` | Set during the run, by code or by your human: your human decides it again after the run. Tell your human the line and finish none of those items. If your human did not decide during the run, find the write in `job.mjs`. |
   | `budget_spent` | Not done. Tell your human how many items are left, and which item was unfinished. A new run or a bigger budget needs their yes. |
   | `stopped` | Your human stopped it. Report and wait. |

   Check: your report names the exit as the runner printed it.

   When items are left, the exit line names `left.jsonl`: the items that never started, in order. The next run, after your human's yes, is `--items left.jsonl`. Never pick items by hand, and never read the trace to choose them. Check: the next run's `--items` is `left.jsonl`.
6. **An unfinished item may have sent part of its work.** When the exit names one, tell your human before anything runs that item again. Check: your report names it.
7. **A refusal parks the item, and the run goes on.** When `ctx.send` is refused and `handle` does not catch it, the item is parked with the refusal line as its reason. A reason that ends `the API may have acted` means the first host got the request before the redirect was refused: report that item as "may have acted", never as not done or not sent. Any other throw is `failed:<id>`. An exit line with `refused after done: <id>` means a send that item left running was refused after the item was traced `done`: report that item as "may have acted" too. So does `sends cut: <id> (may have acted)`: a send that item left open was cut when the run ended. A `refused` line in the trace before an item's `done` is a refusal the job caught: report it too. Check: your report quotes the reason.
8. **No exit line means the run was killed.** When the last line of `trace.jsonl` is an item's `started` line, with no result and no exit line after it, tell your human: "The run was killed; `<id>` may have sent part of its work." Check: you did not start a new run before their answer.

## Example

Your human: "Post last night's 40 station readings to the weather API. Give it five minutes."

1. Agree: "The run goes over `readings.jsonl`, 40 items, at most 5 minutes. Is that right?" Your human: "Yes."
2. Write `job.mjs` from the template, then run with `--max-items 1`. The trace says `{"id":"r1","result":"started"}`, then `{"id":"r1","result":"done","ms":212}`.
3. Run with `--budget 5m --max-items 40`. The last line: `exit: done · 38 done · 2 parked · 0 left`.
4. Tell your human: "Done: 38 readings posted, 2 parked for you. They are in `parked.mjs list`."

## Done looks like

- The work ran through `run-job.mjs`, with the limits your human named.
- Your report gives the exit line as printed, with what is left and what is parked.
- You did no item by hand.
