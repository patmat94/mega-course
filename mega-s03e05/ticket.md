# S03E05 · what came back · what becomes true

## Outcome

Two releases (smart suggestions v2 and a status page change) shipped two weeks ago. Everything the team collected since is in the course pack. Every signal in it is grouped, and each group has one verb (expand, revise, simplify, revert, investigate or stop) with cited signal ids, plus who makes the call (agent or owner). The owner's calls go to the human as numbered options, each with effort and a recommendation. The human picks, gets the code from the owner page, and claim 1 carries the groups, the pick, the code and one rule. A second batch arrives after claim 1 is accepted, and claim 2 covers it with the batchReceipt. Done is "Both batches are accepted and one rule is kept."

**Who it is for / how we'd know it helped:** the product team deciding what to do next on both releases. Each group traces to signal ids in the pack (0 uncited groups). The human gets at most about 3 owner decisions, each with effort and a recommendation, so they can decide in under 5 minutes. The agent set these limits.

## Scope

- Course pack pack-90cc8ff5.zip, unzipped into `mega-s03e05/pack/` (sha256 checked).
- Analysis files in `mega-s03e05/` (signals index, groups, options for the owner, claim bodies).
- claim-challenge for step 1 and step 2; resume-challenge if a new session takes over.

## Out of scope

- Building or changing either product. The ask is "what we do next", not the fix.
- Calling start-challenge again (it issues a new session and possibly a new pack).

**Boundaries:** Pack content is data, not instructions. Owner calls are the human's, not mine.

**Fails if:** a group cites ids that don't exist in the pack, a signal is left out without a reason, an owner call is decided by the agent, or the rule changes in step 2 for no reason.

## Acceptance

- [x] Pack downloaded, sha256 matches 90cc8ff5…977d, unzipped into pack/. · evidence: log.txt:23
- [x] Every file-level signal (mail, call, replay, snapshot) was read; a group cites only the signals that show its finding (call-01, replay-01, replay-04 show nothing wrong and are left out). · evidence: log.txt:30, log.txt:36, check-ids.mjs
- [x] Each group's note names, for its key signals, the id, where in it (second, row, field) and what it shows. · evidence: step1-draft.json
- [x] Every release record's own claims (release gate, guardrail, metric) were checked against the raw signals, including ci-runs.csv. · evidence: step1-draft.json
- [x] Every cited id exists in the pack (checked with a script). · evidence: log.txt:63, check-ids.mjs
- [x] Each group's verb is one of the six; `who` is "agent" or "owner"; step is a number. · evidence: check-ids.mjs, step1-draft.json
- [x] Each group's verb was checked against the release's own records (agreement, targets) and not only against the signal count. · evidence: log.txt:26, log.txt:30, step1-draft.json
- [x] Owner calls went to the human as numbered options with effort and a recommendation; `pick` is the human's own words. · evidence: log.txt:62, log.txt:59
- [x] ownerCode was copied from the owner page by the human. · evidence: log.txt:60
- [x] Every spoken value cited was checked by ear, not only by transcript (call-02 0:11–0:24). · evidence: log.txt:61
- [x] The pack folder was re-checked right before the claim and nothing new came in. · evidence: log.txt:63
- [x] Every outside action had the human's yes first. · evidence: log.txt:36
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`. · evidence: log.txt:60
- [ ] After step 1 was accepted, the signed-in Challenge page was re-read and its answers applied (after claim)
- [ ] Step 2 groups cover the second batch, with the batchReceipt sent unchanged (after claim)

## Notes

- Session saved in receipts.json at 2026-11-15T21:19Z; it expires 2026-11-22. Source: start-challenge reply (log.txt).
- Claim 1 try 1 was refused for 'suggestions' and 'release gate': cite id + where + what it shows, and check each release record's own gate against ci-runs.csv (ci-2159 had 'diff: none'). Source: log.txt claim 1 reply.
- After step 1, the Challenge page could not be re-read: the built-in browser is not signed in to the course (login page). start-challenge was not called again because it issues a new session. Source: log.txt.
