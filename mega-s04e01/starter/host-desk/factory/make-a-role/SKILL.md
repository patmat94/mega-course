---
name: make-a-role
description: Make a new role of the Host Desk from the owner's one line. Use when the owner asks for a new role ("Make <role>: …").
---

# make-a-role

Makes a new role in `roles/<role>/` from the owner's one line, the house rules of `factory/CHECKLIST.md`, the shared parts in `template/` and the role's own rule in `jobs/<role>.mjs`.

1. Read the owner's line. The role's name is the word after "Make" (for example `refund-runner`).
2. Make the role once with no rule (no `jobs/<role>.mjs`: it flags every task) and run it with `survey`: one practice that pays nothing and writes `state/survey-<role>.json`, every field the tasks carry, each id that came twice, each text field that was filled. Then read the course manual's lines for the job and the API index. Write the job's rule for one task as `jobs/<role>.mjs` (`decide({ task, settings, manual, onFile })` → `{ amount, account, why }` or `{ flag: reason }`), with a test beside it (`jobs/<role>.test.mjs`), and run the test. Every number comes from the task or the settings read per task, never from the file: a fact written down when the role is made is stale by the next attempt (S04E02). Anything the manual does not cover is `{ flag }`.
3. From the top of the Host Desk, run:

   ```
   node factory/make-a-role/make.mjs <role> "<the owner's line>" --api <the api URL from start-challenge>
   ```

4. Run the new role as `README.md` says, in a fresh session: practice first.
5. When the course refuses a try, write its cause under "Refusals" in `CHECKLIST.md` before the next try. Then fix the factory (a rule in `CHECKLIST.md` or `template/` when every role needs it, `jobs/<role>.mjs` when only this job does) and make the role again. Never edit `roles/<role>/` by hand: the next role would not get the fix.
