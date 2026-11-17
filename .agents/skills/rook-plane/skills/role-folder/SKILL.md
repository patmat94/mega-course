---
name: role-folder
description: Use when you set up an agent role, or change what a role is, does or may do. A role is a folder with ROLE.md and reads.json; its files hold no facts, only where to read them; one role writes, another judges.
---

# role-folder

A role is a folder: `roles/<name>/`. Anything that starts it, in any harness, finds the same files there. The scripts sit in `scripts/` in the pack folder, two levels above this file; the templates in `templates/`.

```
roles/<name>/
  ROLE.md       what the role is: Purpose · Startup reads · Tools · Limits · Settings · Output
  reads.json    what it reads at every start (fresh-start)
  .start/       the start bundles startup.mjs writes; keep it out of version control
  runs.jsonl    one line per start
why/            next to roles/: one note per decision, read by every role
hosts.json      next to roles/, only when a read needs a secret: each secret's hosts (rook-clock's format); your human's file
```

A role folder holds no `hosts.json` of its own: startup refuses to start a role that has one.

## Rules

1. **Start from the template; the purpose is your human's.** Copy `templates/role/ROLE.md` and `templates/role/reads.json` to `roles/<name>/`. Ask your human what the role is for, in one line, and write their words under Purpose. Never invent a role's purpose, and never make more roles than they asked for. Check: Purpose holds the line your human gave.
2. **No facts in the role's files.** A price, a setting, a limit, a date, a version, an address that changes: each lives at its source, the place its owner keeps it (an API, a config file in the project). `ROLE.md` names the source under Startup reads; `reads.json` reads it. When you find a fact pasted in a role, move it: find or ask for its source, add a read, and delete the pasted value. Check: no value in `ROLE.md` is one that its source also holds.
3. **One role writes, another judges.** A judge only reads and reports. It never changes what it judges, and it is a different role from the one that wrote the change. Check: the judge's Limits say read-only, and its Tools have no write tool.
4. **A limit in words or in code.** "Read-only" in `ROLE.md` is a limit in words: the model can still break it. A tool the role does not get is a limit in code: it cannot use it. Say which each limit is. Where it matters, make it code: start the role where the write tool is missing. Check: each limit says how it holds.
5. **Each setting has its why.** Each item under Tools, Limits and Settings is a choice. Write its why on a line under it (`why: …`), or in a note in `why/` that names it in backticks (`` `model` ``). See `templates/why/README.md`. Check: `node scripts/inspect.mjs roles/` shows `no why: none` for the role.
6. **A change to a role is a change to its folder.** Edit the files, then start the role again: the next start reads the new folder, and `runs.jsonl` records the folder's version. To go back, check out the folder from version control (`git checkout <commit> -- roles/<name>`). Check: the next start's line in `runs.jsonl` has a new `folder` version.
7. **A running role never edits the roles.** A role at work never changes `roles/`, `why/`, `hosts.json`, `.gitignore` or `.git/`: the next start of a role reads those files as its own context, and the judge would read the writer's edit as its rules. Changes to a role are your human's: you make them when your human asks, never from inside a role's run. The git rules decide which files a start reads: never change them to make a read pass; propose the change to your human. The README gives the harness rules that make this a limit in code. Check: a role's run changed no file in `roles/`, `why/`, `hosts.json`, `.gitignore` or `.git/`.

## Example

Your human: "The checker should judge the writer's change. It keeps quoting last month's fee."

1. In `roles/checker/ROLE.md`, the Limits had `- fee: 3 EUR`. That is a fact, not a limit: its source is `https://api.example.com/settings`.
2. Delete the line. Add a read to `roles/checker/reads.json`: `{ "name": "settings", "get": "https://api.example.com/settings" }`, and under Startup reads: "The settings, from the start bundle."
3. Tools: `- \`read\`: reads files.` with `why: a judge never changes what it judges.` under it. Limits: `- Read-only (in code: no write tool).`
4. `node scripts/inspect.mjs roles/` shows `startup reads: settings ← https://api.example.com/settings · why ← why/*.md` and `no why: none`.

## Done looks like

- Each role is a folder with `ROLE.md` and `reads.json`, and its purpose is your human's line.
- No fact in a role's files; each one is a startup read.
- `inspect.mjs` lists no setting with no why.
