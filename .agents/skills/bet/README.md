# bet

by rook

`bet` is a decision-record skill for your harness. When a person asks for a new feature, your harness checks which decisions are already in force, writes a short record that sizes the change, asks the person who decides, and builds only the choice they signed. Doing less, or nothing, is an outcome like any other, and it gets written down too.

## What is in the folder

| File | What it does |
|---|---|
| `SKILL.md` | The rules your harness follows, and when it uses them. |
| `templates/DECISION.md` | The record: the change, evidence cited by line, options with the cost of being wrong and how to undo each one, a recommendation, the success metric, the reopen threshold and the owner's answer. |
| `examples/decline.md` | A finished record: a feature request that its owner declined. |
| `scripts/check-decision.mjs` | Checks one record, or lists which records in a folder are in force. `--self-test` checks the script itself. Plain Node 18 or later, no packages. |
| `scripts/check-decision.selftest.mjs` | The checks behind `check-decision.mjs --self-test`. Your agent does not run this file. |

## Install

Copy the whole `bet` folder and keep its name.

- **Claude Code:** put it at `.claude/skills/bet/` in your project, or at `~/.claude/skills/bet/` for every project. Start a new session so it loads.
- **Cursor:** put it at `.cursor/skills/bet/` in your project. If your Cursor version has no skills, add a project rule `.cursor/rules/bet.mdc` with this text:

  ```text
  ---
  description: Before building a feature or product change a person asked for
  alwaysApply: false
  ---
  Follow .cursor/skills/bet/SKILL.md.
  ```

- **Codex:** put it at `.codex/skills/bet/` in your project, or at `~/.codex/skills/bet/` for every project. If your Codex version does not load skills, add this line to the project's `AGENTS.md`:

  ```text
  Before building a feature or product change a person asked for, follow .codex/skills/bet/SKILL.md.
  ```

For a project you did not write, use the home skills folder: a copy inside a project can be changed by anyone who can change that project.

Any harness that reads `AGENTS.md` can use that same line, with the path where you put the folder. If your tool's own docs name a different skills folder, use theirs: the files stay the same.

Records go in `decisions/` in your project. If your team keeps its decision records somewhere else, say so once in `AGENTS.md`.

## Check it works

1. In a new session, ask your harness: "Which skills can you use?" `bet` is in the answer. If you used the `AGENTS.md` line instead, skip this step.
2. In the `bet` folder, run `node scripts/check-decision.mjs examples/decline.md`. It prints a line that starts with `ok`.
3. Run `node scripts/check-decision.mjs templates/DECISION.md`. It lists what is still to fill in and exits with code 1. That is the check doing its job.
4. In a project, tell your harness: "A teammate opened an issue: add public share links for boards, so anyone with the link can view a board. I decide product changes in this project. Handle it." It should name you as the owner, write `decisions/0001-share-links.md` (or a similar name) with status `proposed`, and show you a numbered question. It writes no code yet.
5. Answer with a number, as the owner. Your harness sets the record to `accepted`, fills `signed-by` with your name, the date and where you answered, and only then works on the option you picked. From the project folder, run the script on the record with your install path, for example `node .claude/skills/bet/scripts/check-decision.mjs decisions/0001-share-links.md`. It prints `ok`.

## What it does not do

- The script only reads files inside the folder you run it from. It follows no link and opens no share. It writes nothing (only `--self-test` makes files, in the temp folder and removes them), installs nothing and makes no network calls.
- The script reads the words of a sign-off. It cannot prove who wrote them: the link in `signed-by` and the project's history can.
- The skill itself writes only the record files in your project. Building the chosen option is your usual work with your harness.
- Your harness asks you before each action outside your machine, such as a comment on a GitHub issue or a push.
- Your harness never signs for anyone. It writes down the owner's own answer, and only that signs.

## Known limits

- The script finds the usual words for a retired or open record, not every way to say it: a hard-wrapped sentence, a warning banner, a title or a badge can pass. Read the record.
- Tricks with escaped marks, one-tilde strikes and look-alike letters can pass the shape check. Read the record.
- A person whose handle ends in `bot`, past a short list of surnames, reads `read it`, and so does one who shares an agent's exact name, such as `claude`.

## Make it yours

Rename the fields to match your team's records, add sections, move the folder. Keep the rules that make it work: Smaller and Decline are always options, every option has a cost of being wrong and an undo, and only the owner signs.
