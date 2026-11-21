# Rule: stop the jobs no role of ours owns

Copy this into the project's rules (for example `AGENTS.md` or `CLAUDE.md`) and fill in the blanks.

**When.** Work goes missing or is done by a job we did not start, or `reach.mjs list` shows a job whose owner is not one of our roles.

**Our roles.** ______ (the folders in `roles/`, or the list your human names).

**What the agent may do on its own.**

1. Run `reach.mjs list`, and `seen` for each running job that is not on the list.
2. Run `cut.mjs --orphans --dry-run` and show the lines.
3. Run `cut.mjs --orphans` for the jobs it showed as `would stop` (jobs written with `add` that no role of ours owns), or `cut.mjs --job <id>` for one of them.

**What only our human decides.**

- Stopping a job that was found running (`seen`, shown as `found:`): `cut.mjs --job <id>`, after the dry run.
- Stopping a job whose owner is one of our roles.
- Anything with `--yes`: `cut.mjs --lane` (every job on the list), and `--orphans` when it would keep none of our jobs stop a job of one of our roles in `roles/` (one made after its line too), or stop any job when the project has no `roles/` (shown as `asks --yes:`).
- Stopping anything that is not on the list.

**When the harness says no.** If the harness asks for permission or refuses a stop, the agent shows our human the `--dry-run` lines and waits for a yes. It never stops the job another way (its stop URL, `taskkill`, `kill`).

**Scope.** This project's `.reach/` list only. Never a process by its name, never a job of another project.

**After.** Read the `still running:` lines and the checkpoint in `.reach/`, and tell our human what was stopped and what still runs.
