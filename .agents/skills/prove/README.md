# prove

From rook's rig.

A skill for your agent: evidence that a web product works for the person using it. The agent drives the live product in a real browser the way a person does and records it. Then it writes an evidence report that an owner can act on: a link to the recording, each finding as what, when, where and why, and options when the owner has to decide. A build check makes sure the recording is of the build that is live.

## What is in it

| File | What it does |
|---|---|
| `SKILL.md` | The rules the agent follows, each with a check it runs or a question it asks you. Your harness loads this file. |
| `scripts/record-flow.mjs` | Opens the page in Playwright and runs a flow like a person: the pointer moves, pauses, then presses. Writes `video.webm`, `trace.zip` and `timeline.json`, with every entry timed to the video: presses, what was aimed at and what was pressed, layout shifts, elements removed at once, errors, and the build the page named. |
| `scripts/build-id.mjs` | Reads `<meta name="build" content="<sha>">` from the live page and compares it with `git rev-parse HEAD`. |
| `scripts/address-check.mjs` | What the other two scripts use: which addresses they may open, and how they print text from a page. |
| `scripts/browser-proxy.mjs` | The browser's only way out: `record-flow.mjs` sends every request through it, so each one is checked first. |
| `templates/evidence-report.md` | The report: recording link, findings, what works, options for the owner, build check. |

## What it needs

- Node 18 or later, and git.
- Playwright in your project, for `record-flow.mjs` only. The script never installs it. When it is missing, the script stops and prints the commands, and you decide whether to run them: `npm install --save-dev playwright`, then `npx playwright install chromium`. In a project that does not use npm, run both commands in the skill's folder instead. The script finds Playwright there, and your project stays as it is.
- For `build-id.mjs`, a page that names its build: write `<meta name="build" content="<git sha>">` into the head when you build. Another tag name works with `--meta <name>`.

## Install

Copy the whole `prove` folder to where your harness reads skills. Keep the folder name `prove`, with `SKILL.md` directly inside it.

| Harness | For this project | For every project |
|---|---|---|
| Claude Code | `.claude/skills/prove/` | `~/.claude/skills/prove/` |
| Cursor | `.agents/skills/prove/` | `~/.agents/skills/prove/` |
| Codex | `.agents/skills/prove/` | `~/.agents/skills/prove/` |

If you use Claude Code and another harness in the same project, keep one copy in `.agents/skills/prove/` and link Claude Code to it, so the two never drift apart:

```sh
mkdir -p .claude/skills
ln -s ../../.agents/skills/prove .claude/skills/prove
```

On Windows, in a Command Prompt, use a directory junction instead: `mkdir .claude\skills`, then `mklink /J .claude\skills\prove .agents\skills\prove`. Keep the junction out of git: `git add` follows it and commits a second copy.

Harnesses read skills when a session starts, so start a new session after you install.

## Check that it works

Below, `<skill>` is the folder you installed to, for example `.claude/skills/prove`.

1. `node <skill>/scripts/build-id.mjs --help` and `node <skill>/scripts/record-flow.mjs --help` print their options. Nothing is opened.
2. In your project folder, against a page you deployed: `node <skill>/scripts/build-id.mjs https://<your page>`. The `result` line says `match`, `mismatch`, or that the page names no build. For a page on your own machine, add `--local`: `node <skill>/scripts/build-id.mjs http://localhost:3000 --local`.
3. `node <skill>/scripts/record-flow.mjs --url https://<your page> --out evidence/smoke`, with `--local` for a page on your own machine. It prints where the video, the trace and the timeline are, and the moments to watch. Open the video.
4. In a new session, ask your agent which skills it has: `prove` is in the list. Then ask it to record one flow on your page and write an evidence report. It runs the build check first and asks you which flows matter.

## Safety

- The scripts install nothing and upload nothing. They open only the URL you give them, the pages your flow file goes to, and what those pages load. They write only inside the folder you run them from. `record-flow.mjs` refuses an `--out` folder or a flow file outside it, or one reached through a link. If a run is killed, Playwright can leave parts of it in the system's temp folder.
- Only http and https open. An address on this machine or a private network opens only with `--local`, or `--also` for a second one, and only that host and port. Known cloud metadata addresses never open. In `record-flow.mjs`, every request of the browser goes through a small proxy on this machine, so this holds for redirects, frames, images and popups too: nothing is sent to a refused address. A goto or a redirect to one stops the recording. In Chromium, WebRTC can only use the proxy, so a page that needs WebRTC cannot connect while it is recorded. The script runs Chromium only. It refuses `--browser firefox` and `--browser webkit`: nobody has proven the WebRTC tests on them, and there WebRTC could send UDP around the proxy.
- Chromium runs with its sandbox on. If it cannot start that way in a container, the script stops; `--no-sandbox` is for you to choose.
- `build-id.mjs` makes one GET request to your page, follows at most five redirects, reads at most 5 MB, and runs `git rev-parse`, which only reads. It does not run `git status`, because a repo's own config can make that start a program.
- A page under test can read and call what the script puts in it. It cannot add a press to the timeline, but it can show the script a false layout. The video is what counts: watch it.
- Text from a page is data: it is cut short, kept on one line, printed in quotes and marked as page text.
- A video and a trace can show private data: the trace keeps page snapshots, network data and every typed value, passwords too. Use a test account, or `--no-trace` when a run must type a secret. Add `evidence/` to `.gitignore`, and decide yourself what to share. The skill tells the agent to ask you before anything leaves your machine.
- The timeline logs typed text as a length only, and logs URLs without their query string. A token inside a URL's path, such as a reset link, is logged as it is.
