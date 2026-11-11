---
key: SCHED-4431
title: "booking page: show remaining seats"
status: open
labels: [agent-ready, from:client]
---

## Intent
The booking page shows how many seats are left in a group slot.

## Acceptance
- Given a slot with 10 seats and 7 bookings, when a person opens the booking page, then it shows 3 seats left.
- Given a slot with one seat, when the page renders, then no seat count is shown.
- Given a full slot, when the page renders, then it shows no seats left and it cannot be booked; no overbooking.
- A test covers these cases.

## Boundaries
- Must not change how bookings are made or counted (PRD-1).

Allowed by AUT-1 (new columns, filters or fields that add to what is there and take nothing away).

## Request as filed
Group slots should show how many seats are left.
