# S03E03 · out of office · an agent ships tracker issues alone while the owner is away

## Outcome

An agent built from the starter API runs on a host that stays up, with no human at the keyboard, for a whole round (~20 minutes of issues from product and support on the course tracker). It picks up each issue within 5 minutes, ships the change to our live https address, asks the owner only what is the owner's to decide, and keeps a ship log on the tracker. It works each issue from our `triage` skill, grown so it runs alone. Solved when the second claim-challenge accepts `{ round, url }`.

**Who it is for / how we'd know it helped:** The away owner of the scheduling product, and product and support who need changes live. Proposed limits (set by the harness, to confirm with the human): every issue picked up ≤ 5 min after it opens (course limit); every buildable issue live at the https address ≤ 15 min after pickup; ≤ 1 owner question per issue, and 0 questions for issues the triage skill can decide alone; ship log has one line per issue.

## Scope

- Starter `sched-prod-api` (zip from start-challenge) in `mega-s03e03/`, in a git of our choice.
- The `triage` skill in `.agents/skills/triage/`, grown for unattended runs.
- An agent host that stays up (to be chosen; earlier lessons used Cloudflare Workers) and the API's live https address.
- The course tracker, round page and production feed handed back by the open claim.

## Out of scope

- Editing the course's own tracker data beyond what the agent's token allows.
- S03E04's incident board.

**Boundaries:** After the round opens, the human changes no code. Every new account, key, deploy target or spend needs the human's yes first.

**Fails if:** an issue is not picked up within 5 minutes; the live URL is not https on the standard port; the agent asks the owner something it could decide alone, or decides something that was the owner's; the round receipt goes into `receipts` instead of `answer`.

## Acceptance

- [x] Starter downloaded and its sha256 matches beb828174aa385a2feba996de44660738b1089d3c8d6dadf390399d5ca67ae92.
- [x] Starter deployed and answering at an https address on the standard port (checked from outside): https://sched-prod-api-production.patrykmatychniak.workers.dev, /nope → 404 JSON; /incidents waits on FEED_URL from the round.
- [x] Triage skill grown for unattended runs (§6): says what to read first, when to build / decline / ask the owner, and the ship line's shape; linked into the API repo's .claude/skills (check-lane skill-wiring: one source, no copies).
- [x] Agent runs on a host without the human and was tested end to end before the round opened (dry run against agent/fake-tracker.mjs: #1 shipped live ✓, #2 asked → /answer 2 → shipped ✓, #3 declined; test Worker deleted).
- [x] Every outside action (repo, issue, push, message) had the user's yes first.
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.
- [x] claim-challenge returns solved (after claim)
- [x] FEED_URL from the round set under [env.production.vars] and deployed; GET /incidents answers 200 live with the contract's fields (id, service, summary, status, openedAt).
- [x] Every issue on the tracker was picked up within 5 minutes of opening (6 issues, pickup 2.5–29.6 s).
- [x] Every issue has a ship line in the ship log on the tracker (6 lines; #2's must be updated after the owner's answer).
- [x] Owner questions only for decisions that are the owner's; each was answered on the round page and the record is signed by the owner (#2 only: /answer 2 at 22:07:14Z; 0007 signedBy owner 22:10:45Z).
- [x] `lastIssueBy` has passed, and the tracker and feed were polled right before the claim and brought nothing new (22:11:10Z: 6 issues, 0 open; live /incidents 200).
- [x] A ship line for a change to an existing answer names the risk with its issue id and who reads it (status page, on-call board, support console); a signed record does not make it "none" (refused claim 1: shiplog_risk).
- [x] Verdict claim sends answer `{ round, url }` only: two flat fields, round not in receipts.

## Notes

- Source of all lines above: start-challenge reply, 2026-11-12 (mega-s03e03/log.txt).
