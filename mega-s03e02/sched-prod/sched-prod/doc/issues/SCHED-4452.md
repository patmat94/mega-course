---
key: SCHED-4452
title: "calendar sync: Outlook events arrive twice"
status: open
labels: [agent-ready, from:support]
---

## Intent
Each booking reaches a connected Outlook calendar once: pushes reuse the booking's stable id, so a re-sync updates the event instead of adding a second one (ADR-0002).

## Acceptance
- Given a booking already synced to Outlook, when sync runs again, then the calendar has one event for it.
- Given a changed booking, when sync runs, then the existing event is updated, not duplicated.
- Given the fix, when sync runs, then sched-prod still never reads events back from Outlook (ADR-0002).
- A test covers a repeated sync.

## Boundaries
- Must not add two-way sync (ADR-0002).
- Must not delete events in clients' calendars.

Allowed by AUT-1 (bug fixes and small features inside the specs, with a test that shows the change).

## Request as filed
Some Outlook calendars show each booking twice after a sync.
