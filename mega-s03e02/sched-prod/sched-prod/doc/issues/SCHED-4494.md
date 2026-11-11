---
key: SCHED-4494
title: "week view: a booking across midnight shows on its first day only"
status: open
labels: [agent-ready, from:support]
---

## Intent
A booking that crosses midnight shows on both days it covers in the week view.

## Acceptance
- Given a booking 23:00–01:00 in the viewer's zone, when the week view renders, then it shows on day one until 24:00 and on day two from 00:00.
- Given that booking, when it shows on two days, then it is still one booking in one slot (PRD-1), not two.
- Given a viewer in another zone, when the view renders, then the days follow the viewer's zone (PRD-2).
- A test covers a booking across midnight and one that does not.

## Boundaries
- Must not split the booking or change stored times (PRD-1, PRD-2).

Allowed by AUT-1 (bug fixes and small features inside the specs, with a test that shows the change).

## Request as filed
A booking from 23:00 to 01:00 shows on its first day and is missing from the second.
