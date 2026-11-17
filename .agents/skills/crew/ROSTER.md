# Roster

The members you hand jobs to. One row per member, the main agent included. Work from a copy of this file in the project folder. Fill a member's row before its first brief, and correct it after each run.

| Member | Where it runs | Skill it carries | Access it needs | Way home and receipt |
|---|---|---|---|---|
| main | this machine, this session | crew, version 1 | the briefs, this roster, the files in `results/` | none: it writes the answer |
| | | | | |

## The columns

- **Member:** a short name you use in briefs and in the answer's source tags, such as `inbox-reader`.
- **Where it runs:** the machine and the kind of worker: a subagent here, a second session here, a cloud harness, or a CI run. Say whether it has its own MCP connection or uses the main agent's. After the run, write where it actually ran.
- **Skill it carries:** the skill's name and version, and how it gets there: pasted in the brief, or a folder in the worker's own setup, with its path.
- **Access it needs:** each link, tool, file or account the job needs, and how the worker reaches each one in the place it runs. Write the name of a key, never a key itself: this file can end up in git. A link with a token or a signed ticket in it counts as a key.
- **Way home and receipt:** where the result lands, its shape, and the receipt that comes with it.

## Checks

- No empty cell. An empty cell is a question for your human or a gap in the brief.
- A member that runs elsewhere has a way home that names a place you can read from here.
- Every skill in the table has a version.
- After a run, "Where it runs" says where it ran, not where it was meant to run. A run set to run elsewhere can still start on this machine: check where the run says it ran, or ask the worker.

## Example rows

| Member | Where it runs | Skill it carries | Access it needs | Way home and receipt |
|---|---|---|---|---|
| inbox-reader | this machine, a subagent with its own context | `read-export`, version 2, pasted in its brief | the file `exports/inbox.csv` in this folder | writes `results/inbox-reader.md` · receipt: the sha256 of `exports/inbox.csv` |
| ci-runner | a CI run on your human's account | `failure-scan`, version 1, a folder in the repository at `.claude/skills/failure-scan` | the repository's CI history, from inside the run | the run's artifact `failures.txt`, which your human downloads into `results/` · receipt: the run's id on its first line, looked up in the repository's CI history |
