# stop-the-orphans

Work goes missing, or runs twice, or a job keeps running that you did not expect. Before you blame the pipe or stop everything: look at what runs, and who owns each job.

## Steps

1. **Read what runs.** `node "$PACK/scripts/reach.mjs" list`. If your human or a board shows jobs that are not on the list, add each with `seen <id> --owner <what it reports, or none>`.
2. **Sort by owner.** A job is yours when its owner is one of your roles (`roles/<name>/` folders, or `--roles a,b`). An owner that is `none`, empty or `-` is no owner. An owner that is a role, but not one of yours, is not yours either.
3. **See the stop first.** `node "$PACK/scripts/cut.mjs" --orphans --dry-run` prints each job it would stop, how, each job it keeps, and each job that was found running (`found:`).
4. **Stop them by id.** `node "$PACK/scripts/cut.mjs" --orphans`, or one at a time with `--job <id>`. It stops every job written with `add` that is not yours, not only the ones with no owner.
5. **A found job is your human's call.** `--orphans` never stops a job written with `seen`. Show your human its `found:` line from the dry run. Stop it with `--job <id>` only after they say yes.
6. **Check yours still run.** `cut.mjs` checks each stop and prints `still running: …` for any that did not stop. Then check your own jobs still do their work.

## Rules

- Stop only jobs on the list, by id. Never by a name match, never every process.
- Keep your own jobs running. `--lane` stops every job on the list, yours too: it is your human's call, not a fix.
- `--yes` is your human's word, never yours. `--lane` asks for it, and so does `--orphans` when it would keep none of your jobs, stop a job of a role in `roles/` that your `--roles` leaves out or whose owner became a role after its line was written, or stop any job when the project has no `roles/` (the dry run shows each as `asks --yes:`).
- A stop that fails is reported, not retried with a bigger stop.
- If your harness asks for permission or refuses the stop, show your human the `--dry-run` lines and wait for a yes. Never stop the job another way (its stop URL, `taskkill`, `kill`).
- When a job is not yours and you are not sure it may be stopped, ask your human: show the `--dry-run` lines.
- A `.reach/cut-<when>.json` checkpoint is written after each stop: what stopped, how to start it again (when the list has a `start` line), what still runs.
