# S01E05 · answer where i asked · a live pulse agent answers the reviewer without anyone at a keyboard

## Outcome

The rig's pulse agent runs on a public https host. When the course reviewer sends a signed ping asking where the rig stands, the agent reads the tracker and answers on its own. A second agent (the test writer) writes a test for an open bug found in the tracker. The course accepts the claim.

## Scope

- Starter zip downloaded locally: `mega-s01e05/` (plan.md, ADRs, digest code, docs/course-api.md)
- Pulse agent deployed to a public https host of our choice
- `/.well-known/mega-pulse.json` served at that host with the ownerCode
- pingKey stored in the host's secrets (not in the repo or chat)
- Course tracker read via GET `https://hq.mega.dev/rig/tracker/issues`
- Test writer agent produces a test for any open bug in the tracker

## Out of scope

- Editing the course's tracker or any course data
- Any second host or second agent deployment

## Acceptance

- [x] `/.well-known/mega-pulse.json` is reachable at the host's public https address and contains the correct `owner` field (ownerCode).
- [x] pulse agent's `may` list contains only `["answer"]` — no tracker-changing actions. *(refusal: first claim)*
- [x] test-writer agent's `may` list contains only `["test"]` — no answer/comment/tracker actions. *(refusal: second claim)*
- [ ] Pulse agent verifies the course's ping signature using pingKey before answering.
- [ ] Agent reads the tracker and returns a correct status answer when the reviewer asks.
- [ ] Test writer agent has produced a test for an open bug from the tracker.
- [ ] claim-challenge returns solved.
- [x] Every outside action (deploy, repo, issue, push, message) had the user's yes first.
- [x] Every public link checked from outside: 200, right content (verified live).
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.

## Notes

- ownerCode goes to `/.well-known/mega-pulse.json` owner field (raw value in receipts.json).
- pingKey goes to host secrets only — never in code or chat (raw value in receipts.json).
- Model key: human sets it in host secrets; never enters this chat.
- Each claim while a question is open checks the agent's answer. After a no, the next claim opens a new question. Free model keys may allow only ~20 questions/day.
