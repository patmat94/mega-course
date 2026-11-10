# S02E05 · while you're away · what becomes true

## Outcome

An agent of ours runs on a machine that stays up (a sandbox that does not sleep) and answers the course's messages on one registered channel while the human is away. It acts alone on the acts the human marked "free", holds "gated" acts, pings the human's phone, and does a gated act only after the human gives it a code only they have. The course accepts the practice labels and the live try in the registered window.

**Who it is for / how we'd know it helped:** the human, away from the laptop with only the phone; it helped if every gated ask reached the phone from the agent itself within 2 min, free acts never pinged them, and each held act was done within 1 min of their code. Checked by `node check-helped.mjs <log> <heldActs>` (thresholds set by me on 2026-11-10, not yet confirmed by the human).

## Scope

- Policy: per act (post_status, ack_alert, archive_report, purge_cache, release_hold, rotate_key) free or gated, decided by the human, at least one of each.
- The agent's check, run on practice p01–p10; submit.practice through claim-challenge.
- An agent host that stays up (candidate: Cloudflare Worker, like rig-pulse / mail-agent / tool-home) and one channel: `<name>@agentmail.to` or an HTTPS URL that checks the HMAC signature.
- A phone ping (ntfy topic, optional field in register).
- submit.register with channel and a 15–30 min window starting within 15 min of registering; then claim-challenge `{}` for status.

## Out of scope

- Changing the running S02E02 mail-agent or S02E03 tool-home Workers unless the human says so.
- S02E04 "two places" (open, not this Challenge).

## Acceptance

- [x] Policy has all six acts, each free or gated, at least one of each, set by the human (not by me).
- [x] Practice labels p01–p10 come from running the agent's own check, and `total` is the count it got right.
- [x] submit.practice accepted by claim-challenge.
- [x] Agent host stays up with the laptop closed; channel answers a test message from outside.
- [x] HTTPS channel: signature checked (x-course-timestamp, x-course-signature, HMAC-SHA256 of "<timestamp>.<raw body>") before any act; tested locally with a good and a bad signature.
- [x] signingKey stored only with the agent (secret) and in receipts.json, masked in log.txt.
- [x] Phone ping reaches the human's phone (human confirms) before the window opens.
- [x] A gated act runs only after the human's code; the agent never does it alone.
- [x] Window 15–30 min, starts within 15 min of register, chosen by the human with their phone near.
- [x] Each course message answered within 10 min; each held act DONE within 60 min of its message. (after claim)
- [x] claim-challenge `{}` reports the try passed (after claim)
- [x] Status log rows carry "round" as a number ("round": 2), not a string.
- [x] Every outside action (account, deploy, mail, push) had the user's yes first.
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.

## Notes

- The claim is staged (practice, then register). Register-stage lines carry "(after claim)" only so the gate lets the practice claim through; take that marker off them and re-tick everything before the register claim. Source: start-challenge.json `steps`, .claude/hooks/claim-gate.mjs.
- Policy set by the human 2026-11-06: free = post_status, ack_alert, archive_report, purge_cache; gated = release_hold, rotate_key (first answer was the reverse; the human chose "Swap them" on the confirm).

- Untrusted senders: S02E02 failed a round for replying to a sender other than the course; here the course writes from away@mail.mega.dev as "rook" or "scout" (start-challenge.json `sender`). Source: KEEP.md, start-challenge.json.
- Test signature verification locally; a silent agent looks like a slow queue. Source: KEEP.md (human).
- Try 1 (window 12:02): code_wrong. First reply to scout was in the wrong format ("HELD unknown"), corrected lines sent after; the code from the course code page matched what was sent. Source: log.txt.
- Try 2 (12:14): log_mismatch: received. Status log was rebuilt afterwards from the event log, and "notified" rows were laptop relays (agent pings got ntfy 429 from Cloudflare). Source: log.txt, check-lane hint 1.
- Try 3 (12:46): log_mismatch: received. Rows written at each event; "received" stamped at arrival, but the 2xx went out ~1 s later (KV writes before the response). Fixed: 2xx right after the signature check. Hint 2: rows are checked against the course's own times, every time with its zone offset. Source: log.txt.
- Third window in 24 h used; the human must press Start over on the course site for three new windows. Source: claim reply 2026-11-06 ~12:34Z.
- After two Start over presses (~13:00 local) the practice step reset and was accepted again, but every register with newRound still got "That was your third window in 24 hours" (retryAfter 3600). Next: register again after the limit clears or once Start over takes effect; first call /window?from=<window start> on the agent, then store the new signingKey as SIGNING_KEY at once. Source: log.txt.

- Try 4 (window 15:31, after a third Start over): all messages answered in time (round 1 reply +1.5 s; round 2 DONE ack_alert / HOLD release_hold +2 s; owner code from the phone form, DONE release_hold CODE at +4.5 min). Status log from GET /status, rows written at each event, received stamped at arrival (0.2 s after x-course-timestamp). Still log_mismatch: received. Hint 3: write one row at the moment each event happens, with its time and offset; never from memory at the end. Cause still unknown. Source: log.txt.
- Try 5 (window 16:12, diagnostic): agent now records every request (GET /reqs). Only two course POSTs, each answered 202 in the same ms, 0.3–0.4 s after the course's own timestamp. Log sent with a second round-2 "received" row (one per ask): still log_mismatch: received. Ruled out: lost/extra deliveries, slow 2xx, one row per ask. One window left in this 24 h set. Source: log.txt.
- Course answer 2026-11-09 (pasted by the human): the validator does not find a row whose "round" is a string; send it as a number. Source: log.txt.
- 2026-11-10, "who it is for" check (check-helped.mjs): the accepted try 6 (status-log-accepted.jsonl, rows from log.txt:189) **fails** it: the ping reached the phone 717 s after the gated ask (limit 120 s); one ping, none for free acts, and done 1.0 s after the code all pass. status-log.jsonl on disk is the try-2 log (2026-11-06), not the accepted one: its pings were on time (24 s) but were laptop relays, not the agent (log.txt:111), so it fails too. The course accepted a run that did not help its user on the one thing it was for. Source: check-helped.mjs run, log.txt:111, 183–189.
