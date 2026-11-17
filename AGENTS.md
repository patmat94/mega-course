# MEGA.dev course

Personal folder for MEGA.dev course challenges.

Read first: `KEEP.md`, then this file.
Decisions: `docs/adr/`, one file per decision. When the human decides how something is done here, it goes in a new file there. Each ADR has a `**Status:**` line under its title: `accepted`, or `superseded by NNNN`. A new ADR that replaces an old one changes the old one's Status.

## Commands

- Run: none — each lesson folder has its own commands.
- Test: `node --test "lib/wake/test/*.test.ts"` (the shared wake module); `node --test ".claude/hooks/test/*.test.mjs"` (hooks); `node --test "mega-s04e01/starter/host-desk/roles/reviewer/test/*.test.mjs"` (the Host Desk reviewer's http tool); lesson folders have their own.
- Typecheck or lint: none at the root; `lib/wake/WAKE.md` § Tests gives the strict `tsc` line.

## How work moves here

1. **Plan.** A piece of work starts as a plan: `plan.md` at the root, one at a time. A finished plan moves to `docs/plans/done/`.
2. **Split.** The plan is split into issues with the `split-plan` skill (`.agents/skills/split-plan/`). Every issue carries `Source: plan.md § <n>` and `Done when:`.
3. **Human review.** A human reviews the split before any issue is published. No issue is published without their yes.
4. **Workers.** One worker per issue, each on its own branch or worktree. Pick the model and the effort per issue from the table in `docs/adr/0003-model-routing.md`: the strongest for logic, a cheaper one for views, copy and tests.
5. **Closing comment.** A worker closes its issue with a comment in exactly this shape:

   ```
   done: <what changed, one line>
   worker: <harness> · <model> · <effort>
   commit: <sha or "none">
   ```

   `<harness>` is the harness's own name (claude-code, codex, cursor), `<model>` the model id the harness reports, `<effort>` the reasoning effort it ran at.
6. **Closing.** An issue is closed only when its `Done when` holds. If it can't hold yet, it stays open and says what it waits on.

## Issues

Issues live in patmat94/mega-course. One place per plan, never a mix. `gh` is blocked on this PC: file issues through the built-in browser (prefilled `issues/new?title=&body=` pages, signed in as patmat94), take each number from the page after Create, and check the issue list for gaps and duplicates afterwards. The `lib/wake/` plan is issues #1–#11 (2026-11-10).

Every issue carries `Source:` and `Done when:`. Nothing else.

## Skills

Shared skills live in `.agents/skills/`, one folder each, with a `SKILL.md` inside. That folder is the one source for every harness on this repo. A harness that loads skills from somewhere else points there, with a link or a config entry. Never copy a skill: copies drift.

- Pi finds `.agents/skills/` by itself.
- Claude Code reads `.claude/skills/`, which holds only junctions into `.agents/skills/` and is git-ignored. A new skill goes into `.agents/skills/<name>/` first, then `mklink /J .claude\skills\<name> .agents\skills\<name>`.
- Paths like `.claude/skills/hands/scripts/...` still work through the junction.

## Run record

`.claude/hooks/config-stamp.mjs` appends one line to `runs.jsonl` at every Claude Code session start: session id, time, git HEAD, whether the tree was dirty, and `config`, a sha256 of AGENTS.md then KEEP.md. To see the config a solve ran under, find its session id there and read `git show <head>:AGENTS.md`; `node .claude/hooks/config-stamp.mjs --print` shows the current values (`docs/adr/0016-one-skill-source-and-config-stamp.md`).

## Principles

- Verify your changes in proportion to their impact. Report what you ran. Why: the checks then match the size of each change, instead of everything waiting for the claim gate (`docs/adr/0005-verify-in-proportion.md`).
- Build or change every tool an agent calls with the hands skill (`.claude/skills/hands/`): a TOOL.md per tool before the code, and `check-tool.mjs --yes` exiting 0 against the live tool before a claim or hand-off (budget 1024 B unless the client sets one). A server with sign-in keeps it on, gets a signed-in stdio entry for the check, and lets access be taken back without a database edit (`/revoke` and an owner page). Why: the course counts every byte a model receives, and a grant that only a database edit can end stays open (`docs/adr/0006-tool-servers-measure-and-revoke.md`).
- Before you start a worker off this machine (a cloud session, CI, SSH), check that it can reach its repo, and write its way home into the brief: by default a tool-home memo the main agent reads back, checked before the hand-off. Why: a private repo stopped the first S02E04 cloud worker at once, and a cloud session cannot report back, so its result needed a paste (`docs/adr/0007-remote-workers-reach-and-way-home.md`).
- Send every field with the JSON type the contract's example shows: a number as a number, never as text; check each field's type in the built body before the send. Why: S02E05's validator skipped rows with "round": "2" without naming the field, so five tries failed (`docs/adr/0008-exact-field-types-and-push-outside-background.md`).
- Never fire a push the human must get only from background work after the response (`ctx.waitUntil`, a detached promise). Log each attempt, keep a failed push pending and retry it until a 2xx, write "notified" only on that 2xx, and test the push from the host itself. Why: in S02E05 the push died silently and arrived 12 minutes late (same ADR).
- Build a Worker that an outside service wakes (a signed call, a webhook) on `lib/wake/`: in this repo import it by relative path, in another repo install `@patmat94/wake` at an exact version (`docs/adr/0018-wake-as-a-versioned-package.md`), never copy it, and start from `lib/wake/demo/` (contract: `lib/wake/WAKE.md`). Why: it already does the signature check, dedupe, queue, 2xx and pushes that retry with a row per attempt; on Cloudflare it kept a push alive through 7 refusals from ntfy.sh, where S02E05's hand-wired agent lost it (`docs/adr/0009-shared-wake-module.md`).

- Check every tag or value that came only from speech by ear before the first claim: listen at each cited second, or ask the human to. A second transcription run is not a check. Why: in S03E01 Whisper wrote "RH-5-H" for R-Z5H twice, and the first list was refused (`docs/adr/0010-spoken-tags-by-ear-and-reread-page.md`).
- After a claim comes back `progress`, re-read the signed-in Challenge page and call `start-challenge` again before the next step, then apply what changed. Why: in S03E01 product's answer to a conflict was only on the page, and the claim reply only hinted at it (same ADR).

- Right before each claim, and after each refused claim, poll every live request source once more (collector, channel, feed, page); claim only after a poll that brought nothing new. Why: in S03E02 a client's withdrawal arrived after four empty polls, and the first claim was refused (`docs/adr/0011-poll-before-claim-and-no-duplicate-without-an-ask.md`).
- Never close a request that asks for nothing (a withdrawal, a thank-you) as a duplicate: put its id in the `sources` of the issue it acts on. Why: a duplicate repeats an ask; in S03E02 the course refused the withdrawal closed as duplicate and accepted it in the withdrawn issue's sources (same ADR).

- A ship line for a change to an existing answer names the issue and every reader in `open risks`, and keeps them after the record is signed; only "unsigned" leaves. Why: in S03E03 a line rewritten to "none" after the owner signed was refused (`shiplog_risk`); a signature settles the choice, not who sees it (`docs/adr/0012-ship-line-keeps-readers-and-unclear-answers-are-asked-again.md`).
- When an owner answer cannot be read as one of the record's options, build nothing and ask again in the issue, quoting what arrived. Why: a guess is the agent deciding the owner's call, and in S03E03 nothing forced the agent to ask again (same ADR).

- End every ticked Acceptance line with `· evidence: <pointer>` (`log.txt:47`, or a file or folder path); the claim gate denies a tick whose pointer is missing or does not exist. Why: a tick without a pointer is a claim from memory (`docs/adr/0013-acceptance-ticks-point-at-evidence.md`).

- Write every receipt to a file the moment it arrives: a script that acks, claims or submits appends each receipt to a `*.jsonl` file as the reply comes in, never at the end of the run. Why: in S03E04 a recording run crashed after two acks and lost both receipts, because the script wrote them only at the end (`docs/adr/0014-receipts-saved-on-arrival.md`).
- Prove a shipped web change with the prove skill (`.claude/skills/prove/`): `build-id.mjs` before recording and before sending, then `record-flow.mjs`. It records presses but not API replies, so take receipts with your own listener. Why: the S03E04 recorder, build stamp and hook check were one-off scripts; prove does the first two for any project (same ADR).

- Before a success metric decides a release call, check at least one replay or call against the event log, so you know every way to do the measured action leaves a row. Scan replays every 0.1 s and quote what each frame shows. Recount from raw rows, not from a generated summary. Why: in S03E05 both summaries called the releases wins, while operators finished the work in a sched-admin or sched-desk tab for 1.4 s that the log never saw (`docs/adr/0015-metric-checked-against-replays-before-a-release-call.md`).

- Every agent role reads its facts (settings, prices, limits, accounts) from their source at every start, never from values copied into its prompt or code. A role that judges or changes code also reads the house notes (`why/`) first. Do it with the rook-plane skill (`.agents/skills/rook-plane/`): a `reads.json` per role, started through its `startup.mjs` bundle. Why: in S04E02 the given reviewer judged against 15 % commission pinned in its prompt while the live setting was 10 %, so its review was refused (`docs/adr/0017-roles-read-facts-and-house-notes-and-verdicts-are-read-back.md`).
- Read back each course verdict an agent reports (accepted, refused, paid, done) from the course itself before telling the human or claiming. The agent's own report is not proof. Why: in S04E02 the course's read-back, not the reviewer's summary, was the evidence for both reviews (same ADR).

## Rules

- Never commit `.env`, tokens or keys.
