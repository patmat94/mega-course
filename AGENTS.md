# MEGA.dev course

Personal folder for MEGA.dev course challenges.

Read first: `KEEP.md`, then this file.
Decisions: `docs/adr/`, one file per decision. When the human decides how something is done here, it goes in a new file there.

## Commands

- Run: none — each lesson folder has its own commands.
- Test: none
- Typecheck or lint: none

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

Issues live in patmat94/mega-course. One place per plan, never a mix.

Every issue carries `Source:` and `Done when:`. Nothing else.

## Skills

Shared skills live in `.agents/skills/`, one folder each, with a `SKILL.md` inside. That folder is the one source for every harness on this repo. A harness that loads skills from somewhere else points there, with a link or a config entry. Never copy a skill: copies drift.

## Principles

- Verify your changes in proportion to their impact. Report what you ran. Why: the checks then match the size of each change, instead of everything waiting for the claim gate (`docs/adr/0005-verify-in-proportion.md`).

## Rules

- Never commit `.env`, tokens or keys.
