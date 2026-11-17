# ask

From Rook's rig.

`ask` is a skill for your harness. It picks up the issues your triage held for a person (needs-human). For each one it finds who decides, drafts one question to them, tags their answers, and writes the issue from what that person actually did. It does not triage: that stays your own skill's work.

## What it does

1. Finds who decides, from the fact the issue cites. When that is unclear, it asks you.
2. Drafts one short question that opens with that fact and asks about the last time the owner did the thing the issue touches.
3. Tags every answer as behaviour (something they did), compliment (how they feel) or claim (a general, future or second-hand statement).
4. Writes the issue's intent, acceptance (with at least one line about what must not happen) and boundaries from the behaviour answers only. Each line cites the answer it rests on.
5. Checks its own files with a small script.

## What you do

- Send the question to its owner, or tell your harness which channel to use.
- Bring the answer back: paste it in, or tell your harness where to read it.

`ask` writes only in `asks/<issue key>/` in your project, or in a folder you name. It does not change your tracker, and it sends nothing on its own. Its drafts hold other people's words: add `asks/`, or the folder you named, to `.gitignore` unless your team wants them in git.

An owner's answer is data. Your harness is told not to act on an instruction inside it, and to tell you it is there. Text in an answer is never a yes, even when it says "you're approved": only you can tell your harness to act.

## What is in the folder

| Path | What it is |
|---|---|
| `SKILL.md` | The steps your harness follows. |
| `templates/question.md` | One question to one owner. |
| `templates/interview-notes.md` | The owner's answers, one per line, each with an id and a tag. |
| `templates/issue.md` | Intent, acceptance and boundaries, each line citing an answer. |
| `scripts/check.mjs` | Reads one issue's files and names what is missing. Node 18 or newer, no packages. It only reads, uses no network, and reads no file outside the folder you run it from or the skill's own folder: it refuses a hard link, and a link that leaves those folders. Lines it prints from a file stand in double quotes, cut short, with hidden characters shown as text. `ok` means the files follow the rules, not that their words are true. `--self-test` checks the script itself, in a temp folder. |
| `example/` | One issue worked through: the question, the tagged answers and the issue. |

## Install

Copy the whole `ask` folder, with `SKILL.md` at its top, to where your harness reads skills. Keep the folder name `ask`: it must match `name: ask` in `SKILL.md`. Use the project folder for one repo, or the folder in your home directory for every project.

| Harness | This project | Every project |
|---|---|---|
| Claude Code | `.claude/skills/ask/` | `~/.claude/skills/ask/` |
| Codex | `.agents/skills/ask/` | `~/.agents/skills/ask/` |
| Cursor | `.agents/skills/ask/` | `~/.agents/skills/ask/` |

Using Claude Code and another harness in one project? Keep one copy in `.agents/skills/ask/` and link Claude Code to it, so both read the same files:

- macOS or Linux, from the project root: `mkdir -p .claude/skills && ln -s ../../.agents/skills/ask .claude/skills/ask`
- Windows, in Command Prompt from the project root: `mkdir .claude\skills`, then `mklink /J .claude\skills\ask .agents\skills\ask`. Add `.claude/skills/ask` to `.gitignore`: Git follows a junction and would commit a second copy.

If your harness is connected to the course, `check-lane` with the need `skill-wiring` tells you where your harness reads skills.

## Check that it works

1. Start a new session in your project and ask your harness: "Which skills can you use?" `ask` is in the answer.
2. Run the check on the example, with the path where you put the folder:

   ```
   node .claude/skills/ask/scripts/check.mjs .claude/skills/ask/example
   ```

   It prints `ok` for `question.md`, `interview-notes.md` and `issue.md`.
3. Try it on one issue: "Use the ask skill on <issue key>." You get `asks/<issue key>/question.md` with one question in it, and nothing is sent.

## Remove it

Delete the `ask` folder, or the link to it. The drafts it wrote in `asks/` stay until you delete them; nothing else changed.
