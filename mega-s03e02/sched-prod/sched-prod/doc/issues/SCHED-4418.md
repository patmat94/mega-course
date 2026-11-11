---
key: SCHED-4418
title: "week view: first day of the week follows the account locale"
status: open
labels: [agent-ready, from:support]
---

## Intent
The week view starts on the first day of the week of the account's locale instead of always on Sunday.

## Acceptance
- Given an account with locale en-US, when staff open the week view, then it starts on Sunday.
- Given an account with locale de-DE or en-GB, when staff open the week view, then it starts on Monday.
- Given a booking, when the first day changes, then its time and day do not change (PRD-2).
- A test covers at least two locales.

## Boundaries
- Must not change stored times or the time zone handling (PRD-2).
- Must not add a new setting; the locale already holds the rule (PRD-4).

Allowed by AUT-1 (bug fixes and small features inside the specs, with a test that shows the change).

## Request as filed
Week view always starts on Sunday. It should start on the day the account locale says.
