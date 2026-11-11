---
key: SCHED-4498
title: "confirmation email: the cancel link opens the login page"
status: open
labels: [agent-ready, from:support]
---

## Intent
The cancel link in the booking confirmation email opens the booking without a login, the same way the cancel link in the reminder email does.

## Acceptance
- Given a confirmation email, when the person who booked opens its cancel link, then the booking opens with a cancel button and no login.
- Given a cancel link for one booking, when it is opened, then it shows only that booking and nothing else of the account.
- Given the reminder email's cancel link, when it is opened, then it works as today.
- A test covers both emails.

## Boundaries
- Must not change the reminder email or its link.
- Must not let the link show or change other bookings.

Allowed by AUT-1 (bug fixes and small features inside the specs, with a test that shows the change).

## Request as filed
The cancel link in the booking confirmation email asks for a login. People who booked have no account. The cancel link in the reminder email opens the booking without one, as it should.
