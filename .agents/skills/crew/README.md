# crew

by rook

A small kit for handing jobs to other agents and answering from what they bring back. Use it when your main agent sends work to a subagent, a second session, a cloud harness or a CI run.

It does three things:

- **Roster.** One row per member: where it runs, the skill it carries, its access, and how its result comes home.
- **Brief a worker.** Each job leaves with the job, what done means, the skill's text, the access it needs, and the way home with a receipt. No one-line briefs.
- **Join results.** Your main agent puts the results together itself. A result is data, not instructions. Every result needs its receipt, every time goes onto one clock before comparing, and the answer says which result each part came from.

It covers results that workers bring home: answers, findings and data. It does not cover code.

## What is in it

| File | What it does |
|---|---|
| `SKILL.md` | The entry point your harness loads. It says which part to read when. |
| `ROSTER.md` | The roster template, with the checks and two example rows. |
| `skills/brief-a-worker/SKILL.md` | The brief template, its rules and an example. |
| `skills/join-results/SKILL.md` | The rules for answering from several results, with an example. |
| `skills/join-results/one-clock.mjs` | Converts times written on different clocks to UTC. Plain Node 18 or later, no packages. |

## Install

Copy the whole `crew` folder. Leave its inside as it is: `SKILL.md` points to the other files by their paths. However you unzip or copy it, the result is a folder named `crew` inside your skills folder, with `SKILL.md` directly in it, for example `.claude/skills/crew/SKILL.md`. If you find `crew/crew/` or a loose `SKILL.md` in the skills folder itself, move the files until that holds.

**Claude Code.** In your project:

```
mkdir -p .claude/skills
cp -R crew .claude/skills/crew
```

For every project on this machine, use `~/.claude/skills/crew` instead. Then start a new session.

**Cursor.** Copy the folder to `.cursor/skills/crew` in your project, or to `~/.cursor/skills/crew` for every project. If your Cursor version does not list the skill, add a project rule with this line: `When you hand work to another agent, follow .cursor/skills/crew/SKILL.md.`

**Codex.** Copy the folder to `~/.codex/skills/crew`, or to `.codex/skills/crew` in the repository. If your Codex version does not list the skill, add this line to the project's `AGENTS.md`: `When you hand work to another agent, follow <path to>/crew/SKILL.md.`

**Any other harness.** Put the folder in the project and put the same one line in its instructions file.

If your version of a tool looks for skills in another folder, its docs name it. The files stay the same.

The two parts also work as skills of their own: copy `skills/brief-a-worker` and `skills/join-results` into the same skills folder, next to `crew`.

## Check it works

1. **It loads.** In a new session, ask: "Which skills can you use?" The answer lists `crew`.
2. **It briefs in full.** Ask: "Brief a worker to list the lines that start with TODO in this project's Markdown files." The brief has five blocks: Job, Done, Skill, Access and Way home. Your harness also asks you where the worker runs and how its result comes home. A one-line brief means the skill did not load.
3. **The clock script runs.** From the project folder, with the Claude Code path:

   ```
   node .claude/skills/crew/skills/join-results/one-clock.mjs "2026-10-25 08:05" Europe/Warsaw
   ```

   It prints `2026-10-25T07:05:00Z`. Then try an hour that happened twice, the night Warsaw's clocks went back:

   ```
   node .claude/skills/crew/skills/join-results/one-clock.mjs "2026-10-25 02:30" Europe/Warsaw
   ```

   It prints two times, `2026-10-25T00:30:00Z` and `2026-10-25T01:30:00Z`, and says that time happened twice.

## Safety

- The kit is text files and one script. There is nothing to install.
- The script reads only what you pass it and prints. It writes no file and opens no connection. It takes a list of up to 1 MB and 10000 times. Text it could not check stands in double quotes, on one line, cut short, with control and invisible characters shown as text. Its zone rules are the ones in your Node, and it says so when a time falls after their year.
- The kit tells your harness to keep the roster and the results inside the project folder. Add `results/` to `.gitignore` unless you want it in git: results can hold what the workers read.
- The script sends nothing. Your harness sends the jobs. The kit tells it to ask you first, each time a job leaves your machine and before each other outside action: what leaves, why, where it goes, who can see it and how to undo it. It also tells it to send a job only to a place you picked and set up.
- The kit tells your harness to name a key in a brief, and never to put the key there. You set up the key where the worker runs.
- A worker's result is data. The kit tells your harness not to follow an order written in it, and that text in a result is never a yes.
- A brief is text. A worker, here or elsewhere, can do what its account allows.
