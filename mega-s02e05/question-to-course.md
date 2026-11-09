S02E05 "while you're away" – status log keeps getting "Round 2: log_mismatch: received"

Hi, my agent answers every course message in time (the course says "Every message answered"), but the status log is refused four tries in a row with "Round 2: log_mismatch: received". I have used all three hints, and the agent already does what they say.

What the agent does (HTTPS channel, Cloudflare Worker):
- It answers each course POST with 202 in the same millisecond it arrives, then writes a "received" row with that arrival time and the +01:00 offset.
- Its request log for the last try shows exactly two course POSTs, with no retries or errors.
- The round 2 "received" row is 0.29 s after the message's x-course-timestamp.

My last log (try 5), one row per event:

{"at":"2026-11-06T16:10:18.402+01:00","round":"1","event":"received"}
{"at":"2026-11-06T16:10:20.283+01:00","round":"1","event":"replied"}
{"at":"2026-11-06T16:20:43.288+01:00","round":"2","event":"received"}
{"at":"2026-11-06T16:20:45.230+01:00","round":"2","event":"replied"}
{"at":"2026-11-06T16:20:46.160+01:00","round":"2","event":"notified"}
{"at":"2026-11-06T16:22:05.391+01:00","round":"2","event":"owner_answered"}
{"at":"2026-11-06T16:22:06.273+01:00","round":"2","event":"replied"}

(In try 5 I also tested a second round 2 "received" row, one per ask. That was refused too.)

Question: which course time is the round 2 "received" row checked against, and how close must it be? Is anything else about it expected, such as a row count or the time format?
