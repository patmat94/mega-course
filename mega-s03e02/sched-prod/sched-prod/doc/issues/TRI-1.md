---
key: TRI-1
title: "confirmation email: \"Add to calendar\" link opens a blank page"
status: open
labels: [agent-ready, from:support]
sources: [IN-4945]
---

## Intent
The "Add to calendar" link in the booking confirmation email opens a calendar entry for the booking (an .ics file or the calendar's add page), not a blank page. Split from IN-4945, which held two problems.

## Acceptance
- Given a confirmation email, when the person opens "Add to calendar", then they get the booking with its start, end and time zone (ADR-0001).
- Given the link, when opened twice, then it adds the same event with the same stable id, not a second different one (ADR-0002).
- Given the link, when opened, then it does not show a blank page or ask for a login.
- A test covers the link.

## Boundaries
- Must not change the logo fix in IN-4945.
- Must not read events back from external calendars (ADR-0002).

Allowed by AUT-1 (bug fixes and small features inside the specs, with a test that shows the change).

## Request as filed
Split by triage; see the request in sources.
