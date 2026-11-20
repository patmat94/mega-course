# Outcome · S04E04 Leave it running

Handed in on the course itself. Attempt 9 used the night-desk role and poller in `mega-s04e01/starter/host-desk/roles/night-desk/`, which ran the 10-minute night as a background command. The payout batch then ran on the same attempt and got `done`, with 15 paid and 5 parked. The human decided the 5 on the owner page: two add-night, a take-new at 3 nights, and two declined. `finish.mjs` finished all 5, and the claim came back solved.

It took 9 runs and one claim. These are what each refused run was missing:
- Run 1 paid a booking whose guest request was parked.
- Nights 2 and 3 had no runs. Each missed an event result because of a crash or timeout.
- Runs 4 and 5 lost seq 5 and seq 12 to the course jobs `legacy/export` and `rook/lint`. Both are now stopped by id before the window.
- Run 6 gave no result to a redelivery whose data had changed.
- Run 7 answered that redelivery `conflict`, while the batch still paid the first change.
- Run 8 posted `applied` twice for identical retries.

Final rules:
- A retry with the same data gets an ack only.
- A redelivery with changed data gets `parked`, nothing is recorded, and the batch flags its booking for the owner.

Who-it-is-for line: met. Night 9 had 0 events without a result, and the slowest result came 12 s after the event went out, against the 90 s limit. Nobody typed during the night, and the only things left for the owner were parked payouts and guest messages, each with a reason.

For S04E05:
- The board can hold course jobs that take events from your stream, so read the board and the seq gaps before the first night.
- `finish.mjs` now honours a `/parked` `amount`, which covers decisions such as `take-new`.
